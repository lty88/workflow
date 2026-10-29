import { createUuid } from './ids';
import { SHARED_ACCESS } from './data-access';
import { lifecycleOf } from './lifecycle';
import type {
  Activity,
  AssigneeRule,
  CompanyConfig,
  NodeDefinition,
  WorkflowNode,
  WorkflowTask,
} from './types';
import { activeMember, canReadActivity, findById, hasPermission } from './permissions';
import { matches } from './forms';

/**
 * 校验依赖图并返回拓扑顺序。
 * @param nodes 定义或实例节点
 * @returns 错误与合法顺序
 */
export function topological<T extends { id: string; deps: string[] }>(
  nodes: T[],
): { error: string; order: T[] } {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) return { error: '节点标识重复', order: [] };
    ids.add(node.id);
  }
  for (const node of nodes)
    for (const id of node.deps) if (!ids.has(id)) return { error: '前置节点不存在', order: [] };
  const visited = new Set<string>();
  const order: T[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      let complete = true;
      for (const dep of node.deps) if (!visited.has(dep)) complete = false;
      if (complete) {
        visited.add(node.id);
        order.push(node);
        changed = true;
      }
    }
  }
  return order.length === nodes.length ? { error: '', order } : { error: '节点依赖存在循环', order: [] };
}

/**
 * 从组织和角色中解析冻结受理人，并校验当前操作资格。
 * @param config 当前配置
 * @param rule 解析规则
 * @param applicant 申请人
 * @param kind 节点类型
 * @returns 受理人与错误
 */
export function resolveAssignees(
  config: CompanyConfig,
  rule: AssigneeRule,
  applicant: string,
  kind: NodeDefinition['kind'],
): { ids: string[]; errors: string[] } {
  const ids: string[] = [];
  const errors: string[] = [];
  const user = findById(config.users, applicant);
  if (!user || !activeMember(config, applicant)) return { ids, errors: ['申请人或所属部门已停用'] };
  if (rule.type === 'manager') {
    const id = findById(config.departments, user.department)?.manager;
    if (id) ids.push(id);
  }
  if (rule.type === 'department_manager') {
    const department = findById(config.departments, rule.value);
    const manager = department?.manager ? findById(config.users, department.manager) : undefined;
    if (!department?.active || !manager || manager.department !== department.id)
      errors.push('指定部门未启用或未设置有效的本部门负责人');
    else ids.push(manager.id);
  }
  if (rule.type === 'user') ids.push(rule.value);
  if (rule.type === 'role')
    for (const member of config.users)
      if (member.roles.includes(rule.value) && activeMember(config, member.id)) ids.push(member.id);
  if (!ids.length) errors.push('未找到有效受理人');
  for (const id of ids) {
    if (!activeMember(config, id)) errors.push('受理人或部门已停用');
    if (kind === 'approval' && id === applicant) errors.push('禁止申请人自审，请设置替代审核人');
    if (
      kind !== 'notice' &&
      (!hasPermission(config, id, kind === 'approval' ? 'approval:decide' : 'task:complete') ||
        !hasPermission(config, id, 'activity:read'))
    )
      errors.push('受理人缺少查看或办理权限');
  }
  return { ids: [...new Set(ids)], errors };
}

export interface WorkflowValidationOptions {
  /** 旧版公司流程保留至少一个审核要求，独立模板允许任务或知会流程。 */
  requireApproval?: boolean;
}

/**
 * 按提交内容冻结模板分支、附件共享默认值、操作权限和评分开关，条件跳过时继承原前置。
 * @param config 提交时配置
 * @param payload 净化表单内容
 * @param applicant 申请人
 * @param options 当前流程是否要求至少一个审核节点
 * @returns 实例节点和错误
 */
export function instantiateWorkflow(
  config: CompanyConfig,
  payload: Record<string, string>,
  applicant: string,
  options: WorkflowValidationOptions = {},
): { nodes: WorkflowNode[]; errors: string[] } {
  const checked = topological(config.workflow.nodes);
  if (checked.error) return { nodes: [], errors: [checked.error] };
  const nodes: WorkflowNode[] = [];
  const errors: string[] = [];
  const included = new Set<string>();
  const ids = new Map<string, string>();
  const effectiveCache = new Map<string, string[]>();
  for (const def of checked.order) {
    ids.set(def.id, createUuid());
    if (matches(def.condition, payload)) included.add(def.id);
  }
  /**
   * 继承未生效或知会节点的真实前置。
   * @param id 原节点键
   * @returns 生效必办节点键集合
   */
  function effective(id: string): string[] {
    const cached = effectiveCache.get(id);
    if (cached) return cached;
    const def = findById(config.workflow.nodes, id)!;
    if (included.has(id) && def.kind !== 'notice') return [ids.get(id)!];
    const parents: string[] = [];
    for (const dep of def.deps) parents.push(...effective(dep));
    const result = [...new Set(parents)];
    effectiveCache.set(id, result);
    return result;
  }
  for (const def of checked.order) {
    const deps: string[] = [];
    for (const dep of def.deps) deps.push(...effective(dep));
    const people = included.has(def.id)
      ? resolveAssignees(config, def.assignee, applicant, def.kind)
      : { ids: [], errors: [] };
    for (const error of people.errors) errors.push(`${def.label}：${error}`);
    nodes.push({
      access: structuredClone(def.access || SHARED_ACCESS),
      downloadAccess: def.downloadAccess ? structuredClone(def.downloadAccess) : undefined,
      approvalPolicy: def.approvalPolicy
        ? {
            ...structuredClone(def.approvalPolicy),
            rating: config.workflow.ratingEnabled ? def.approvalPolicy.rating : 'off',
          }
        : undefined,
      origin: 'template',
      id: ids.get(def.id)!,
      key: def.id,
      label: def.label,
      kind: def.kind,
      deps: [...new Set(deps)],
      assigneeRule: structuredClone(def.assignee),
      assignees: people.ids,
      status: included.has(def.id) ? 'waiting' : 'skipped',
      generation: 1,
    });
  }
  const prospective = {
    applicant,
    department: findById(config.users, applicant)?.department || '',
    nodes,
    executor: '',
    cancellation: null,
  };
  let approvals = 0;
  for (const node of nodes)
    if (node.status !== 'skipped') {
      if (node.kind === 'approval') approvals += 1;
      if (node.kind !== 'notice')
        for (const id of node.assignees)
          if (!canReadActivity(config, id, prospective))
            errors.push(`${node.label}：受理人数据范围不覆盖本活动`);
    }
  if (options.requireApproval !== false && !approvals) errors.push('至少需要一个生效审核节点');
  if (!nodes.some((node) => node.status !== 'skipped'))
    errors.push('当前条件下没有生效流程节点，请调整模板或条件');
  return { nodes, errors: [...new Set(errors)] };
}

/** 从最近一次实际办理轮次继承明确转交资格，兼容多次重开但尚未激活的轮次。
 * @param activity 包含历史任务的实例
 * @param node 正在生成待办的节点
 * @param assignee 当前冻结受理人
 * @returns 最近一次历史任务是否经明确转交，没有转交时省略标记
 */
function inheritedDelegation(activity: Activity, node: WorkflowNode, assignee: string): true | undefined {
  let latest: WorkflowTask | undefined;
  for (const task of activity.tasks)
    if (
      task.nodeId === node.id &&
      task.assignee === assignee &&
      task.generation < node.generation &&
      (!latest || task.generation > latest.generation)
    )
      latest = task;
  return latest?.delegated ? true : undefined;
}

/**
 * 激活满足前置的节点并继承上一轮转交资格，创建待办；知会自动完成并保留投递记录。
 * @param activity 事务内活动实例
 * @returns 新创建的个人任务
 */
export function advanceWorkflow(activity: Activity): WorkflowTask[] {
  const created: WorkflowTask[] = [];
  if (activity.status !== 'approving') return created;
  for (const node of activity.nodes) {
    if (node.businessStage || node.status !== 'waiting') continue;
    let ready = true;
    for (const id of node.deps) if (findById(activity.nodes, id)?.status !== 'completed') ready = false;
    if (!ready) continue;
    node.status = node.kind === 'notice' ? 'completed' : 'active';
    for (const assignee of node.assignees) {
      let exists = false;
      for (const task of activity.tasks)
        if (
          task.nodeId === node.id &&
          task.generation === node.generation &&
          task.assignee === assignee &&
          task.status === 'pending'
        )
          exists = true;
      if (exists) continue;
      const task: WorkflowTask = {
        id: createUuid(),
        activityId: activity.id,
        nodeId: node.id,
        generation: node.generation,
        assignee,
        status: node.kind === 'notice' ? 'completed' : 'pending',
        version: 1,
        delegated: inheritedDelegation(activity, node, assignee),
        comment: '',
        createdAt: new Date().toISOString(),
      };
      activity.tasks.push(task);
      created.push(task);
    }
  }
  let complete = true;
  for (const node of activity.nodes)
    if (!node.businessStage && node.kind !== 'notice' && !['completed', 'skipped', 'invalidated'].includes(node.status))
      complete = false;
  if (complete) {
    activity.status = lifecycleOf(activity).afterApproval === 'complete' ? 'completed' : 'ready_assign';
    if (activity.status === 'completed') activity.completedAt = new Date().toISOString();
    for (const task of activity.tasks)
      if (task.status === 'pending') {
        task.status = 'cancelled';
        task.version += 1;
      }
  }
  return created;
}

/**
 * 同步当前节点本轮会签结果，全部个人任务完成后才完成节点。
 * @param activity 流程实例
 * @param nodeId 节点标识
 */
export function settleNode(activity: Activity, nodeId: string): void {
  const node = findById(activity.nodes, nodeId);
  if (!node || node.status !== 'active') return;
  let all = true;
  let count = 0;
  for (const task of activity.tasks)
    if (task.nodeId === nodeId && task.generation === node.generation) {
      count += 1;
      if (!['approved', 'completed'].includes(task.status)) all = false;
    }
  if (all && count === node.assignees.length && count > 0) node.status = 'completed';
}

/** 将退回目标和依赖后续重开为新轮次，保留已完成记录、取消受影响旧待办并重新推进。
 * @param activity 事务内活动实例
 * @param source 触发退回的个人任务
 * @param targetId 已由服务端验证的退回目标
 * @param affectedIds 服务端计算的重办范围
 */
export function reopenWorkflow(
  activity: Activity,
  source: WorkflowTask,
  targetId: string,
  affectedIds: string[],
): void {
  const affected = new Set(affectedIds);
  for (const task of activity.tasks)
    if (affected.has(task.nodeId) && task.status === 'pending') {
      task.status = 'cancelled';
      task.version += 1;
    }
  for (const node of activity.nodes)
    if (affected.has(node.id)) {
      node.generation += 1;
      node.status = 'waiting';
      node.rework = {
        fromNodeId: source.nodeId,
        targetNodeId: targetId,
        returnTaskId: source.id,
        at: source.actedAt!,
      };
    }
  source.returnTargetId = targetId;
  source.returnAffectedNodeIds = affectedIds;
  delete activity.lastApprovalTaskId;
  delete activity.workflowOwnerId;
  delete activity.workflowOwnerNodeId;
  advanceWorkflow(activity);
}

/**
 * 终止本轮所有未完成任务并保留已经完成的意见。
 * @param activity 活动实例
 */
export function invalidatePending(activity: Activity): void {
  for (const task of activity.tasks)
    if (task.status === 'pending') {
      task.status = 'cancelled';
      task.version += 1;
    }
  for (const node of activity.nodes)
    if (node.status === 'waiting' || node.status === 'active') node.status = 'invalidated';
}
