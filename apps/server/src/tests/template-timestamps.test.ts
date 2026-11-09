import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { seedConfig } from '@workflow/domain';
import { initialTemplates } from '../db/template-migration';
import { migrateTemplateTimestamps } from '../db/template-timestamp-migration';
import { loadTemplate, loadTemplates } from '../db/template-repository';

/** 构造可重复执行的迁移连接，模拟DDL已完成但迁移尚未登记的恢复场景。
 * @param hasColumn 是否已有创建时间列
 * @returns 连接池替身和实际写入语句
 */
function migrationDatabase(hasColumn = false) {
  const writes: string[] = [];
  let column = hasColumn;
  let applied = false;
  /** 返回元数据并登记实际迁移语句，未知读取立即报错。
   * @param sql 查询或迁移语句
   * @returns 驱动结果元组
   */
  async function execute(sql: string): Promise<[unknown[], unknown[]]> {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
    if (sql.includes('information_schema')) return [column ? [{ COLUMN_NAME: 'created_at' }] : [], []];
    if (sql.startsWith('SELECT version')) return [applied ? [{ version: 10 }] : [], []];
    writes.push(sql);
    if (sql.includes('ADD COLUMN created_at')) column = true;
    if (sql.includes('INSERT IGNORE INTO schema_migrations')) applied = true;
    return [[], []];
  }
  /** 记录DDL及解锁调用。
   * @param sql SQL语句
   * @returns 驱动结果
   */
  async function query(sql: string) {
    return execute(sql);
  }
  /** 释放测试连接，无外部副作用。 */
  function release(): void {}
  /** 提供同一个隔离迁移连接。
   * @returns 数据库连接协议替身
   */
  async function getConnection() {
    return { execute, query, release };
  }
  return { pool: { getConnection } as unknown as Pool, writes };
}

/** 旧模板先新增空值列，仅依据真实创建审计回填，重跑不会重复变更。 */
async function migrationCase(): Promise<void> {
  const { pool, writes } = migrationDatabase();
  await migrateTemplateTimestamps(pool);
  expect(writes[0]).toContain('ADD COLUMN created_at DATETIME(3) NULL DEFAULT NULL');
  const backfill = writes.find((sql) => sql.startsWith('UPDATE workflow_templates'))!;
  expect(backfill).toContain("WHERE action='创建流程模板'");
  expect(backfill).toContain('MIN(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP()),created_at))');
  expect(backfill).toContain('WHERE t.created_at IS NULL');
  expect(backfill).not.toContain('updated_at');
  const before = writes.filter((sql) => !sql.includes('RELEASE_LOCK')).length;
  await migrateTemplateTimestamps(pool);
  expect(writes.filter((sql) => !sql.includes('RELEASE_LOCK'))).toHaveLength(before);
}
test('模板时间迁移保留未知历史、仅回填真实创建记录，重复执行安全', migrationCase);

/** DDL已成功但后续失败时，重跑复用现有列完成回填及版本登记。 */
async function interruptedCase(): Promise<void> {
  const { pool, writes } = migrationDatabase(true);
  await migrateTemplateTimestamps(pool);
  expect(writes.some((sql) => sql.includes('ADD COLUMN'))).toBe(false);
  expect(writes.some((sql) => sql.startsWith('UPDATE workflow_templates'))).toBe(true);
  expect(writes.some((sql) => sql.includes('schema_migrations(version) VALUES (10)'))).toBe(true);
}
test('模板时间迁移支持DDL完成后的中断恢复', interruptedCase);

/** 单模板与模板库接口均返回相同创建、更新时间，未知旧创建时间返回空值。 */
async function repositoryCase(): Promise<void> {
  const definition = initialTemplates(seedConfig())[0]!.definition;
  const row = {
    id: 'wf-time',
    code: 'time',
    active: 1,
    current_version: 1,
    draft_revision: 1,
    draft: definition,
    published: definition,
    created_at: '2026-11-01 01:02:03.000',
    updated_at: '2026-11-09 04:05:06.000',
  };
  /** 返回真实字段形状，避免接口回退到前端生成时间。
   * @returns MySQL行结果
   */
  async function execute(): Promise<[unknown[], unknown[]]> {
    return [[row], []];
  }
  const db = { execute } as unknown as Pool;
  expect((await loadTemplates(db))[0]!.createdAt).toBe(row.created_at);
  expect((await loadTemplate(db, row.id))!.updatedAt).toBe(row.updated_at);
  Object.assign(row, { created_at: null });
  expect((await loadTemplate(db, row.id))!.createdAt).toBeNull();
}
test('模板列表及详情一致返回服务端时间，兼容未知历史创建时间', repositoryCase);
