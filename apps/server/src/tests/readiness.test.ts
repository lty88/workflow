import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { seedConfig } from '@workflow/domain';
import { requireDatabaseReady } from '../db/readiness';

/** 检查数据库不可用时启动检查提供配置与初始化命令，而不依赖端口监听。
 */
async function missingDatabaseCase(): Promise<void> {
  /** 模拟数据库连接失败。
   * @returns 被拒绝的数据库查询
   */
  async function execute(): Promise<never> {
    throw new Error('connection refused');
  }
  await expect(requireDatabaseReady({ execute } as unknown as Pool)).rejects.toThrow('pnpm db:setup');
}
test('启动检查在数据库未就绪时明确提示配置和初始化步骤', missingDatabaseCase);

/** 检查已初始化数据库可通过启动前校验，无需启动HTTP应用。
 */
async function readyDatabaseCase(): Promise<void> {
  /** 模拟读取已发布的业务配置与已完成的模板迁移。
   * @param sql 查询语句
   * @returns 配置查询结果
   */
  async function execute(sql: string): Promise<[unknown[], unknown[]]> {
    if (sql.includes('schema_migrations')) return [[{ version: 2 }, { version: 4 }, { version: 5 }], []];
    const config = seedConfig();
    return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
  }
  await expect(requireDatabaseReady({ execute } as unknown as Pool)).resolves.toBeUndefined();
}
test('已初始化项目数据库通过启动前检查', readyDatabaseCase);

/** 检查旧数据库缺少模板迁移时明确提示增量升级，而不启动服务或修改数据库。 */
async function pendingTemplateMigrationCase(): Promise<void> {
  /**
   * 模拟存在公司配置但没有第二版迁移记录的旧数据库。
   * @param sql 查询语句
   * @returns 模拟查询结果
   */
  async function execute(sql: string): Promise<[unknown[], unknown[]]> {
    if (sql.includes('schema_migrations')) return [[], []];
    const config = seedConfig();
    return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
  }
  await expect(requireDatabaseReady({ execute } as unknown as Pool)).rejects.toThrow('pnpm db:migrate');
}
test('旧数据库缺少模板迁移时提示显式增量升级', pendingTemplateMigrationCase);

/** 检查已有模板但未安装活动评价的数据库会给出明确迁移步骤。 */
async function pendingInsightsCase(): Promise<void> {
  /**
   * 模拟仅安装旧版模板表的数据库。
   * @param sql 当前查询语句
   * @returns 旧版迁移记录与公司配置
   */
  async function execute(sql: string): Promise<[unknown[], unknown[]]> {
    if (sql.includes('schema_migrations')) return [[{ version: 2 }], []];
    const config = seedConfig();
    return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
  }
  await expect(requireDatabaseReady({ execute } as unknown as Pool)).rejects.toThrow('活动评价与领导看板');
}
test('旧库缺少评价看板表时提示显式迁移', pendingInsightsCase);

/** 检查数据库缺少逻辑删除字段时提示迁移，不启动项目或自动删除活动。 */
async function pendingDeletionCase(): Promise<void> {
  /**
   * 模拟已安装模板与评价但没有删除功能的旧数据库。
   * @param sql 当前查询
   * @returns 模拟配置和迁移记录
   */
  async function execute(sql: string): Promise<[unknown[], unknown[]]> {
    if (sql.includes('schema_migrations')) return [[{ version: 2 }, { version: 4 }], []];
    const config = seedConfig();
    return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
  }
  await expect(requireDatabaseReady({ execute } as unknown as Pool)).rejects.toThrow('活动删除功能');
}
test('旧库缺少逻辑删除字段时给出明确迁移提示', pendingDeletionCase);
