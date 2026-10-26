import type { Pool } from 'mysql2/promise';
import { query } from './repository';

/**
 * 增量加入业务表单附件分组与动作归属，建立独立执行记录表并扩展存储键以记录OSS路径；已有附件保持本地存储。
 * @param pool 项目数据库连接池
 */
export async function migrateExecutionAttachments(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const rows = await query<{ acquired: number }>(
      connection,
      "SELECT GET_LOCK(CONCAT(DATABASE(),':execution-attachments'),10) AS acquired",
    );
    if (Number(rows[0]?.acquired) !== 1) throw new Error('执行附件迁移正在进行，请稍后重试');
    locked = true;
    await connection.query(`CREATE TABLE IF NOT EXISTS execution_records (
  activity_id VARCHAR(80) NOT NULL, id VARCHAR(80) NOT NULL, author_id VARCHAR(80) NOT NULL,
  submitted_at DATETIME(3) NOT NULL, data JSON NOT NULL,
  PRIMARY KEY (activity_id,id), INDEX idx_execution_record_time(activity_id,submitted_at,id),
  FOREIGN KEY (activity_id) REFERENCES activities(id)
)`);
    const columns = await query<{ COLUMN_NAME: string }>(
      connection,
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='files'",
    );
    const names = new Set(columns.map((column) => column.COLUMN_NAME));
    if (!names.has('context_id'))
      await connection.query('ALTER TABLE files ADD COLUMN context_id VARCHAR(80) NULL');
    if (!names.has('action_key'))
      await connection.query('ALTER TABLE files ADD COLUMN action_key VARCHAR(40) NULL');
    const storageColumns = await query<{ CHARACTER_MAXIMUM_LENGTH: number }>(
      connection,
      "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='files' AND COLUMN_NAME='storage_key'",
    );
    if (Number(storageColumns[0]?.CHARACTER_MAXIMUM_LENGTH || 0) < 512)
      await connection.query('ALTER TABLE files MODIFY COLUMN storage_key VARCHAR(512) NOT NULL');
    const indexes = await query(
      connection,
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='files' AND INDEX_NAME='idx_file_context'",
    );
    if (!indexes.length)
      await connection.query('ALTER TABLE files ADD INDEX idx_file_context(activity_id,context_id)');
    await connection.execute('INSERT IGNORE INTO schema_migrations(version) VALUES (8)');
  } finally {
    try {
      if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':execution-attachments'))");
    } finally {
      connection.release();
    }
  }
}
