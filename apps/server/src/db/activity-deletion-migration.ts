import type { Pool, PoolConnection } from 'mysql2/promise';
import { configSchema, validateConfig, withActivityDeletion } from '@workflow/domain';
import { loadConfig, materializeConfig, query, transaction } from './repository';

/**
 * 安装活动逻辑删除字段及默认权限，保留现有活动、外键、密码与独立配置草案。
 * @param pool 项目数据库连接池
 */
export async function migrateActivityDeletion(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const locks = await query<{ acquired: number }>(
      connection,
      "SELECT GET_LOCK(CONCAT(DATABASE(),':activity-deletion'),10) AS acquired",
    );
    if (Number(locks[0]?.acquired) !== 1) throw new Error('活动删除迁移正在执行，请稍后重试');
    locked = true;
    const columns = await query<{ COLUMN_NAME: string }>(
      connection,
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='activities'",
    );
    const names = new Set<string>();
    for (const column of columns) names.add(column.COLUMN_NAME);
    for (const [name, type] of [
      ['deleted_at', 'DATETIME(3) NULL'],
      ['deleted_by', 'VARCHAR(80) NULL'],
      ['deletion_reason', 'VARCHAR(500) NULL'],
    ])
      if (!names.has(name!)) await connection.query(`ALTER TABLE activities ADD COLUMN ${name} ${type}`);
    /**
     * 原子发布一次性删除权限，保留历史版本并同步管理员活动列表入口。
     * @param db 配置迁移事务连接
     */
    async function migrate(db: PoolConnection): Promise<void> {
      const state = await loadConfig(db, 'update');
      const applied = await query<{ version: number }>(
        db,
        'SELECT version FROM schema_migrations WHERE version=5',
      );
      if (applied.length) return;
      const published = configSchema.parse(withActivityDeletion(state.published));
      const draft = configSchema.parse(withActivityDeletion(state.draft));
      const errors = validateConfig(published);
      if (errors.length) throw new Error('活动删除权限迁移失败：' + errors.join('；'));
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
        'system:activity-deletion',
      ]);
      await db.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
        crypto.randomUUID(),
        'system:activity-deletion',
        '安装活动删除权限',
        JSON.stringify({ version: published.version, migration: 5 }),
      ]);
      await db.execute('INSERT INTO schema_migrations(version) VALUES (5)');
    }
    await transaction(pool, migrate);
  } finally {
    try {
      if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':activity-deletion'))");
    } finally {
      connection.release();
    }
  }
}
