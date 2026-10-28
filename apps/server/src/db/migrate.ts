import { migrateRequests } from './request-migration';
import { migrateAttachmentFields } from './attachment-field-migration';
import { migrateExecutionAttachments } from './execution-attachment-migration';
import { migrateMasterData } from './master-data-migration';
import { readEnv } from '../env';
import { createPool } from './repository';
import { migrateTemplates } from './template-migration';
import { migrateDataSecurity } from './security-migration';
import { migrateInsights } from './insights-migration';
import { migrateActivityDeletion } from './activity-deletion-migration';

/** 显式迁移已有数据库的模板、资料权限、业务记录及通用申请结构，输出结果并释放连接，保留现有账号密码和业务实例。 */
async function migrate(): Promise<void> {
  const pool = createPool(readEnv());
  try {
    await migrateTemplates(pool);
    await migrateDataSecurity(pool);
    await migrateInsights(pool);
    await migrateActivityDeletion(pool);
    await migrateMasterData(pool);
    await migrateAttachmentFields(pool);
    await migrateExecutionAttachments(pool);
    await migrateRequests(pool);
    console.info(
      '数据库已升级至第九版通用申请结构；组织、人员设置保存即生效，现有密码和活动历史保留。',
    );
  } finally {
    await pool.end();
  }
}
await migrate();
