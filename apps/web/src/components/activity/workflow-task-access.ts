import type { SessionProfile, WorkflowTask } from '@workflow/domain'
import type { WorkflowViewDetail } from './types'

/**
 * 核对当前用户的个人待办资格，供固定办理栏和流程进度共用；提交时由服务端再次授权。
 * @param detail 活动及节点任务数据
 * @param task 待核对的个人任务
 * @param profile 当前登录身份及权限
 * @returns 是否允许办理当前轮次的个人待办
 */
export function canDecideWorkflowTask(detail: WorkflowViewDetail, task: WorkflowTask, profile: SessionProfile | null): boolean {
  const activity = detail.activity
  const node = activity.nodes.find((item) => item.id === task.nodeId)
  return (
    !!profile &&
    profile.user.active &&
    activity.status === 'approving' &&
    task.status === 'pending' &&
    task.assignee === profile.user.id &&
    node?.kind !== 'notice' &&
    (node?.kind !== 'approval' || activity.applicant !== profile.user.id) &&
    !detail.taskWarnings?.some((warning) => warning.taskId === task.id) &&
    task.generation === node?.generation &&
    node.status === 'active' &&
    node.assignees.includes(profile.user.id) &&
    (task.delegated || node.assigneeRule.type !== 'role' || profile.user.roles.includes(node.assigneeRule.value)) &&
    profile.permissions.includes(node.kind === 'approval' ? 'approval:decide' : 'task:complete')
  )
}

/**
 * 核对服务端授予的流程调整能力，排除历史轮次和已结束活动的任务。
 * @param detail 活动及服务端动作能力
 * @param task 待转交的个人任务
 * @returns 是否允许打开该任务的转交入口
 */
export function canTransferWorkflowTask(detail: WorkflowViewDetail, task: WorkflowTask): boolean {
  const node = detail.activity.nodes.find((item) => item.id === task.nodeId)
  return (
    detail.activity.status === 'approving' &&
    !!detail.actions?.includes('adjust') &&
    task.status === 'pending' &&
    node?.status === 'active' &&
    node.generation === task.generation
  )
}
