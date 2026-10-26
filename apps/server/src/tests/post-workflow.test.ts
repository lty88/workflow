import { expect, test, vi } from 'vitest';
import type { Activity, CompanyConfig, ActionCommand, WorkflowNode, WorkflowTask } from '@workflow/domain';
import {
  activityActions,
  applyActivityAction,
  canCoordinateExecution,
  decideTask,
  finalApproval,
  hasEffectiveApproval,
  hasPermission,
  seedConfig,
  synchronizeWorkflowOwner,
} from '@workflow/domain';

/**
 * 构造部门初审、领导终审、后续任务和知会均完成的活动，节点顺序刻意打乱。
 * @returns 当前组织及完整活动实例
 */
function fixture() {
  const config = seedConfig();
  const now = new Date().toISOString();
  const head: WorkflowNode = {
    id: 'head',
    key: 'head',
    kind: 'approval',
    label: '部门初审',
    deps: [],
    status: 'completed',
    generation: 1,
    applicationRevision: 2,
    assignees: ['u-chen'],
    assigneeRule: { type: 'manager', value: '' },
  };
  const final: WorkflowNode = {
    id: 'final',
    key: 'final',
    kind: 'approval',
    label: '领导终审',
    deps: ['head'],
    status: 'completed',
    generation: 1,
    applicationRevision: 2,
    assignees: ['u-liu'],
    assigneeRule: { type: 'role', value: 'director' },
  };
  const task: WorkflowNode = {
    id: 'task',
    key: 'task',
    kind: 'task',
    label: '补充安排',
    deps: ['final'],
    status: 'completed',
    generation: 1,
    applicationRevision: 2,
    assignees: ['u-su'],
    assigneeRule: { type: 'user', value: 'u-su' },
  };
  const notice: WorkflowNode = {
    id: 'notice',
    key: 'notice',
    kind: 'notice',
    label: '知会协调人',
    deps: ['task'],
    status: 'completed',
    generation: 1,
    applicationRevision: 2,
    assignees: ['u-wang'],
    assigneeRule: { type: 'user', value: 'u-wang' },
  };
  const tasks: WorkflowTask[] = [
    {
      id: 't-head',
      activityId: 'handoff',
      nodeId: head.id,
      assignee: 'u-chen',
      generation: 1,
      status: 'approved',
      version: 1,
      comment: '',
      actedAt: '2026-10-26T01:00:00.000Z',
    },
    {
      id: 't-final',
      activityId: 'handoff',
      nodeId: final.id,
      assignee: 'u-liu',
      generation: 1,
      status: 'approved',
      version: 1,
      comment: '',
      actedAt: '2026-10-26T02:00:00.000Z',
    },
    {
      id: 't-task',
      activityId: 'handoff',
      nodeId: task.id,
      assignee: 'u-su',
      generation: 1,
      status: 'completed',
      version: 1,
      comment: '',
      actedAt: '2026-10-26T03:00:00.000Z',
    },
    {
      id: 't-notice',
      activityId: 'handoff',
      nodeId: notice.id,
      assignee: 'u-wang',
      generation: 1,
      status: 'completed',
      version: 1,
      comment: '',
      actedAt: '2026-10-26T04:00:00.000Z',
    },
  ];
  const activity: Activity = {
    id: 'handoff',
    code: 'HD-HANDOFF',
    name: '贵州教师阅读活动',
    applicant: 'u-lin',
    department: 'd1',
    status: 'ready_assign',
    version: 1,
    revision: 2,
    structureRevision: 1,
    configVersion: config.version,
    schema: config.form,
    payload: { start_at: '2026-01-01T00:00:00.000Z' },
    nodes: [notice, final, task, head],
    tasks,
    audit: [],
    snapshots: [],
    executor: '',
    assignment: '',
    actualStart: '',
    report: null,
    archive: null,
    archives: [],
    cancellation: null,
    createdAt: now,
    updatedAt: now,
  };
  return { config, activity, final, head };
}

/**
 * 通过真实领域状态机执行业务动作，保持版本与幂等参数完整。
 * @param config 当前测试组织
 * @param activity 事务内活动
 * @param actor 当前办理人
 * @param command 本次业务动作及补充参数
 */
function perform(
  config: CompanyConfig,
  activity: Activity,
  actor: string,
  command: Pick<ActionCommand, 'action'> & Partial<ActionCommand>,
): void {
  applyActivityAction(
    config,
    actor,
    activity,
    {
      expectedVersion: activity.version,
      idempotencyKey: crypto.randomUUID(),
      comment: '资料齐备，按流程办理',
      ...command,
    },
    true,
  );
}

/** 核对管理员和协调人不再接管有审批活动，只有实际终审人可指派且不能指派自己。 */
function assignmentCase(): void {
  const { config, activity } = fixture();
  expect(finalApproval(activity)?.task.assignee).toBe('u-liu');
  expect(hasPermission(config, 'u-liu', 'activity:assign')).toBe(false);
  expect(activityActions(config, 'u-liu', activity)).toContain('assign');
  for (const actor of ['u-admin', 'u-wang', 'u-chen', 'u-lin']) {
    expect(activityActions(config, actor, activity)).not.toContain('assign');
    expect(() => perform(config, activity, actor, { action: 'assign', executor: 'u-su' })).toThrow(
      '无此操作权限',
    );
  }
  expect(() => perform(config, activity, 'u-liu', { action: 'assign', executor: 'u-liu' })).toThrow(
    '请选择其他人员执行',
  );
  perform(config, activity, 'u-liu', { action: 'assign', executor: 'u-su' });
  expect(activity.status).toBe('ready_execute');
  expect(activity.executor).toBe('u-su');
  expect(activity.workflowOwnerId).toBe('u-liu');
}
test('实际终审人指派执行人，管理员与协调人不能代管且禁止指派自己', assignmentCase);

/** 核对执行人提交归档、终审人审核，退回后执行人补充重新提交而发起人无该入口。 */
function archiveLifecycleCase(): void {
  const { config, activity } = fixture();
  perform(config, activity, 'u-liu', { action: 'assign', executor: 'u-su' });
  activity.status = 'archive_draft';
  activity.report = {
    start: '2026-10-26T01:00:00.000Z',
    end: '2026-10-26T02:00:00.000Z',
    people: 40,
    summary: '完成教学研讨',
    spend: '100',
    exception: '',
  };
  expect(activityActions(config, 'u-su', activity)).toContain('archive-submit');
  expect(activityActions(config, 'u-lin', activity)).not.toContain('archive-submit');
  expect(() => perform(config, activity, 'u-lin', { action: 'archive-submit' })).toThrow('无此操作权限');
  perform(config, activity, 'u-su', { action: 'archive-submit' });
  expect(activity.archive?.submittedBy).toBe('u-su');
  expect(activity.archive?.reviewer).toBe('u-liu');
  expect(hasPermission(config, 'u-liu', 'archive:review')).toBe(false);
  expect(activityActions(config, 'u-liu', activity)).toContain('archive-approve');
  for (const actor of ['u-admin', 'u-he', 'u-su'])
    expect(activityActions(config, actor, activity)).not.toContain('archive-approve');
  perform(config, activity, 'u-liu', { action: 'archive-return', comment: '请补充课堂照片' });
  expect(activity.status).toBe('archive_draft');
  expect(activityActions(config, 'u-su', activity)).toContain('archive-submit');
  expect(activityActions(config, 'u-lin', activity)).not.toContain('archive-submit');
  perform(config, activity, 'u-su', { action: 'archive-submit' });
  expect(activity.archive?.version).toBe(2);
  perform(config, activity, 'u-liu', { action: 'archive-approve', checks: [true, true, true] });
  expect(activity.status).toBe('archived');
  expect(activity.archive?.reviewer).toBe('u-liu');
}
test('执行人提交与补充归档，终审本人复核，管理员和原归档岗位不代审', archiveLifecycleCase);

/** 核对旧主单读取时计算新责任，但已完成归档保持原审核人与历史原文。 */
function legacyArchiveCase(): void {
  const { activity } = fixture();
  activity.status = 'archive_review';
  activity.executor = 'u-su';
  activity.archive = {
    version: 1,
    summary: '原成果',
    url: '',
    submittedBy: 'u-lin',
    reviewer: 'u-admin',
    comment: '',
  };
  const source = structuredClone(activity);
  synchronizeWorkflowOwner(activity);
  expect(activity.workflowOwnerId).toBe('u-liu');
  expect(activity.archive.reviewer).toBe('u-liu');
  expect(source.archive?.reviewer).toBe('u-admin');
  activity.status = 'archived';
  activity.archive.reviewer = 'u-admin';
  synchronizeWorkflowOwner(activity);
  expect(activity.archive.reviewer).toBe('u-admin');
  expect(activity.audit).toEqual([]);
}
test('旧待归档主单只读兼容终审人，已归档审核人与历史记录不变', legacyArchiveCase);

/** 核对历史轮次、失效节点和不同代任务不会覆盖本次终审人。 */
function currentRevisionCase(): void {
  const { activity, final } = fixture();
  activity.nodes.push({ ...final, id: 'old', applicationRevision: 1 });
  activity.tasks.push({
    ...activity.tasks[1]!,
    id: 'future-old-task',
    nodeId: 'old',
    assignee: 'u-liu',
    actedAt: '2099-01-01T00:00:00.000Z',
  });
  expect(finalApproval(activity)?.node.id).toBe('final');
  activity.nodes.push({ ...final, id: 'invalid', status: 'invalidated' });
  activity.tasks.push({
    ...activity.tasks[1]!,
    id: 'future-invalid-task',
    nodeId: 'invalid',
    actedAt: '2099-01-01T00:00:00.000Z',
  });
  activity.tasks.push({
    ...activity.tasks[1]!,
    id: 'future-generation',
    generation: 0,
    actedAt: '2099-01-01T00:00:00.000Z',
  });
  expect(finalApproval(activity)?.node.id).toBe('final');
}
test('终审责任排除历史申请、失效节点与过期代数，后续任务知会不覆盖', currentRevisionCase);

/** 核对会签同毫秒完成时仍锁定实际最后办理人，后续读取不受任务排序影响。 */
function countersignCase(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T02:00:00.000Z'));
  try {
    const { config, activity, final } = fixture();
    activity.status = 'approving';
    final.status = 'active';
    final.assignees.push('u-zhao');
    const last: WorkflowTask = {
      ...activity.tasks[1]!,
      id: 'a-last',
      assignee: 'u-zhao',
      status: 'pending',
      actedAt: undefined,
      delegated: true,
    };
    activity.tasks.push(last);
    decideTask(config, 'u-zhao', activity, last.id, {
      expectedTaskVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      decision: 'approve',
      comment: '',
    });
    expect(activity.status).toBe('ready_assign');
    expect(activity.workflowOwnerId).toBe('u-zhao');
    activity.tasks.reverse();
    synchronizeWorkflowOwner(activity);
    expect(activity.workflowOwnerId).toBe('u-zhao');
  } finally {
    vi.useRealTimers();
  }
}
test('会签以最后实际通过人员为负责人，同毫秒审批也保持稳定', countersignCase);

/** 核对无审批模板保留协调岗位兼容，有审批但缺记录时不能回落管理员。 */
function noApprovalCase(): void {
  const { config, activity } = fixture();
  activity.nodes = activity.nodes.filter(
    /**
     * 保留无审批的任务与知会节点。
     * @param node 流程节点
     * @returns 是否非审批节点
     */
    (node) => node.kind !== 'approval',
  );
  expect(hasEffectiveApproval(activity)).toBe(false);
  expect(canCoordinateExecution(config, 'u-wang', activity)).toBe(true);
  const broken = fixture().activity;
  broken.tasks = [];
  expect(hasEffectiveApproval(broken)).toBe(true);
  expect(canCoordinateExecution(config, 'u-wang', broken)).toBe(false);
}
test('无审批模板继续由协调岗位指派，审批记录缺失不会退回管理员', noApprovalCase);

/** 核对终审人撤权或停用后无法沿用旧责任记录继续办理。 */
function revocationCase(): void {
  const { config, activity } = fixture();
  expect(canCoordinateExecution(config, 'u-liu', activity)).toBe(true);
  const member = config.users.find(
    /**
     * 找到实际终审办理人以撤回其资格。
     * @param user 当前组织成员
     * @returns 是否终审人
     */
    (user) => user.id === 'u-liu',
  )!;
  member.roles = [];
  expect(canCoordinateExecution(config, 'u-liu', activity)).toBe(false);
  member.roles = ['director'];
  member.active = false;
  expect(canCoordinateExecution(config, 'u-liu', activity)).toBe(false);
}
test('终审人角色撤销或账号停用后，指派资格实时收回', revocationCase);

/** 核对审批后还有办理任务时，最后审批人的责任仍按实际操作记录保留，不被同毫秒任务排序覆盖。 */
function approvalBeforeTaskCase(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T02:00:00.000Z'));
  try {
    const { config, activity, final } = fixture();
    activity.status = 'approving';
    final.status = 'active';
    final.assignees.push('u-zhao');
    const last: WorkflowTask = {
      ...activity.tasks[1]!,
      id: 'a-last',
      assignee: 'u-zhao',
      status: 'pending',
      actedAt: undefined,
      delegated: true,
    };
    activity.tasks.push(last);
    const followingNode = activity.nodes.find(
      /**
       * 取审批之后的执行准备任务。
       * @param node 流程节点
       * @returns 是否后续任务
       */
      (node) => node.id === 'task',
    )!;
    followingNode.status = 'active';
    const followingTask = activity.tasks.find(
      /**
       * 定位执行准备任务的个人待办。
       * @param task 个人任务
       * @returns 是否后续任务
       */
      (task) => task.nodeId === followingNode.id,
    )!;
    followingTask.status = 'pending';
    decideTask(config, 'u-zhao', activity, last.id, {
      expectedTaskVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      decision: 'approve',
      comment: '',
    });
    expect(activity.status).toBe('approving');
    expect(activity.lastApprovalTaskId).toBe(last.id);
    expect(activity.workflowOwnerId).toBeUndefined();
    decideTask(config, 'u-su', activity, followingTask.id, {
      expectedTaskVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      decision: 'approve',
      comment: '',
    });
    expect(activity.status).toBe('ready_assign');
    expect(activity.workflowOwnerId).toBe('u-zhao');
  } finally {
    vi.useRealTimers();
  }
}
test('审批后还有任务时仍保留真实最后审批人，不受同毫秒记录顺序影响', approvalBeforeTaskCase);
