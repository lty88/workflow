import { createUuid } from './ids';
import { lifecycleOf, activitySubprocessPosition } from './lifecycle';
import { finalApproval } from './post-workflow';
import { activeMember, canReadActivity, hasPermission } from './permissions';
import type { Activity, BusinessStage, CompanyConfig, WorkflowNode } from './types';

export const ACTIVITY_SUBPROCESS = [
  { key: 'assign', label: '指派执行人' },
  { key: 'execution', label: '执行与持续汇报' },
  { key: 'archive_submit', label: '提交成果归档' },
  { key: 'archive_review', label: '归档审核' },
] as const;

/** 计算已冻结的活动后续责任人，无审批时沿用有权访问本单的协调岗位。
 * @param config 实时组织和角色
 * @param activity 当前申请
 * @returns 允许处理指派任务的人员
 */
function assignmentOwners(config: CompanyConfig, activity: Activity): string[] {
  const final = finalApproval(activity);
  if (final) return [final.task.assignee];
  const ids: string[] = [];
  for (const user of config.users)
    if (
      activeMember(config, user.id) &&
      hasPermission(config, user.id, 'activity:assign') &&
      canReadActivity(config, user.id, activity)
    )
      ids.push(user.id);
  return ids;
}

/** 将业务步骤切换为在办或完成，复用个人任务与节点轮次，不为每篇执行日志新建节点。
 * @param activity 当前申请
 * @param node 业务节点
 * @param state 目标状态
 * @param assignees 当前实际责任人
 * @param actor 完成本次业务动作的真实操作者
 */
function synchronizeStep(
  activity: Activity,
  node: WorkflowNode,
  state: 'waiting' | 'active' | 'completed',
  assignees: string[],
  actor: string,
): void {
  const now = new Date().toISOString();
  node.assignees = [...new Set(assignees)];
  node.status = state;
  for (const task of activity.tasks) {
    if (task.nodeId !== node.id || task.generation !== node.generation || task.status !== 'pending') continue;
    if (state !== 'active' || !node.assignees.includes(task.assignee)) {
      task.status = state === 'completed' && task.assignee === actor ? 'completed' : 'cancelled';
      task.version += 1;
      task.actedAt = now;
    }
  }
  if (state === 'active')
    for (const id of node.assignees) {
      let exists = false;
      for (const task of activity.tasks)
        if (task.nodeId === node.id && task.generation === node.generation && task.assignee === id)
          exists = true;
      if (!exists)
        activity.tasks.push({
          id: createUuid(),
          activityId: activity.id,
          nodeId: node.id,
          assignee: id,
          generation: node.generation,
          status: 'pending',
          version: 1,
          comment: '',
          createdAt: now,
        });
    }
}

/** 按活动业务状态同步注册子流程；仅正常业务命令触发，不批量重写既有活动。
 * @param config 实时组织
 * @param activity 事务内申请
 * @param actor 本次真实操作者
 */
export function synchronizeBusinessSubprocess(
  config: CompanyConfig,
  activity: Activity,
  actor: string,
): void {
  if (lifecycleOf(activity).afterApproval !== 'activity_standard') return;
  const phases = [
    'ready_assign',
    'ready_execute',
    'executing',
    'archive_draft',
    'archive_review',
    'archived',
  ];
  if (!phases.includes(activity.status)) return;
  const revision = activity.revision || 1;
  const existing = activity.nodes.filter(
    /** 读取本次申请的业务子流程。
     * @param node 实例节点
     * @returns 是否本轮业务步骤
     */ function current(node) {
      return !!node.businessStage && (node.applicationRevision || 1) === revision;
    },
  );
  // 历史活动已进入执行时只按既有状态建立兼容步骤，不补造他人的通过记录。
  if (!existing.length) {
    let deps = activity.nodes
      .filter(
        /** 收集已通过的本轮必办节点作为审批段出口。
         * @param node 实例节点
         * @returns 是否有效审批段节点
         */ function approval(node) {
          return (
            !node.businessStage &&
            node.kind !== 'notice' &&
            node.status === 'completed' &&
            (node.applicationRevision || 1) === revision
          );
        },
      )
      .map(
        /** 提取节点标识。
         * @param node 实例节点
         * @returns 标识
         */ function id(node) {
          return node.id;
        },
      );
    for (const stage of ACTIVITY_SUBPROCESS) {
      const node: WorkflowNode = {
        id: createUuid(),
        key: `business:${stage.key}`,
        label: stage.label,
        kind: 'task',
        businessStage: stage.key,
        origin: 'business',
        deps,
        assigneeRule: { type: 'user', value: '' },
        assignees: [],
        status: 'waiting',
        generation: 1,
        applicationRevision: revision,
      };
      activity.nodes.push(node);
      existing.push(node);
      deps = [node.id];
    }
  }
  const index = activitySubprocessPosition(activity.status);
  const owners = assignmentOwners(config, activity);
  const assignees = [
    owners,
    activity.executor ? [activity.executor] : [],
    activity.executor ? [activity.executor] : [],
    activity.archive?.reviewer ? [activity.archive.reviewer] : owners,
  ];
  for (let i = 0; i < ACTIVITY_SUBPROCESS.length; i++) {
    const stage: BusinessStage = ACTIVITY_SUBPROCESS[i]!.key;
    const node = existing.find(
      /** 匹配注册业务步骤。
       * @param item 运行节点
       * @returns 是否当前步骤
       */ function match(item) {
        return item.businessStage === stage;
      },
    )!;
    if (index === 2 && i >= 2 && node.status !== 'waiting' && (node.status === 'completed' || i === 3)) {
      for (const task of activity.tasks)
        if (task.nodeId === node.id && task.generation === node.generation && task.status === 'pending') {
          task.status = 'returned';
          task.version += 1;
          task.actedAt = new Date().toISOString();
        }
      node.generation += 1;
    }
    synchronizeStep(
      activity,
      node,
      i < index ? 'completed' : i === index ? 'active' : 'waiting',
      assignees[i]!,
      actor,
    );
  }
  if (index === 4) activity.completedAt ||= new Date().toISOString();
}
