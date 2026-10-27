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
