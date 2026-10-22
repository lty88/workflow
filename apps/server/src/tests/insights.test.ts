import { expect, test } from 'vitest';
import {
  configSchema,
  dashboardFilterSchema,
  emptyEvaluationSummary,
  evaluationAllowed,
  evaluationEligible,
  evaluationInputSchema,
  seedConfig,
  validateConfig,
  withActivityInsights,
} from '@workflow/domain';
import type { Activity } from '@workflow/domain';
import { activityScopeWhere } from '../services/list-service';

/**
 * 构造执行结束的最小活动，用于检查评价窗口与岗位范围。
 * @param status 活动状态
 * @returns 具备完整判断字段的活动样本
 */
function completedActivity(status: Activity['status'] = 'archive_draft'): Activity {
  return {
    id: 'activity-test',
    code: 'HD-TEST',
    name: '评价样本',
    status,
    applicant: 'u-lin',
    department: 'd1',
    nodes: [],
    executor: 'u-su',
    report: {
      start: '2026-01-02T10:00:00Z',
      end: '2026-01-02T12:00:00Z',
      people: 30,
      summary: '活动完成',
      spend: '',
      exception: '',
    },
    version: 1,
    structureRevision: 1,
    revision: 1,
    configVersion: 1,
    schema: seedConfig().form,
    payload: {},
    snapshots: [],
    tasks: [],
    audit: [],
    assignment: '',
    actualStart: '',
    archive: null,
    archives: [],
    cancellation: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T12:00:00Z',
  };
}

/** 核对执行完成到归档全阶段可评价，未完成、取消和未来结束时间均不可评价。 */
function eligibilityCase(): void {
  for (const status of ['archive_draft', 'archive_review', 'archived'] as const)
    expect(evaluationEligible(completedActivity(status))).toBe(true);
  for (const status of [
    'draft',
    'approving',
    'ready_execute',
    'executing',
    'cancelled',
    'cancel_review',
    'rejected',
  ] as const)
    expect(evaluationEligible(completedActivity(status))).toBe(false);
  const activity = completedActivity();
  activity.report!.end = '2099-01-01T00:00:00Z';
  expect(evaluationEligible(activity)).toBe(false);
  activity.report = null;
  expect(evaluationEligible(activity)).toBe(false);
}
test('评价仅在执行汇报完成且结束时间有效时开放', eligibilityCase);

/** 核对匿名评分字段、分数范围、长度限制及空样本展示口径。 */
function validationCase(): void {
  const input = {
    overall: 5,
    content: 4,
    organization: 3,
    usefulness: 5,
    comment: '很有帮助',
  };
  expect(evaluationInputSchema.safeParse(input).success).toBe(true);
  for (const overall of [0, 6, 4.5])
    expect(evaluationInputSchema.safeParse({ ...input, overall }).success).toBe(false);
  expect(evaluationInputSchema.safeParse({ ...input, comment: '字'.repeat(1001) }).success).toBe(false);
  expect(evaluationInputSchema.safeParse({ ...input, phone: '123' }).success).toBe(false);
  expect(emptyEvaluationSummary().average).toBeNull();
  expect(emptyEvaluationSummary().satisfaction).toBeNull();
}
test('评分严格校验四维五星范围且不接收个人联系方式字段', validationCase);

/** 核对日期顺序、真实日历日期和单次查询跨度限制。 */
function datesCase(): void {
  expect(dashboardFilterSchema.safeParse({ start: '2026-01-01', end: '2026-12-31' }).success).toBe(true);
  for (const range of [
    { start: '2026-02-30', end: '2026-03-01' },
    { start: '2026-05-01', end: '2026-04-01' },
    { start: '2025-01-01', end: '2026-12-31' },
  ])
    expect(dashboardFilterSchema.safeParse(range).success).toBe(false);
}
test('领导看板拒绝无效、倒置和超过一年范围的日期', datesCase);

/** 核对权限与菜单迁移幂等、敏感授权不扩大且部门看板范围仍受本部门约束。 */
function configurationCase(): void {
  const original = seedConfig();
  const before = JSON.stringify(original);
  const config = withActivityInsights(original);
  expect(JSON.stringify(original)).toBe(before);
  expect(configSchema.safeParse(config).success).toBe(true);
  expect(validateConfig(config)).toEqual([]);
  expect(withActivityInsights(config)).toEqual(config);
  const leadership = config.roles.find((role) => role.id === 'leadership-insights')!;
  expect(leadership.permissions).toEqual(['dashboard:read']);
  const scope = activityScopeWhere(config, 'u-chen', 'dashboard:read');
  expect(scope.sql).toContain('department_id=?');
  expect(scope.params).toEqual(['d1']);
  expect(activityScopeWhere(config, 'u-admin', 'dashboard:read').sql).toBe('1=1');
  for (const role of config.roles) expect(role.permissions.includes('activity:sensitive:read')).toBe(false);
}
test('看板迁移保留既有权限范围且不自动授予敏感资料阅读', configurationCase);

/** 核对申请人能管理本人活动，跨部门申请和多角色叠加均不能突破评价授权。 */
function evaluationScopeCase(): void {
  const config = withActivityInsights(seedConfig());
  const activity = completedActivity();
  expect(evaluationAllowed(config, 'u-lin', activity, 'evaluation:manage')).toBe(true);
  expect(evaluationAllowed(config, 'u-qiao', activity, 'evaluation:manage')).toBe(false);
  expect(evaluationAllowed(config, 'u-admin', activity, 'evaluation:read')).toBe(false);
  const extra = {
    id: 'misleading',
    name: '不关联的全公司读取',
    permissions: ['activity:read'] as const,
    scope: 'all' as const,
    pages: [],
  };
  config.roles.push({ ...extra, permissions: [...extra.permissions] });
  config.users.find((user) => user.id === 'u-qiao')!.roles.push(extra.id);
  expect(evaluationAllowed(config, 'u-qiao', activity, 'evaluation:manage')).toBe(false);
}
test('评价管理权限与同角色数据范围绑定，不因其他角色扩大', evaluationScopeCase);
