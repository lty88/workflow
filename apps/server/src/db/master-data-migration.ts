import type { Pool, PoolConnection } from 'mysql2/promise';
import type { CompanyConfig } from '@workflow/domain';
import { query, jsonValue, transaction } from './repository';
import { configurationEnvelope } from './master-data';

/**
 * 显式执行第六版主数据迁移：保留原始配置备份，以现有members为准，移出配置中的组织副本。
 * @param pool 数据库连接池
 */
export async function migrateMasterData(pool: Pool): Promise<void> {
  await pool.execute(
    'CREATE TABLE IF NOT EXISTS menu_groups (id VARCHAR(80) PRIMARY KEY,name VARCHAR(80) NOT NULL,active BOOLEAN NOT NULL,sort_order INT NOT NULL DEFAULT 0)',
  );
  await pool.execute(
    'CREATE TABLE IF NOT EXISTS form_definitions (id VARCHAR(80) PRIMARY KEY,version INT NOT NULL,definition JSON NOT NULL,updated_by VARCHAR(80) NOT NULL,updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))',
  );
  await pool.execute(
    'CREATE TABLE IF NOT EXISTS form_definition_versions (form_id VARCHAR(80) NOT NULL,version INT NOT NULL,definition JSON NOT NULL,actor_id VARCHAR(80) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(form_id,version),FOREIGN KEY(form_id) REFERENCES form_definitions(id))',
  );
  await pool.execute(
    'CREATE TABLE IF NOT EXISTS master_data_migration_backups (id VARCHAR(40) PRIMARY KEY,data JSON NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))',
  );
  const columns = await query<{ COLUMN_NAME: string }>(
    pool,
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='menu_pages' AND COLUMN_NAME='sort_order'",
  );
  if (!columns.length)
    await pool.execute('ALTER TABLE menu_pages ADD COLUMN sort_order INT NOT NULL DEFAULT 0');
  /** 锁定配置并迁移一次，缺少真实管理员时停止，避免自动复活手动删除的账号。
   * @param db 事务连接
   */
  async function migrate(db: PoolConnection): Promise<void> {
    const rows = await query<{ published: unknown; draft: unknown }>(
      db,
      "SELECT published,draft FROM configuration WHERE id='company' FOR UPDATE",
    );
    if ((await query(db, 'SELECT version FROM schema_migrations WHERE version=6')).length) return;
    if (!rows[0]) throw new Error('请先初始化项目数据库');
    const config = jsonValue<CompanyConfig>(rows[0].published);
    const actual = await query<{ id: string; active: number; roles: unknown }>(
      db,
      'SELECT m.id,m.active,m.roles FROM members m JOIN departments d ON d.id=m.department_id WHERE d.active=TRUE',
    );
    const roleRows = await query<{ data: unknown }>(db, 'SELECT data FROM roles');
    const roles: CompanyConfig['roles'] = [];
    for (const row of roleRows) roles.push(jsonValue<CompanyConfig['roles'][number]>(row.data));
    let admin = false;
    for (const member of actual) {
      if (
        member.active &&
        jsonValue<string[]>(member.roles).some(
          /** 检查真实成员角色是否具备主表中的管理权限。
           * @param id 当前角色标识
           * @returns 是否有管理权
           */ function permitted(id) {
            return roles
              .find(
                /** 查找真实角色定义。
                 * @param role 角色定义
                 * @returns 是否同一角色
                 */ function match(role) {
                  return role.id === id;
                },
              )
              ?.permissions.includes('config:manage');
          },
        )
      )
        admin = true;
    }
    if (!admin)
      throw new Error(
        'members中没有有效管理员。请先恢复数据库备份；误清空成员表可显式运行 pnpm db:recover-members，再迁移。',
      );
    await db.execute('INSERT INTO master_data_migration_backups(id,data) VALUES (?,?)', [
      'v6',
      JSON.stringify(rows[0]),
    ]);
    for (let i = 0; i < config.groups.length; i++) {
      const g = config.groups[i]!;
      await db.execute('INSERT INTO menu_groups(id,name,active,sort_order) VALUES (?,?,?,?)', [
        g.id,
        g.name,
        g.active,
        i,
      ]);
    }
    for (let i = 0; i < config.pages.length; i++)
      await db.execute('UPDATE menu_pages SET sort_order=? WHERE id=?', [i, config.pages[i]!.id]);
    await db.execute('INSERT INTO form_definitions(id,version,definition,updated_by) VALUES (?,1,?,?)', [
      config.form.id,
      JSON.stringify(config.form),
      'migration:v6',
    ]);
    await db.execute(
      'INSERT INTO form_definition_versions(form_id,version,definition,actor_id) VALUES (?,1,?,?)',
      [config.form.id, JSON.stringify(config.form), 'migration:v6'],
    );
    // 旧草稿完整备份；运行态只保留当前主表状态，不隐式提交任何旧草稿。
    const envelope = JSON.stringify(configurationEnvelope(config));
    await db.execute(
      "UPDATE configuration SET published=?,draft=?,revision=revision+1,draft_revision=draft_revision+1 WHERE id='company'",
      [envelope, envelope],
    );
    await db.execute('INSERT INTO schema_migrations(version) VALUES (6)');
  }
  await transaction(pool, migrate);
}
