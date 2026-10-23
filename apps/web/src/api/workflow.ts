import type { TransferCommand } from '@workflow/domain';
import type { MutationResult, WorkflowPreview } from '@/typings/api';
import { mutation, request } from './http';

/**
 * 办理个人审核任务。
 * @param id 个人任务标识
 * @param expectedTaskVersion 任务版本
 * @param decision 决策
 * @param comment 节点内部说明
 * @param publicComment 活动内共享的结论或补充要求
 * @returns 更新结果
 */
export function decisionApi(
  id: string,
  expectedTaskVersion: number,
  decision: 'approve' | 'return' | 'reject',
  comment: string,
  publicComment = '',
): Promise<MutationResult> {
  return mutation(`/tasks/${id}/decisions`, { expectedTaskVersion, decision, comment, publicComment });
}

/**
 * 转交当前有效个人待办并保留原因审计。
 * @param id 待办标识
 * @param command 新受理人与版本
 * @returns 工单新版本
 */
export function transferApi(id: string, command: TransferCommand): Promise<MutationResult> {
  return mutation(`/tasks/${id}/transfer`, command);
}

/**
 * 预览填写内容对应的实际路线。
 * @param payload 输入字段
 * @returns 路线与受理人
 */
export function previewApi(payload: Record<string, string>): Promise<WorkflowPreview> {
  return request('/workflow/preview', { method: 'POST', body: JSON.stringify({ payload }) });
}
