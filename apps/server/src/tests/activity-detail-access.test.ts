import { expect, test } from 'vitest';
import { seedConfig } from '@workflow/domain';
import type { SessionProfile, WorkflowNode, WorkflowTask } from '@workflow/domain';
import type { WorkflowViewDetail } from '../../../web/src/components/activity/types';
import {
  canDecideWorkflowTask,
  canTransferWorkflowTask,
} from '../../../web/src/components/activity/workflow-task-access';

/** 构造并行审批中的个人待办和真实会话权限，校验底栏与节点入口共享的资格规则。
 * @returns 会话、活动进度、审批节点与当前个人任务
 */
function fixture() {
  const profile: SessionProfile = {
    user: {
      id: 'reviewer',
      name: '财务负责人',
      username: 'caiwu',
      department: 'finance',
      roles: ['reviewer'],
      active: true,
    },
    permissions: ['approval:decide', 'task:complete'],
    menus: [],
    groups: [],
    form: seedConfig().form,
    configVersion: 1,
    csrfToken: 'local-test',
  };
  const node: WorkflowNode = {
    id: 'finance',
    key: 'finance',
    label: '财务预算审核',
    kind: 'approval',
    deps: [],
    status: 'active',
    generation: 2,
    applicationRevision: 2,
    assignees: ['reviewer'],
    assigneeRule: { type: 'role', value: 'reviewer' },
  };
  const task: WorkflowTask = {
    id: 'personal-task',
    activityId: 'activity',
    nodeId: node.id,
    assignee: 'reviewer',
    generation: 2,
    status: 'pending',
    version: 1,
    comment: '',
  };
  const detail: WorkflowViewDetail = {
    activity: { applicant: 'applicant', status: 'approving', revision: 2, nodes: [node], tasks: [task] },
    actions: ['adjust'],
    participants: [{ id: 'reviewer', name: '财务负责人' }],
    taskWarnings: [],
  };
  return { profile, node, task, detail };
}

/** 核对本轮并行待办只向本人开放，旧轮次、已办任务和受理异常不会变成可点按钮。 */
function currentTaskCase(): void {
  const { detail, task, profile } = fixture();
  expect(canDecideWorkflowTask(detail, task, profile)).toBe(true);
  expect(canDecideWorkflowTask(detail, { ...task, assignee: 'other' }, profile)).toBe(false);
  expect(canDecideWorkflowTask(detail, { ...task, generation: 1 }, profile)).toBe(false);
  expect(canDecideWorkflowTask(detail, { ...task, status: 'approved' }, profile)).toBe(false);
  detail.taskWarnings = [{ taskId: task.id, message: '受理部门已停用' }];
  expect(canDecideWorkflowTask(detail, task, profile)).toBe(false);
  expect(canTransferWorkflowTask(detail, task)).toBe(true);
}
test('当前任务归属与轮次隔离，异常待办保留协调人转交入口', currentTaskCase);

/** 核对丢失角色后不可继续原角色任务，正式转交后仍必须具有节点操作权限。 */
function delegatedTaskCase(): void {
  const { detail, task, profile } = fixture();
  profile.user.roles = [];
  expect(canDecideWorkflowTask(detail, task, profile)).toBe(false);
  task.delegated = true;
  expect(canDecideWorkflowTask(detail, task, profile)).toBe(true);
  profile.permissions = [];
  expect(canDecideWorkflowTask(detail, task, profile)).toBe(false);
}
test('转交绕过原角色约束但不能绕过办理权限', delegatedTaskCase);

/** 核对申请人不能审批本人申请，自己的任务节点仍可完成，知会节点没有办理按钮。 */
function nodeKindCase(): void {
  const { detail, node, task, profile } = fixture();
  detail.activity.applicant = profile.user.id;
  expect(canDecideWorkflowTask(detail, task, profile)).toBe(false);
  node.kind = 'task';
  expect(canDecideWorkflowTask(detail, task, profile)).toBe(true);
  node.kind = 'notice';
  expect(canDecideWorkflowTask(detail, task, profile)).toBe(false);
}
test('审批自审拦截、个人任务与自动知会入口区分', nodeKindCase);

/** 核对活动停止办理、权限撤销或成员停用后，入口不沿用旧的待办授权。 */
function staleAuthorizationCase(): void {
  const { detail, task, profile } = fixture();
  profile.user.active = false;
  expect(canDecideWorkflowTask(detail, task, profile)).toBe(false);
  profile.user.active = true;
  detail.actions = [];
  expect(canTransferWorkflowTask(detail, task)).toBe(false);
  detail.actions = ['adjust'];
  detail.activity.status = 'needs_info';
  expect(canDecideWorkflowTask(detail, task, profile)).toBe(false);
  expect(canTransferWorkflowTask(detail, task)).toBe(false);
}
test('停用身份、失去调整权限和退回后的待办均不开放操作', staleAuthorizationCase);
