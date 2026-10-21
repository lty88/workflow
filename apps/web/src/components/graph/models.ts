import type { EdgeData, NodeData } from '@antv/g6';
import { activeMember, findById, topological, STATUSES } from '@workflow/domain';
import type { ActivityStatus, CompanyConfig } from '@workflow/domain';
import type { WorkflowViewDetail } from '../activity/types';
import { NODE_STATUSES } from '../activity/types';
import type { BusinessGraphModel, GraphNodeMeta, GraphTone } from './types';

const colors: Record<GraphTone, { fill: string; stroke: string }> = {
  normal: { fill: '#ffffff', stroke: '#b6c8e9' },
  active: { fill: '#edf4ff', stroke: '#3068e9' },
  success: { fill: '#effaf5', stroke: '#36a87e' },
  warning: { fill: '#fff8e9', stroke: '#d9a02d' },
  muted: { fill: '#f1f3f7', stroke: '#bdc5d3' },
};
const stages = [
  { id: 'assign', name: '指派执行人', statuses: ['ready_assign'] },
  { id: 'execute', name: '活动执行与汇报', statuses: ['ready_execute', 'executing'] },
  { id: 'archive', name: '成果提交与归档', statuses: ['archive_draft', 'archive_review'] },
  { id: 'finish', name: '已归档', statuses: ['archived'] },
];

/**
 * 判断部门与所有上级是否启用，用于和服务端权限一致的组织图展示。
 * @param config 公司配置
 * @param id 部门标识
 * @returns 部门是否有效
 */
function departmentEnabled(config: CompanyConfig, id: string): boolean {
  const seen = new Set<string>();
  let current = id;
  while (current) {
    if (seen.has(current)) return false;
    seen.add(current);
    const dept = findById(config.departments, current);
    if (!dept?.active) return false;
    current = dept.parent;
  }
  return true;
}
/**
 * 把条件字段键转换成业务名称，避免在流程图中暴露配置键。
 * @param config 公司配置
 * @param key 字段键
 * @returns 字段显示名
 */
function fieldLabel(config: CompanyConfig, key: string): string {
  for (const field of config.form.fields) if (field.key === key) return field.label;
  return '待配置字段';
}

/**
 * 生成统一的G6业务节点，将展示信息与真实业务标识分开。
 * @param id 图节点唯一标识
 * @param meta 业务元数据
 * @returns 带状态样式的G6节点
 */
function visualNode(id: string, meta: GraphNodeMeta): NodeData {
  return {
    id,
    data: { ...meta },
    style: {
      ...colors[meta.tone],
      labelText: `${meta.label}\n${meta.summary}`,
      lineDash: meta.tone === 'muted' ? [5, 3] : undefined,
    },
  };
}

/**
 * 生成有向连接，唯一边标识不依赖数组位置。
 * @param source 起点
 * @param target 终点
 * @param dashed 是否弱依赖
 * @returns G6边
 */
function edge(source: string, target: string, dashed = false): EdgeData {
  return {
    id: 'edge:' + JSON.stringify([source, target]),
    source,
    target,
    style: { lineDash: dashed ? [5, 4] : undefined, stroke: dashed ? '#b8c0cf' : '#9aadc9' },
  };
}

/**
 * 把公司部门和可选成员转换为G6组织层级图，发现组织循环时阻止错误布局。
 * @param config 当前草案
 * @param includeMembers 是否展示成员节点
 * @returns 组织架构图数据
 */
export function organizationGraph(config: CompanyConfig, includeMembers = false): BusinessGraphModel {
  const checked = topological(
    config.departments.map(
      /**
       * 将部门父子关系转换为可校验依赖。
       * @param dept 部门
       * @returns 校验节点
       */ function dependency(dept) {
        return { id: dept.id, deps: dept.parent ? [dept.parent] : [] };
      },
    ),
  );
  if (checked.error)
    return { data: { nodes: [], edges: [] }, issue: '组织层级存在循环或缺失上级，请先修正部门配置。' };
  const nodes: NodeData[] = [];
  const edges: EdgeData[] = [];
  for (const dept of config.departments) {
    let count = 0;
    for (const user of config.users) if (user.department === dept.id && user.active) count += 1;
    const manager = findById(config.users, dept.manager)?.name || '待设置';
    const enabled = departmentEnabled(config, dept.id);
    nodes.push(
      visualNode('dept:' + dept.id, {
        businessId: dept.id,
        kind: 'department',
        label: dept.name,
        summary: `${enabled ? '负责人：' + manager : dept.active ? '上级部门已停用' : '部门已停用'} · ${count}人`,
        tone: enabled ? 'normal' : 'muted',
      }),
    );
    if (dept.parent) edges.push(edge('dept:' + dept.parent, 'dept:' + dept.id));
  }
  if (includeMembers)
    for (const user of config.users) {
      nodes.push(
        visualNode('member:' + user.id, {
          businessId: user.id,
          kind: 'member',
          label: user.name,
          summary: activeMember(config, user.id)
            ? user.id === findById(config.departments, user.department)?.manager
              ? '部门负责人'
              : '成员'
            : '成员或所属部门已停用',
          tone: activeMember(config, user.id) ? 'normal' : 'muted',
        }),
      );
      edges.push(edge('dept:' + user.department, 'member:' + user.id, true));
    }
  return { data: { nodes, edges } };
}

/**
 * 将审批模板转换为有向依赖图，明确并行、条件和后续业务阶段。
 * @param config 当前流程草案
 * @returns G6流程设计数据
 */
export function templateGraph(config: CompanyConfig): BusinessGraphModel {
  const checked = topological(config.workflow.nodes);
  if (checked.error) return { data: { nodes: [], edges: [] }, issue: checked.error };
  const nodes: NodeData[] = [
    visualNode('stage:apply', {
      businessId: 'apply',
      kind: 'stage',
      label: '提交活动申请',
      summary: '冻结表单和实际审批路线',
      tone: 'normal',
    }),
  ];
  const edges: EdgeData[] = [];
  for (const node of checked.order) {
    const assignee =
      node.assignee.type === 'manager'
        ? '部门负责人'
        : findById<{ id: string; name: string }>(
            node.assignee.type === 'role' ? config.roles : config.users,
            node.assignee.value,
          )?.name || '待设置受理人';
    const condition = node.condition
      ? ` · ${fieldLabel(config, node.condition.field)}${{ eq: '=', neq: '≠', gte: '≥' }[node.condition.operator]}${node.condition.value}`
      : '';
    nodes.push(
      visualNode('workflow:' + node.id, {
        businessId: node.id,
        kind: 'workflow',
        label: node.label,
        summary: `${node.kind === 'notice' ? '知会' : node.kind === 'task' ? '任务' : '审批'} · ${assignee}${condition}`,
        tone: node.condition ? 'warning' : 'normal',
      }),
    );
    if (!node.deps.length) edges.push(edge('stage:apply', 'workflow:' + node.id));
    for (const dep of node.deps)
      edges.push(
        edge(
          'workflow:' + dep,
          'workflow:' + node.id,
          node.kind === 'notice' || findById(config.workflow.nodes, dep)?.kind === 'notice',
        ),
      );
  }
  nodes.push(
    visualNode('stage:approved', {
      businessId: 'approved',
      kind: 'stage',
      label: '立项审批完成',
      summary: '全部必办分支完成后汇合',
      tone: 'normal',
    }),
  );
  for (const node of checked.order) {
    if (node.kind === 'notice') continue;
    let hasChild = false;
    for (const candidate of checked.order)
      if (candidate.kind !== 'notice' && candidate.deps.includes(node.id)) hasChild = true;
    if (!hasChild) edges.push(edge('workflow:' + node.id, 'stage:approved'));
  }
  addStages(nodes, edges, 'stage:approved');
  return { data: { nodes, edges } };
}

/**
 * 在图中追加指派、执行及归档阶段，不把阶段状态当成审批节点。
 * @param nodes 图节点
 * @param edges 图边
 * @param from 审批汇合节点
 * @param status 当前业务状态
 */
function addStages(nodes: NodeData[], edges: EdgeData[], from: string, status?: ActivityStatus): void {
  let current = -1;
  for (let index = 0; index < stages.length; index += 1)
    if (stages[index]!.statuses.includes(status || '')) current = index;
  let previous = from;
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index]!;
    const tone: GraphTone =
      current > index || status === 'archived' ? 'success' : current === index ? 'active' : 'normal';
    const id = 'stage:' + stage.id;
    nodes.push(
      visualNode(id, {
        businessId: stage.id,
        kind: 'stage',
        label: stage.name,
        summary:
          current === index
            ? '当前业务阶段'
            : current > index || status === 'archived'
              ? '已完成'
              : '后续业务阶段',
        tone,
      }),
    );
    edges.push(edge(previous, id));
    previous = id;
  }
}

/**
 * 将实际节点轮次、受理人和当前状态转换为G6审批进度图，默认显示本次申请。
 * @param detail 服务端流程详情
 * @param showHistory 是否叠加历史申请节点
 * @returns 实际流程图
 */
export function runtimeGraph(detail: WorkflowViewDetail, showHistory = false): BusinessGraphModel {
  const all = detail.activity.nodes;
  const revision = detail.activity.revision || 1;
  const current = all.filter(
    /**
     * 按申请轮次选择当前或历史节点。
     * @param node 节点
     * @returns 是否展示
     */ function included(node) {
      return showHistory || (node.applicationRevision || 1) === revision;
    },
  );
  const checked = topological(current);
  if (checked.error) return { data: { nodes: [], edges: [] }, issue: checked.error };
  const nodes: NodeData[] = [];
  const edges: EdgeData[] = [];
  const hasRealStatus = !!detail.activity.status;
  for (const node of checked.order) {
    let tone: GraphTone =
      node.status === 'active'
        ? 'active'
        : node.status === 'completed'
          ? 'success'
          : ['invalidated', 'skipped'].includes(node.status)
            ? 'muted'
            : 'normal';
    for (const warning of detail.taskWarnings || []) {
      const task = findById(detail.activity.tasks, warning.taskId);
      if (task?.nodeId === node.id) tone = 'warning';
    }
    const names: string[] = [];
    for (const id of node.assignees) names.push(findById(detail.participants, id)?.name || id);
    nodes.push(
      visualNode('runtime:' + node.id, {
        businessId: node.id,
        kind: 'runtime',
        label: node.label,
        summary: `${NODE_STATUSES[node.status]} · ${names.join('、') || '无受理人'} · V${node.applicationRevision || revision}`,
        tone,
      }),
    );
    for (const dep of node.deps)
      edges.push(
        edge('runtime:' + dep, 'runtime:' + node.id, node.kind === 'notice' || node.status === 'skipped'),
      );
  }
  if (nodes.length && hasRealStatus) {
    const approved = !['draft', 'approving', 'needs_info', 'withdrawn', 'rejected'].includes(
      detail.activity.status!,
    );
    nodes.push(
      visualNode('stage:approved', {
        businessId: 'approved',
        kind: 'stage',
        label: '立项审批完成',
        summary: approved ? '审批已结束' : '等待全部必办分支',
        tone: approved ? 'success' : 'normal',
      }),
    );
    for (const node of current) {
      if (
        node.kind === 'notice' ||
        node.status === 'invalidated' ||
        (!showHistory && (node.applicationRevision || 1) !== revision)
      )
        continue;
      let hasChild = false;
      for (const child of current)
        if (child.kind !== 'notice' && child.deps.includes(node.id)) hasChild = true;
      if (!hasChild)
        edges.push(
          edge(
            'runtime:' + node.id,
            'stage:approved',
            node.status === 'skipped' || (node.applicationRevision || 1) !== revision,
          ),
        );
    }
    addStages(nodes, edges, 'stage:approved', detail.activity.status);
    addException(nodes, edges, detail);
  }
  return { data: { nodes, edges } };
}

/**
 * 在实际流程图上显示退回、拒绝、撤回及取消分支，保持业务状态可见。
 * @param nodes 图节点
 * @param edges 图边
 * @param detail 当前工单详情
 */
function addException(nodes: NodeData[], edges: EdgeData[], detail: WorkflowViewDetail): void {
  const status = detail.activity.status;
  if (!status || !['needs_info', 'withdrawn', 'rejected', 'cancel_review', 'cancelled'].includes(status))
    return;
  let from = '';
  let latest = '';
  for (const task of detail.activity.tasks)
    if (['returned', 'rejected'].includes(task.status) && (task.actedAt || '') >= latest) {
      const nodeId = 'runtime:' + task.nodeId;
      if (findById(nodes, nodeId)) {
        from = nodeId;
        latest = task.actedAt || '';
      }
    }
  const cancelling = status === 'cancel_review' || status === 'cancelled';
  if (cancelling) {
    from = 'stage:approved';
    for (const stage of stages)
      if (stage.statuses.includes(detail.activity.cancellation?.previous || '')) from = 'stage:' + stage.id;
  }
  if (!from)
    for (const node of nodes)
      if (node.data?.kind === 'runtime') {
        from = node.id;
        break;
      }
  nodes.push(
    visualNode('stage:exception', {
      businessId: status,
      kind: 'stage',
      label: STATUSES[status],
      summary: cancelling ? '取消流程分支 · 按审核结果恢复或终止' : '本轮审批已结束 · 历史意见保留',
      tone: ['withdrawn', 'cancelled'].includes(status) ? 'muted' : 'warning',
    }),
  );
  if (from) edges.push(edge(from, 'stage:exception', true));
}
