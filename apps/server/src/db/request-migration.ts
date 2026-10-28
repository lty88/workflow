import { readFile } from 'node:fs/promises';
import type { Pool } from 'mysql2/promise';
import { query } from './repository';

/** 只新增通用申请及关联表，不复制旧活动、不调整旧外键、不生成通知；由显式迁移命令调用。
 * @param pool 项目数据库连接池
 */
export async function migrateRequests(pool: Pool): Promise<void> {
  const db = await pool.getConnection();
  let locked = false;
  try {
    const rows = await query<{ acquired: number }>(
      db,
      "SELECT GET_LOCK(CONCAT(DATABASE(),':generic-requests'),10) AS acquired",
    );
    if (Number(rows[0]?.acquired) !== 1) throw new Error('通用申请结构正在迁移，请稍后重试');
    locked = true;
    const source = await readFile(new URL('./request-schema.sql', import.meta.url), 'utf8');
    for (const statement of source.split(';')) if (statement.trim()) await db.query(statement);
    await db.execute('INSERT IGNORE INTO schema_migrations(version) VALUES (9)');
  } finally {
    try {
      if (locked) await db.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':generic-requests'))");
    } finally {
      db.release();
    }
  }
}
