import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import {
  activityActions,
  activityDeleteSchema,
  canDeleteActivity,
  canReadActivity,
  configSchema,
  seedConfig,
  validateConfig,
  withActivityDeletion,
} from '@workflow/domain';
import type { Activity } from '@workflow/domain';
import { deleteActivity } from '../services/activity-deletion-service';
import { loadActivity } from '../db/repository';
import { buildApp } from '../app';
import { readEnv } from '../env';

/**
 * 构造含真实待办和流程依赖的活动，验证删除后的流程终止及数据保留。
 * @param status 当前业务状态
 * @returns 可供删除边界校验的完整活动
 */
function fixture(status: Activity['status'] = 'draft'): Activity {
  return {
    id: 'a-delete',
    code: 'HD-DELETE',
    applicant: 'u-lin',
    department: 'd1',
    name: '待删除测试活动',
    status,
    version: 2,
    structureRevision: 1,
    revision: 1,
    configVersion: 1,
    schema: seedConfig().form,
    payload: { activity_name: '待删除测试活动' },
    snapshots: [],
    nodes: [
      {
        id: 'node-1',
        key: 'n-1',
        label: '部门审核',
        kind: 'approval',
        deps: [],
        assignees: ['u-chen'],
        assigneeRule: { type: 'manager', value: '' },
        status: 'active',
        generation: 1,
      },
    ],
    tasks: [
      {
        id: 'task-1',
        activityId: 'a-delete',
        nodeId: 'node-1',
        assignee: 'u-chen',
        generation: 1,
        status: 'pending',
        version: 1,
        comment: '',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
    audit: [],
    executor: 'u-su',
    assignment: '',
    actualStart: '',
    report: null,
    archive: null,
    archives: [],
    cancellation: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/** 核对发起者仅能删除本人未在办理的活动，管理员可删除全部状态。 */
function policyCase(): void {
  const config = withActivityDeletion(seedConfig());
  for (const status of ['draft', 'needs_info', 'withdrawn', 'rejected', 'cancelled'] as const) {
    const activity = fixture(status);
    expect(canDeleteActivity(config, 'u-lin', activity)).toBe(true);
    expect(canDeleteActivity(config, 'u-qiao', activity)).toBe(false);
    expect(activityActions(config, 'u-lin', activity)).toContain('delete');
  }
  for (const status of [
    'approving',
    'ready_assign',
    'ready_execute',
    'executing',
    'archive_draft',
    'archive_review',
    'archived',
    'completed',
    'cancel_review',
  ] as const) {
    const activity = fixture(status);
    expect(canDeleteActivity(config, 'u-lin', activity)).toBe(false);
    expect(canDeleteActivity(config, 'u-admin', activity)).toBe(true);
  }
  expect(canDeleteActivity(config, 'u-chen', fixture())).toBe(false);
  config.users.find((user) => user.id === 'u-admin')!.active = false;
  expect(canDeleteActivity(config, 'u-admin', fixture())).toBe(false);
}
test('管理员、发起者及他人删除资格按状态和身份严格区分', policyCase);

/** 核对权限迁移幂等、保留敏感权限，并检查删除原因与版本校验。 */
function configurationCase(): void {
  const original = seedConfig();
  const before = JSON.stringify(original);
  const config = withActivityDeletion(original);
  expect(JSON.stringify(original)).toBe(before);
  expect(withActivityDeletion(config)).toEqual(config);
  expect(configSchema.safeParse(config).success).toBe(true);
  expect(validateConfig(config)).toEqual([]);
  const role = config.roles.find((item) => item.id === 'activity-deletion-admin')!;
  expect(role.permissions).toEqual(['activity:read', 'activity:delete:any']);
  for (const reason of ['', '   ', '\n\t'])
    expect(
      activityDeleteSchema.safeParse({ reason, expectedVersion: 1, idempotencyKey: 'request-key-123456' })
        .success,
    ).toBe(false);
  expect(
    activityDeleteSchema.safeParse({
      reason: '重复创建的测试活动',
      expectedVersion: 2,
      idempotencyKey: 'request-key-123456',
    }).success,
  ).toBe(true);
  expect(
    activityDeleteSchema.safeParse({
      reason: '重复创建的测试活动',
      expectedVersion: 0,
      idempotencyKey: 'request-key-123456',
    }).success,
  ).toBe(false);
}
test('删除权限配置可重复迁移，原因及版本必须有效', configurationCase);

/** 核对任意删除权限无法与另一个全公司读取角色拼接扩大范围。 */
function scopeCase(): void {
  const config = withActivityDeletion(seedConfig());
  config.roles.push(
    {
      id: 'department-delete',
      name: '部门删除',
      scope: 'department',
      permissions: ['activity:read', 'activity:delete:any'],
      pages: [],
    },
    { id: 'read-all', name: '公司查看', scope: 'all', permissions: ['activity:read'], pages: [] },
  );
  config.users.find((user) => user.id === 'u-du')!.roles.push('department-delete', 'read-all');
  expect(canReadActivity(config, 'u-du', fixture())).toBe(true);
  expect(canDeleteActivity(config, 'u-du', fixture())).toBe(false);
}
test('删除权限与同角色数据范围绑定，阻止跨部门越权', scopeCase);

/**
 * 构造支持事务回滚的内存仓储，记录删除SQL，避免使用真实业务数据做删除校验。
 * @param status 初始活动状态
 * @returns 内存连接池、状态读取与可控失败能力
 */
function memoryPool(status: Activity['status'] = 'approving') {
  const config = withActivityDeletion(seedConfig());
  let activity = fixture(status);
  let marked = false;
  let response: unknown = null;
  let hash = '';
  let reserved = false;
  let committed = 0;
  let failure = false;
  let surveyActive = true;
  let snapshot: {
    activity: Activity;
    marked: boolean;
    response: unknown;
    hash: string;
    reserved: boolean;
    surveyActive: boolean;
  };
  const statements: string[] = [];
  /**
   * 根据SQL读取或更新内存主单、待办、评价开关与幂等记录。
   * @param sql 当前SQL
   * @param params 参数值
   * @returns MySQL驱动形状的结果
   */
  async function execute(sql: string, params: unknown[] = []): Promise<[unknown, unknown[]]> {
    statements.push(sql);
    if (sql.includes('FROM sessions')) return [[{ member_id: 'u-admin', csrf_token: 'b'.repeat(64) }], []];
    if (sql.includes('FROM configuration'))
      return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
    if (sql.startsWith('INSERT IGNORE INTO idempotency_records')) {
      if (reserved) return [{ affectedRows: 0 }, []];
      reserved = true;
      hash = String(params[2]);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('SELECT request_hash,response')) return [[{ request_hash: hash, response }], []];
    if (sql.includes('FROM activities')) return [marked ? [] : [{ data: structuredClone(activity) }], []];
    if (sql.includes('FROM execution_records')) return [[], []];
    if (sql.includes('FROM workflow_nodes')) return [activity.nodes.map((node) => ({ data: node })), []];
    if (sql.includes('FROM workflow_tasks')) return [activity.tasks.map((task) => ({ data: task })), []];
    if (sql.includes('FROM audit_events')) return [activity.audit.map((event) => ({ data: event })), []];
    if (sql.startsWith('UPDATE activities SET department_id')) {
      const stored = JSON.parse(String(params[3])) as Activity;
      activity = { ...stored, nodes: activity.nodes, tasks: activity.tasks, audit: activity.audit };
    }
    if (sql.startsWith('INSERT INTO workflow_nodes')) {
      const node = JSON.parse(String(params[5]));
      activity.nodes = [node];
    }
    if (sql.startsWith('INSERT INTO workflow_tasks')) {
      const task = JSON.parse(String(params[7]));
      activity.tasks = [task];
    }
    if (sql.startsWith('INSERT IGNORE INTO audit_events')) activity.audit.push(JSON.parse(String(params[4])));
    if (sql.startsWith('UPDATE activities SET deleted_at')) marked = true;
    if (sql.startsWith('UPDATE activity_surveys')) {
      if (failure) throw new Error('模拟评价关闭失败');
      surveyActive = false;
    }
    if (sql.startsWith('UPDATE idempotency_records SET response')) response = JSON.parse(String(params[0]));
    return [{ affectedRows: 1 }, []];
  }
  /** 开始内存事务，保留回滚所需的业务和幂等状态。 */
  async function beginTransaction(): Promise<void> {
    snapshot = structuredClone({ activity, marked, response, hash, reserved, surveyActive });
  }
  /** 提交内存事务并累计成功次数。 */
  async function commit(): Promise<void> {
    committed += 1;
  }
  /** 回滚全部业务和幂等变更，模拟数据库原子性。 */
  async function rollback(): Promise<void> {
    ({ activity, marked, response, hash, reserved, surveyActive } = snapshot);
  }
  /** 释放内存连接，不访问外部服务。 */
  function release(): void {}
  /**
   * 获取本次内存事务连接。
   * @returns 可查询及提交回滚的连接
   */
  async function getConnection() {
    return { execute, beginTransaction, commit, rollback, release };
  }
  /**
   * 读取当前内存状态供权限、删除结果和回滚断言使用。
   * @returns 主单、开关、提交次数与SQL记录
   */
  function state() {
    return { activity: structuredClone(activity), marked, surveyActive, committed, statements };
  }
  /** 模拟评价关闭时的数据库错误，核对整笔删除事务回滚。 */
  function failSurvey(): void {
    failure = true;
  }
  return { pool: { execute, getConnection } as unknown as Pool, state, failSurvey };
}

/** 核对管理员删除会停止待办和公开问卷，重复提交不重复删除，也不会物理清空主单或附件。 */
async function deletionCase(): Promise<void> {
  const memory = memoryPool();
  const input = { expectedVersion: 2, reason: '重复创建的测试活动', idempotencyKey: 'delete-request-123456' };
  expect(await deleteActivity(memory.pool, 'u-admin', 'a-delete', input)).toEqual({
    id: 'a-delete',
    deleted: true,
  });
  const state = memory.state();
  expect(state.marked).toBe(true);
  expect(state.activity.version).toBe(3);
  expect(state.activity.deleted?.by).toBe('u-admin');
  expect(state.activity.tasks[0].status).toBe('cancelled');
  expect(state.activity.nodes[0].status).toBe('invalidated');
  expect(state.surveyActive).toBe(false);
  expect(state.activity.audit.some((item) => item.action === '删除活动')).toBe(true);
  expect(
    state.statements.some((sql) =>
      /^DELETE FROM (activities|files|workflow_nodes|workflow_tasks|activity_evaluations)\b/.test(sql),
    ),
  ).toBe(false);
  expect(await deleteActivity(memory.pool, 'u-admin', 'a-delete', input)).toEqual({
    id: 'a-delete',
    deleted: true,
  });
  expect(memory.state().activity.version).toBe(3);
  expect(await loadActivity(memory.pool, 'a-delete')).toBeNull();
}
test('删除使用事务停止流程并关闭评价，保留历史且重试幂等', deletionCase);

/** 核对状态变化、他人删除、过期版本及中途异常均不产生部分删除。 */
async function rejectionCase(): Promise<void> {
  const input = { expectedVersion: 2, reason: '重复创建的测试活动', idempotencyKey: 'delete-request-123456' };
  const own = memoryPool();
  await expect(deleteActivity(own.pool, 'u-lin', 'a-delete', input)).rejects.toMatchObject({
    code: 'DELETE_FORBIDDEN',
  });
  expect(own.state().marked).toBe(false);
  const stale = memoryPool('draft');
  await expect(
    deleteActivity(stale.pool, 'u-lin', 'a-delete', { ...input, expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  expect(stale.state().activity.version).toBe(2);
  const other = memoryPool('draft');
  await expect(deleteActivity(other.pool, 'u-qiao', 'a-delete', input)).rejects.toMatchObject({
    code: 'DELETE_FORBIDDEN',
  });
  const failing = memoryPool();
  failing.failSurvey();
  await expect(deleteActivity(failing.pool, 'u-admin', 'a-delete', input)).rejects.toThrow(
    '模拟评价关闭失败',
  );
  expect(failing.state().marked).toBe(false);
  expect(failing.state().activity.deleted).toBeUndefined();
  expect(failing.state().activity.tasks[0].status).toBe('pending');
  expect(failing.state().surveyActive).toBe(true);
}
test('越权、状态冲突、过期版本及中途失败均拒绝或整体回滚', rejectionCase);

/** 核对删除接口必须通过登录、CSRF和参数校验，成功后支持幂等重试。 */
async function deletionHttpCase(): Promise<void> {
  const memory = memoryPool('draft');
  const app = await buildApp(memory.pool, readEnv({ NODE_ENV: 'test', MYSQL_PASSWORD: 'unused' }));
  const url = '/api/activities/a-delete';
  const payload = {
    expectedVersion: 2,
    reason: '重复创建的测试活动',
    idempotencyKey: 'delete-request-123456',
  };
  const cookie = 'workflow_session=' + 'a'.repeat(64);
  try {
    expect((await app.inject({ method: 'DELETE', url, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url, headers: { cookie }, payload })).statusCode).toBe(403);
    const headers = { cookie, 'x-csrf-token': 'b'.repeat(64) };
    expect(
      (await app.inject({ method: 'DELETE', url, headers, payload: { ...payload, reason: '' } })).statusCode,
    ).toBe(422);
    expect((await app.inject({ method: 'DELETE', url, headers, payload })).json()).toEqual({
      id: 'a-delete',
      deleted: true,
    });
    expect((await app.inject({ method: 'DELETE', url, headers, payload })).json()).toEqual({
      id: 'a-delete',
      deleted: true,
    });
  } finally {
    await app.close();
  }
}
test('删除接口必须登录并校验CSRF、原因和幂等重试', deletionHttpCase);
