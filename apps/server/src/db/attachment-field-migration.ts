import type { Pool } from 'mysql2/promise';
import { query } from './repository';
/** 增量加入附件字段归属及查询索引，可重复执行，保留既有阶段附件和历史文件。
 * @param pool 项目数据库连接池
 */
export async function migrateAttachmentFields(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const locks = await query<{ acquired: number }>(
      connection,
      "SELECT GET_LOCK(CONCAT(DATABASE(),':workflow-attachment-fields'),10) AS acquired",
    );
    if (Number(locks[0]?.acquired) !== 1) throw new Error('附件字段升级正在进行，请稍后重试');
    locked = true;
    const columns = await query<{ COLUMN_NAME: string }>(
      connection,
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='files' AND COLUMN_NAME='field_key'",
    );
    if (!columns.length) await connection.query('ALTER TABLE files ADD COLUMN field_key VARCHAR(40) NULL');
    const indexes = await query(
      connection,
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='files' AND INDEX_NAME='idx_file_field'",
    );
    if (!indexes.length)
      await connection.query('ALTER TABLE files ADD INDEX idx_file_field(activity_id,stage,field_key)');
    await connection.execute('INSERT IGNORE INTO schema_migrations(version) VALUES (7)');
  } finally {
    try {
      if (locked)
        await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':workflow-attachment-fields'))");
    } finally {
      connection.release();
    }
  }
}
