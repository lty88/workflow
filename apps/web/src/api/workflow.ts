import type { DecisionCommand, TransferCommand } from '@workflow/domain'
import type { MutationResult, WorkflowPreview } from '@/typings/api'
import { mutation, request } from './http'

/** 办理个人节点任务，服务端复核冻结操作权限、退回轮次与评分并生成新待办。
 * @param id 个人任务标识
 * @param command 审批意见、评分、退回目标及任务版本
 * @returns 更新后的活动版本
 */
export function decisionApi(id: string, command: DecisionCommand): Promise<MutationResult> {
  return mutation(`/tasks/${id}/decisions`, command)
}

/**
 * 转交当前有效个人待办并保留原因审计。
 * @param id 待办标识
 * @param command 新受理人与版本
 * @returns 工单新版本
 */
export function transferApi(id: string, command: TransferCommand): Promise<MutationResult> {
  return mutation(`/tasks/${id}/transfer`, command)
}

/**
 * 预览填写内容对应的实际路线。
 * @param payload 输入字段
 * @returns 路线与受理人
 */
export function previewApi(payload: Record<string, string>): Promise<WorkflowPreview> {
  return request('/workflow/preview', { method: 'POST', body: JSON.stringify({ payload }) })
}


/** 派发当前审批人的节点内协作任务，服务端冻结交付规则并刷新申请版本。
 * @param taskId 父审批个人待办
 * @param command 串并行及任务要求
 * @returns 更新的申请标识与版本
 */
export function dispatchCollaborationApi(taskId: string, command: Omit<import('@workflow/domain').CollaborationDispatchCommand, 'idempotencyKey'>): Promise<MutationResult> {
  return mutation(`/tasks/${encodeURIComponent(taskId)}/collaborations`, command)
}

/** 提交成果、验收或退回，接口统一复核本人资格及并发版本。
 * @param id 所属申请
 * @param nodeId 协作节点
 * @param command 动作、轮次、附件分组及版本
 * @returns 更新的申请标识与版本
 */
export function collaborationActionApi(id: string, nodeId: string, command: Omit<import('@workflow/domain').CollaborationActionCommand, 'idempotencyKey'>): Promise<MutationResult> {
  return mutation(`/requests/${encodeURIComponent(id)}/collaborations/${encodeURIComponent(nodeId)}/actions`, command)
}
