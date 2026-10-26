import type { Activity, CompanyConfig, WorkflowNode, WorkflowTask } from './types';
import { canReadActivity, hasPermission } from './permissions';

/**
 * 找出当前申请轮次最后实际通过审批的办理人，会签或并行以最后通过的个人任务为准。
 * @param activity 完整活动、个人任务与审计记录
 * @returns 终审办理人的节点和任务；无有效已通过审批时为空
 */
export function finalApproval(activity: Activity): { node: WorkflowNode; task: WorkflowTask } | null {
  const candidates = new Map<string, { node: WorkflowNode; task: WorkflowTask }>();
  for (const node of activity.nodes) {
    if (
      node.kind !== 'approval' ||
      node.status !== 'completed' ||
      (node.applicationRevision || 1) !== (activity.revision || 1)
    )
      continue;
    for (const task of activity.tasks)
      if (
        task.nodeId === node.id &&
        task.generation === node.generation &&
        task.status === 'approved' &&
        node.assignees.includes(task.assignee)
      )
        candidates.set(task.id, { node, task });
  }
  const recorded = activity.lastApprovalTaskId ? candidates.get(activity.lastApprovalTaskId) : undefined;
  if (recorded) return recorded;
  if (!['draft', 'approving', 'needs_info', 'withdrawn', 'rejected'].includes(activity.status))
    for (const candidate of candidates.values())
      if (
        candidate.node.id === activity.workflowOwnerNodeId &&
        candidate.task.assignee === activity.workflowOwnerId
      )
        return candidate;
  // 旧主单未保存负责人时，按实际通过时间和稳定任务ID计算，与只读待办查询保持一致。
  let latest: { node: WorkflowNode; task: WorkflowTask } | null = null;
  for (const candidate of candidates.values())
    if (
      !latest ||
      (candidate.task.actedAt || '') > (latest.task.actedAt || '') ||
      ((candidate.task.actedAt || '') === (latest.task.actedAt || '') && candidate.task.id > latest.task.id)
    )
      latest = candidate;
  return latest;
}

/**
 * 判断当前轮次是否存在生效审批，避免审批资料缺失时错误退回管理员指派。
 * @param activity 当前活动
 * @returns 是否存在未跳过或失效的本轮审批节点
 */
export function hasEffectiveApproval(activity: Activity): boolean {
  for (const node of activity.nodes)
    if (
      node.kind === 'approval' &&
      !['skipped', 'invalidated'].includes(node.status) &&
      (node.applicationRevision || 1) === (activity.revision || 1)
    )
      return true;
  return false;
}

/**
 * 判断谁可承担执行指派及后续归档审核；有审批的活动仅允许终审实际办理人，无审批模板沿用协调人。
 * @param config 当前组织与权限
 * @param actor 当前成员
 * @param activity 活动及审批记录
 * @returns 是否有该活动的后续协调资格
 */
export function canCoordinateExecution(config: CompanyConfig, actor: string, activity: Activity): boolean {
  if (!canReadActivity(config, actor, activity)) return false;
  const final = finalApproval(activity);
  if (final) return final.task.assignee === actor && hasPermission(config, actor, 'approval:decide');
  return !hasEffectiveApproval(activity) && hasPermission(config, actor, 'activity:assign');
}

/**
 * 从真实审批记录同步后续负责人，供主单持久化、待办检索和详情展示复用；已完成归档的历史审核人保持不变。
 * @param activity 将更新负责人字段及待审核档案的事务内活动
 */
export function synchronizeWorkflowOwner(activity: Activity): void {
  if (['draft', 'needs_info', 'withdrawn', 'rejected'].includes(activity.status))
    delete activity.lastApprovalTaskId;
  if (['draft', 'approving', 'needs_info', 'withdrawn', 'rejected'].includes(activity.status)) {
    delete activity.workflowOwnerId;
    delete activity.workflowOwnerNodeId;
    return;
  }
  const final = finalApproval(activity);
  if (final) {
    activity.workflowOwnerId = final.task.assignee;
    activity.workflowOwnerNodeId = final.node.id;
    if (activity.status === 'archive_review' && activity.archive)
      activity.archive.reviewer = final.task.assignee;
  } else {
    delete activity.workflowOwnerId;
    delete activity.workflowOwnerNodeId;
  }
}
