import type { Pool } from 'mysql2/promise';
import { loadConfig, query } from './repository';

/** 启动监听端口前读取项目配置及模板、资料权限、活动评价和删除迁移版本与必要附件字段，缺少结构时给出显式迁移步骤。
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
    'SELECT version FROM schema_migrations WHERE version IN (2,3,4,5,6,7,8)',
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
   * 检查资料权限迁移，避免保存草稿后因详情附件查询缺列而报错。
   * @param row 已执行的迁移记录
   * @returns 是否已安装第三版结构
   */
  function securityApplied(row: { version: number }): boolean {
    return row.version === 3;
  }
  if (!versions.some(securityApplied))
    throw new Error('数据库需升级活动资料权限，请先运行 pnpm db:migrate，再启动服务。已有草稿和附件会保留。');
  const columns = await query<{ COLUMN_NAME: string }>(
    pool,
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='files' AND COLUMN_NAME IN ('node_id','access_rule','download_rule')",
  );
  const names = new Set(columns.map(columnName));
  /**
   * 提取数据库实际列名，检查迁移记录和真实表结构是否一致。
   * @param column 字段元数据
   * @returns 字段名称
   */
  function columnName(column: { COLUMN_NAME: string }): string {
    return column.COLUMN_NAME;
  }
  if (!['node_id', 'access_rule', 'download_rule'].every(hasColumn))
    throw new Error('附件权限字段不完整，请运行 pnpm db:migrate 修复后再启动服务。');
  /**
   * 判断必要附件权限列是否真实存在。
   * @param name 必要列名
   * @returns 是否存在
   */
  function hasColumn(name: string): boolean {
    return names.has(name);
  }
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
  if (
    !versions.some(
      /** 核对主数据独立保存迁移。
       * @param row 迁移记录
       * @returns 是否已安装第六版
       */ function masterApplied(row) {
        return row.version === 6;
      },
    )
  )
    throw new Error('数据库需升级主数据独立保存结构，请先运行 pnpm db:migrate，再启动服务。');
  const attachmentColumns = await query(
    pool,
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='files' AND COLUMN_NAME='field_key'",
  );
  if (
    !versions.some(
      /** 核对附件字段迁移登记。
       * @param row 迁移记录
       * @returns 是否安装第七版
       */ function attachmentsApplied(row) {
        return row.version === 7;
      },
    ) ||
    !attachmentColumns.length
  )
    throw new Error('数据库需升级动态表单附件字段，请先运行 pnpm db:migrate，再启动服务。');
  const executionTables = await query(
    pool,
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='execution_records'",
  );
  if (!executionTables.length)
    throw new Error('数据库需升级执行记录表，请先运行 pnpm db:migrate，再启动服务。');
  const executionColumns = await query(
    pool,
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='files' AND COLUMN_NAME IN ('context_id','action_key')",
  );
  if (!versions.some((row) => row.version === 8) || executionColumns.length !== 2)
    throw new Error('数据库需升级执行记录与业务表单附件，请先运行 pnpm db:migrate，再启动服务。');
}
