import type { Pool } from 'mysql2/promise';
import { loadConfig, query } from './repository';

/** 启动监听端口前读取项目配置、模板与活动评价迁移版本，缺少结构时给出显式迁移步骤。
 * @param pool 项目数据库连接池
 */
export async function requireDatabaseReady(pool: Pool): Promise<void> {
  try {
    await loadConfig(pool);
  } catch {
    throw new Error(
      '数据库连接或初始化未完成。使用本机MySQL请先运行 pnpm db:setup，再运行 pnpm db:init；已有数据库请检查.env连接配置。初始化成功后再启动服务。',
    );
  }
  const versions = await query<{ version: number }>(
    pool,
    'SELECT version FROM schema_migrations WHERE version IN (2,4,5)',
  );
  if (
    !versions.some(
      /** 判断模板增量迁移是否完成。
       * @param row 已执行的迁移记录
       * @returns 是否已应用第二版结构
       */ function applied(row) {
        return row.version === 2;
      },
    )
  )
    throw new Error(
      '数据库需升级多流程模板结构，请先运行 pnpm db:migrate，再启动服务。已有账号密码和活动历史会保留。',
    );
  /**
   * 检查活动评价及领导看板迁移，避免服务启动后才发现缺少数据表。
   * @param row 已执行迁移记录
   * @returns 是否已安装第四版结构
   */
  function insightsApplied(row: { version: number }): boolean {
    return row.version === 4;
  }
  if (!versions.some(insightsApplied))
    throw new Error('数据库需升级活动评价与领导看板，请先运行 pnpm db:migrate，再启动服务。');
  /**
   * 判断活动逻辑删除字段和权限迁移是否已安装。
   * @param row 已安装迁移记录
   * @returns 是否具备第五版结构
   */
  function deletionApplied(row: { version: number }): boolean {
    return row.version === 5;
  }
  if (!versions.some(deletionApplied))
    throw new Error('数据库需升级活动删除功能，请先运行 pnpm db:migrate，再启动服务。');
}
