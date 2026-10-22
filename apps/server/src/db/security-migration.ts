import type { Pool } from 'mysql2/promise';
import { query } from './repository';

/**
 * 显式升级附件节点归属和内容授权列，支持重复执行，不更改历史资料和既有角色授权。
 * @param pool 数据库连接池
 */
export async function migrateDataSecurity(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const locks = await query<{ acquired: number }>(
      connection,
      "SELECT GET_LOCK(CONCAT(DATABASE(),':workflow-security'),10) AS acquired",
    );
    if (Number(locks[0]?.acquired) !== 1) throw new Error('数据权限迁移正在执行，请稍后重试');
    locked = true;
    const columns = await query<{ COLUMN_NAME: string }>(
      connection,
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='files'",
    );
    const existing = new Set<string>();
    for (const column of columns) existing.add(column.COLUMN_NAME);
    for (const [name, type] of [
      ['node_id', 'VARCHAR(80) NULL'],
      ['access_rule', 'JSON NULL'],
      ['download_rule', 'JSON NULL'],
    ] as const)
      if (!existing.has(name)) await connection.query(`ALTER TABLE files ADD COLUMN ${name} ${type}`);
    await connection.execute('INSERT IGNORE INTO schema_migrations(version) VALUES (3)');
  } finally {
    try {
      if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':workflow-security'))");
    } finally {
      connection.release();
    }
  }
}
