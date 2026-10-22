import { readFile } from 'node:fs/promises';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { configSchema, validateConfig, withActivityInsights } from '@workflow/domain';
import { loadConfig, materializeConfig, query, transaction } from './repository';

/**
 * 显式安装活动评价表和领导看板菜单授权，保留现有密码、活动实例及未发布草案。
 * @param pool 项目数据库连接池
 */
export async function migrateInsights(pool: Pool): Promise<void> {
  const sql = await readFile(new URL('./insights-schema.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';')) if (statement.trim()) await pool.query(statement);
  /**
   * 在公司配置排他锁内一次性补充权限与菜单，完整记录迁移发布快照和审计。
   * @param db 事务数据库连接
   */
  async function migrate(db: PoolConnection): Promise<void> {
    const state = await loadConfig(db, 'update');
    const applied = await query<{ version: number }>(
      db,
      'SELECT version FROM schema_migrations WHERE version=4',
    );
    if (applied.length) return;
    const published = configSchema.parse(withActivityInsights(state.published));
    const draft = configSchema.parse(withActivityInsights(state.draft));
    const errors = validateConfig(published);
    if (errors.length) throw new Error('评价与看板配置迁移校验失败：' + errors.join('；'));
    published.version = state.published.version + 1;
    draft.version = published.version;
    await materializeConfig(db, published);
    await db.execute(
      'UPDATE configuration SET published=?,draft=?,revision=revision+1,draft_revision=draft_revision+1 WHERE id=?',
      [JSON.stringify(published), JSON.stringify(draft), 'company'],
    );
    await db.execute('INSERT INTO configuration_releases(version,data,actor) VALUES (?,?,?)', [
      published.version,
      JSON.stringify(published),
      'system:insights-migration',
    ]);
    await db.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      crypto.randomUUID(),
      'system:insights-migration',
      '安装活动评价与领导看板',
      JSON.stringify({ version: published.version, migration: 4 }),
    ]);
    await db.execute('INSERT INTO schema_migrations(version) VALUES (4)');
  }
  await transaction(pool, migrate);
}
