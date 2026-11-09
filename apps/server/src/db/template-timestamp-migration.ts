import type { Pool } from 'mysql2/promise';
import { query } from './repository';

/** 补充模板创建时间，仅从真实创建审计按数据库时区转换为UTC回填旧模板，缺少记录时保留空值。
 * @param pool 当前项目数据库连接池
 */
export async function migrateTemplateTimestamps(pool: Pool): Promise<void> {
  const db = await pool.getConnection();
  let locked = false;
  try {
    const lock = await query<{ acquired: number }>(
      db,
      "SELECT GET_LOCK(CONCAT(DATABASE(),':template-timestamps'),10) AS acquired",
    );
    if (Number(lock[0]?.acquired) !== 1) throw new Error('模板时间字段正在迁移，请稍后重试');
    locked = true;
    const columns = await query(
      db,
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='workflow_templates' AND COLUMN_NAME='created_at'",
    );
    const applied = await query(db, 'SELECT version FROM schema_migrations WHERE version=10');
    if (columns.length && applied.length) return;
    if (!columns.length)
      await db.query('ALTER TABLE workflow_templates ADD COLUMN created_at DATETIME(3) NULL DEFAULT NULL');
    await db.execute(`UPDATE workflow_templates t JOIN (
      SELECT JSON_UNQUOTE(JSON_EXTRACT(data,'$.templateId')) AS template_id, MIN(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),created_at)) AS created_at
      FROM audit_events WHERE action='创建流程模板' GROUP BY JSON_UNQUOTE(JSON_EXTRACT(data,'$.templateId'))
    ) a ON a.template_id=t.id SET t.created_at=a.created_at WHERE t.created_at IS NULL`);
    await db.query('ALTER TABLE workflow_templates MODIFY COLUMN created_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3)');
    await db.execute('INSERT IGNORE INTO schema_migrations(version) VALUES (10)');
  } finally {
    try {
      if (locked) await db.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':template-timestamps'))");
    } finally {
      db.release();
    }
  }
}
