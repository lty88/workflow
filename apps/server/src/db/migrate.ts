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
    console.info('流程模板、数据权限、活动评价及领导看板迁移完成；现有账号密码和活动历史均保留。');
  } finally {
    await pool.end();
  }
}
await migrate();
