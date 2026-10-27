import type {
  Activity,
  CompanyConfig,
  DecisionCapabilities,
  DecisionTarget,
  NodeApprovalPolicy,
  NodeDefinition,
  WorkflowTask,
} from './types';
import { canHandleTask, findById } from './permissions';

/** 生成新模板节点的保守操作配置，终止默认关闭，评分默认关闭。
 * @returns 可独立修改的节点规则
 */
export function defaultApprovalPolicy(): NodeApprovalPolicy {
  return {
    returnEnabled: true,
    returnScope: 'previous',
    returnNodeIds: [],
    returnToApplicant: true,
    allowTerminate: false,
    rating: 'off',
  };
}

/** 收集节点所有上游，使用访问集合阻止错误依赖中的循环遍历。
 * @param nodes 当前定义或实例节点
 * @param id 起始节点标识
 * @returns 不包含自身的上游节点标识
 */
export function upstreamNodeIds(nodes: Array<{ id: string; deps: string[] }>, id: string): string[] {
  const seen = new Set<string>([id]);
  const pending = [...(findById(nodes, id)?.deps || [])];
  const result: string[] = [];
  while (pending.length) {
    const next = pending.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const node = findById(nodes, next);
    if (!node) continue;
    result.push(next);
    pending.push(...node.deps);
  }
  return result;
}

/** 预览目标及其依赖后续的重办范围，独立并行分支不受影响。
 * @param nodes 当前申请的有效节点
 * @param targetId 退回目标
 * @returns 目标及全部后续节点标识
 */
export function returnImpact(nodes: Array<{ id: string; deps: string[] }>, targetId: string): string[] {
  const affected = new Set<string>([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (affected.has(node.id)) continue;
      for (const dep of node.deps)
        if (affected.has(dep)) {
          affected.add(node.id);
          changed = true;
          break;
        }
    }
  }
  return [...affected];
}

/** 校验模板节点的退回范围和评分对象，在启用版本前定位错误配置。
 * @param nodes 模板定义节点
 * @param ratingEnabled 模板评分总开关
 * @returns 带节点名称的配置错误
 */
export function approvalPolicyErrors(nodes: NodeDefinition[], ratingEnabled: boolean): string[] {
  const errors: string[] = [];
  for (const node of nodes) {
    const policy = node.approvalPolicy;
    if (!policy) continue;
    if (node.kind !== 'approval') {
      errors.push(`${node.label}：只有审批节点可以配置审批操作与评分`);
      continue;
    }
    if (policy.returnEnabled && policy.returnScope === 'selected') {
      const ancestors = new Set(upstreamNodeIds(nodes, node.id));
      if (!policy.returnNodeIds.length) errors.push(`${node.label}：请选择可退回的上游节点`);
      if (new Set(policy.returnNodeIds).size !== policy.returnNodeIds.length)
        errors.push(`${node.label}：退回节点不能重复`);
      for (const id of policy.returnNodeIds)
        if (!ancestors.has(id) || findById(nodes, id)?.kind === 'notice')
          errors.push(`${node.label}：退回目标必须是上游审批或任务节点`);
    }
    if (
      ratingEnabled &&
      policy.rating !== 'off' &&
      !node.deps.some(
        /** 判断是否配置了直接前置审批。
         * @param id 前置标识
         * @returns 是否可以评价
         */ function approval(id) {
          return findById(nodes, id)?.kind === 'approval';
        },
      )
    )
      errors.push(`${node.label}：上游评分没有直接前置审批节点`);
  }
  return errors;
}

/** 计算当前任务的实际办理能力，未配置的新旧实例明确区分，旧实例保留原退给申请人与拒绝行为。
 * @param config 实时成员与角色
 * @param actor 当前操作者
 * @param activity 活动实例
 * @param task 当前个人待办
 * @returns 服务端可执行的退回目标、终止能力与评分要求
 */
export function decisionCapabilities(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  task: WorkflowTask,
): DecisionCapabilities {
  const result: DecisionCapabilities = {
    canReturnToApplicant: false,
    canTerminate: false,
    returnTargets: [],
    ratingRequirement: 'off',
    ratingTargets: [],
  };
  const node = findById(activity.nodes, task.nodeId);
  if (!node || node.kind !== 'approval' || !canHandleTask(config, actor, activity, task)) return result;
  const policy = node.approvalPolicy;
  if (!policy) return { ...result, canReturnToApplicant: true, canTerminate: true };
  result.canReturnToApplicant = policy.returnEnabled && policy.returnToApplicant;
  result.canTerminate = policy.allowTerminate;
  result.ratingRequirement = policy.rating;
  const current = activity.nodes.filter(
    /** 仅在当前申请和有效节点中选择目标。
     * @param candidate 候选节点
     * @returns 是否在当前生效路线
     */ function active(candidate) {
      return (
        (candidate.applicationRevision || 1) === (activity.revision || 1) &&
        !['skipped', 'invalidated'].includes(candidate.status)
      );
    },
  );
  const ancestors = new Set(upstreamNodeIds(current, node.id));
  for (const target of current) {
    if (target.status !== 'completed' || target.kind === 'notice' || !ancestors.has(target.id)) continue;
    const item: DecisionTarget = {
      nodeId: target.id,
      label: target.label,
      generation: target.generation,
      affectedNodeIds: returnImpact(current, target.id),
    };
    const allowed =
      policy.returnScope === 'previous'
        ? node.deps.includes(target.id)
        : policy.returnNodeIds.includes(target.key);
    if (policy.returnEnabled && allowed) result.returnTargets.push(item);
    if (policy.rating !== 'off' && target.kind === 'approval' && node.deps.includes(target.id))
      result.ratingTargets.push({ ...item, affectedNodeIds: [] });
  }
  // 条件分支未生效时不要求给不存在的审批成果评分。
  if (!result.ratingTargets.length) result.ratingRequirement = 'off';
  return result;
}
