import { migrateAttachmentFields } from './attachment-field-migration';
import { migrateExecutionAttachments } from './execution-attachment-migration';
import { migrateMasterData } from './master-data-migration';
import { readEnv } from '../env';
import { createPool } from './repository';
import { migrateTemplates } from './template-migration';
import { migrateDataSecurity } from './security-migration';
import { migrateInsights } from './insights-migration';
import { migrateActivityDeletion } from './activity-deletion-migration';

/** 显式迁移已有数据库的模板、资料权限、评价和领导看板结构，输出结果并释放连接，保留现有账号密码和业务实例。 */
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
    console.info(
      '流程、资料权限、评价看板及主数据及第八版执行记录与业务附件迁移完成；组织、人员等设置保存即生效，现有密码和活动历史保留。',
    );
  } finally {
    await pool.end();
  }
}
await migrate();
