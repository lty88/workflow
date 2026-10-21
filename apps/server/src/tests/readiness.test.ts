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
  async function execute(): Promise<never> { throw new Error('connection refused'); }
  await expect(requireDatabaseReady({ execute } as unknown as Pool)).rejects.toThrow('pnpm db:setup');
}
test('启动检查在数据库未就绪时明确提示配置和初始化步骤', missingDatabaseCase);

/** 检查已初始化数据库可通过启动前校验，无需启动HTTP应用。
 */
async function readyDatabaseCase(): Promise<void> {
  /** 模拟读取已发布的业务配置。
   * @returns 配置查询结果
   */
  async function execute(): Promise<[unknown[], unknown[]]> { const config = seedConfig(); return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []]; }
  await expect(requireDatabaseReady({ execute } as unknown as Pool)).resolves.toBeUndefined();
}
test('已初始化项目数据库通过启动前检查', readyDatabaseCase);
