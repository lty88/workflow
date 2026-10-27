import { expect, test } from 'vitest';
import type { WorkflowNode, WorkflowTask } from '@workflow/domain';
import { nodeProgressStatus } from '../../../web/src/components/activity/workflow-progress';
import { runtimeGraph } from '../../../web/src/components/graph/models';
import { workflowSelectionStyle } from '../../../web/src/components/graph/workflow-node-theme';
import type { WorkflowViewDetail } from '../../../web/src/components/activity/types';

/** 构造退回后节点统一失效但个人任务仍保留真实意见的历史详情。
 * @param decision 触发审批结束的决定
 * @returns 进度图、源节点及其实际审批任务
 */
function fixture(decision: 'returned' | 'rejected') {
  const parent: WorkflowNode = {
    id: 'parent',
    key: 'review',
    label: '部门初审',
    kind: 'approval',
    deps: [],
    status: 'completed',
    generation: 1,
    applicationRevision: 2,
    assignees: ['manager'],
    assigneeRule: { type: 'user', value: 'manager' },
  };
  const source: WorkflowNode = {
    ...parent,
    id: 'source',
    key: 'academic',
    label: '教研方案审核',
    status: 'invalidated',
    deps: ['parent'],
    assignees: ['academic'],
  };
  const parallel: WorkflowNode = {
    ...source,
    id: 'parallel',
    key: 'finance',
    label: '财务预算审核',
    assignees: ['finance'],
  };
  const task: WorkflowTask = {
    id: 'task-source',
    activityId: 'activity',
    nodeId: source.id,
    assignee: 'academic',
    generation: 1,
    status: decision,
    version: 2,
    comment: '需补充活动方案的课程目标',
    actedAt: '2026-10-26T02:30:00Z',
  };
  const detail: WorkflowViewDetail = {
    activity: {
      status: decision === 'returned' ? 'needs_info' : 'rejected',
      revision: 2,
      nodes: [parent, source, parallel],
      tasks: [
        task,
        {
          ...task,
          id: 'task-finance',
          nodeId: 'parallel',
          assignee: 'finance',
          status: 'cancelled',
          comment: '',
        },
      ],
    },
    participants: [],
    taskWarnings: [{ taskId: task.id, message: '历史受理异常' }],
  };
  return { detail, source, parallel, task };
}
/** 核对退回和拒绝的源节点恢复真实结果，其他失效节点保持灰色；结果计算不改原数据。 */
function negativeSourceCase(): void {
  for (const decision of ['returned', 'rejected'] as const) {
    const { detail, source, parallel } = fixture(decision);
    const before = JSON.stringify(detail);
    expect(nodeProgressStatus(source, detail.activity.tasks)).toBe(decision);
    expect(nodeProgressStatus(parallel, detail.activity.tasks)).toBe('invalidated');
    expect(nodeProgressStatus(detail.activity.nodes[0]!, detail.activity.tasks)).toBe('completed');
    expect(JSON.stringify(detail)).toBe(before);
  }
}
test('显示退回拒绝的真实源节点，关联取消节点不被染红', negativeSourceCase);
/** 核对当前新轮次不会沿用同节点旧轮次的驳回结果。 */
function generationCase(): void {
  const { source, task } = fixture('returned');
  source.generation = 2;
  source.status = 'active';
  expect(nodeProgressStatus(source, [task])).toBe('active');
  source.status = 'invalidated';
  expect(nodeProgressStatus(source, [task])).toBe('invalidated');
  expect(nodeProgressStatus(source, [{ ...task, generation: 2, status: 'rejected' }])).toBe('rejected');
}
test('按节点与轮次识别结果，旧驳回不影响新一轮', generationCase);
/** 核对退回橙色、终止红色及选中态，其他取消状态保持灰色。 */
function graphCase(): void {
  for (const decision of ['returned', 'rejected'] as const) {
    const { detail } = fixture(decision);
    const model = runtimeGraph(detail);
    const source = model.data.nodes!.find(
      /** 定位真正驳回的审批节点。
       * @param node 图节点
       * @returns 是否源节点
       */ function match(node) {
        return node.id === 'runtime:source';
      },
    )!;
    const parallel = model.data.nodes!.find(
      /** 定位因同轮终止而取消的平行节点。
       * @param node 图节点
       * @returns 是否平行节点
       */ function match(node) {
        return node.id === 'runtime:parallel';
      },
    )!;
    expect(source.data?.tone).toBe(decision === 'returned' ? 'warning' : 'error');
    expect(source.style?.fill).toBe(decision === 'returned' ? '#fff8e9' : '#fff1f2');
    expect(source.data?.summary).toContain(decision === 'returned' ? '已退回' : '已终止申请');
    expect(parallel.data?.tone).toBe('muted');
    expect(parallel.data?.summary).toContain(decision === 'rejected' ? '因申请终止而取消' : '已失效');
    expect(workflowSelectionStyle(source).stroke).toBe(decision === 'returned' ? '#d9a02d' : '#dc4c5b');
  }
}
test('流程图退回橙色终止红色，其他取消节点灰色', graphCase);
/** 核对历史开关开启时能找回旧轮的驳回点，当前申请仍只展示当前节点。 */
function historyCase(): void {
  const { detail, source, task } = fixture('returned');
  source.applicationRevision = 1;
  const fresh: WorkflowNode = {
    ...source,
    id: 'new-source',
    applicationRevision: 2,
    status: 'active',
    deps: [],
  };
  detail.activity = { ...detail.activity, status: 'approving', nodes: [source, fresh], tasks: [task] };
  source.deps = [];
  const current = runtimeGraph(detail);
  expect(
    current.data.nodes!.some(
      /** 检查历史节点是否被默认过滤。
       * @param node 当前图节点
       * @returns 是否旧源节点
       */ function old(node) {
        return node.id === 'runtime:source';
      },
    ),
  ).toBe(false);
  const history = runtimeGraph(detail, true);
  expect(
    history.data.nodes!.find(
      /** 定位历史中保留的驳回源头。
       * @param node 图节点
       * @returns 是否旧源节点
       */ function old(node) {
        return node.id === 'runtime:source';
      },
    )?.data?.tone,
  ).toBe('warning');
  expect(
    history.data.nodes!.find(
      /** 定位本次申请的正常办理节点。
       * @param node 图节点
       * @returns 是否新节点
       */ function fresh(node) {
        return node.id === 'runtime:new-source';
      },
    )?.data?.tone,
  ).toBe('active');
}
test('历史申请驳回可识别，当前申请不受旧结果影响', historyCase);

/** 核对新退回轮次只强调目标与源点，终止取消状态与旧失效区分。 */
function reworkProgressCase(): void {
  const { source, parallel, task } = fixture('returned');
  source.status = 'waiting';
  source.generation = 2;
  source.rework = {
    fromNodeId: source.id,
    targetNodeId: parallel.id,
    returnTaskId: task.id,
    at: task.actedAt!,
  };
  parallel.status = 'active';
  parallel.generation = 2;
  parallel.rework = { ...source.rework };
  expect(nodeProgressStatus(source, [task], 'approving')).toBe('returned');
  expect(nodeProgressStatus(parallel, [task], 'approving')).toBe('reworking');
  source.status = 'active';
  expect(nodeProgressStatus(source, [task], 'approving')).toBe('active');
  parallel.status = 'invalidated';
  expect(nodeProgressStatus(parallel, [task], 'rejected')).toBe('terminated');
}
test('新退回目标与源点橙色展示，终止关联取消有明确状态', reworkProgressCase);
