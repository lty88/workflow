import { expect, test } from 'vitest';
import { seedConfig, topological } from '@workflow/domain';
import type { WorkflowNode } from '@workflow/domain';
import { organizationGraph, runtimeGraph, templateGraph } from '../../../web/src/components/graph/models';
import type { WorkflowViewDetail } from '../../../web/src/components/activity/types';

/**
 * 校验组织图节点使用稳定标识且继承部门停用状态。
 */
function organizationCase(): void {
  const config = seedConfig();
  config.departments[0]!.active = false;
  const model = organizationGraph(config, true);
  expect(model.issue).toBeUndefined();
  expect(
    model.data.nodes?.find(
      /**
       * 查找部门图节点。
       * @param node 图节点
       * @returns 是否目标部门
       */ function match(node) {
        return node.id === 'dept:d1';
      },
    )?.data?.tone,
  ).toBe('muted');
  expect(
    model.data.nodes?.find(
      /**
       * 查找成员图节点。
       * @param node 图节点
       * @returns 是否目标成员
       */ function match(node) {
        return node.id === 'member:u-lin';
      },
    )?.data?.tone,
  ).toBe('muted');
  expect(
    model.data.edges?.some(
      /**
       * 检查成员归属边。
       * @param edge 图边
       * @returns 是否目标关系
       */ function belongs(edge) {
        return edge.source === 'dept:d1' && edge.target === 'member:u-lin';
      },
    ),
  ).toBe(true);
  config.departments[0]!.parent = 'd1';
  expect(organizationGraph(config).issue).toContain('循环');
}
test('G6组织图保留部门成员关系、有效状态，并拦截组织环路', organizationCase);

/**
 * 校验流程图的串并行边、条件元数据和业务阶段均由配置产生。
 */
function templateCase(): void {
  const model = templateGraph(seedConfig());
  expect(model.issue).toBeUndefined();
  const edges = model.data.edges || [];
  expect(
    edges.some(
      /**
       * 检查教研并行分支。
       * @param edge 图边
       * @returns 是否目标关系
       */ function academic(edge) {
        return edge.source === 'workflow:n-department' && edge.target === 'workflow:n-academic';
      },
    ),
  ).toBe(true);
  expect(
    edges.some(
      /**
       * 检查营销并行分支。
       * @param edge 图边
       * @returns 是否目标关系
       */ function marketing(edge) {
        return edge.source === 'workflow:n-department' && edge.target === 'workflow:n-marketing';
      },
    ),
  ).toBe(true);
  const nodes = [];
  for (const node of model.data.nodes || []) {
    const deps: string[] = [];
    for (const edge of edges) if (edge.target === node.id) deps.push(edge.source);
    nodes.push({ id: node.id, deps });
  }
  expect(topological(nodes).error).toBe('');
  expect(
    model.data.nodes?.find(
      /**
       * 查找金额条件节点。
       * @param node 图节点
       * @returns 是否目标节点
       */ function conditional(node) {
        return node.id === 'workflow:n-director';
      },
    )?.data?.summary,
  ).toContain('≥10000');
}
test('G6流程图保留并行汇合、金额条件及后续阶段且无环', templateCase);

/**
 * 创建当前与历史两个申请轮次的图校验输入。
 * @returns 具有真实状态、任务和人员信息的最小详情
 */
function detail(): WorkflowViewDetail {
  const node: WorkflowNode = {
    id: 'old',
    key: 'n-review',
    label: '部门初审',
    kind: 'approval',
    deps: [],
    assigneeRule: { type: 'user', value: 'u-chen' },
    assignees: ['u-chen'],
    status: 'completed',
    generation: 1,
    applicationRevision: 1,
  };
  return {
    activity: {
      revision: 2,
      status: 'approving',
      nodes: [node, { ...node, id: 'current', status: 'active', applicationRevision: 2 }],
      tasks: [],
    },
    participants: [{ id: 'u-chen', name: '陈宁' }],
    taskWarnings: [],
  };
}

/**
 * 校验实际审批图默认隔离历史轮次，并正确映射活动状态。
 */
function runtimeCase(): void {
  const input = detail();
  const current = runtimeGraph(input);
  expect(
    current.data.nodes?.some(
      /**
       * 检查旧申请节点是否隐藏。
       * @param node 图节点
       * @returns 是否历史节点
       */ function old(node) {
        return node.id === 'runtime:old';
      },
    ),
  ).toBe(false);
  expect(
    current.data.nodes?.find(
      /**
       * 查找当前审批节点。
       * @param node 图节点
       * @returns 是否当前节点
       */ function active(node) {
        return node.id === 'runtime:current';
      },
    )?.data?.tone,
  ).toBe('active');
  expect(
    runtimeGraph(input, true).data.nodes?.some(
      /**
       * 检查历史开关是否恢复节点。
       * @param node 图节点
       * @returns 是否历史节点
       */ function old(node) {
        return node.id === 'runtime:old';
      },
    ),
  ).toBe(true);
  input.activity.status = 'cancel_review';
  input.activity.cancellation = {
    previous: 'executing',
    requester: 'u-lin',
    reviewer: 'u-chen',
    reason: '学校计划调整取消',
    disposal: '费用按约定退还',
  };
  expect(
    runtimeGraph(input).data.nodes?.find(
      /**
       * 查找取消流程分支。
       * @param node 图节点
       * @returns 是否取消节点
       */ function cancellation(node) {
        return node.id === 'stage:exception';
      },
    )?.data?.label,
  ).toBe('取消审批中');
}
test('G6审批图隔离申请轮次，支持历史查看和取消状态分支', runtimeCase);
