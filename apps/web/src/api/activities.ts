import type { ActionCommand, ActivityDeleteResult, Adjustment, TemplateSelection } from '@workflow/domain'
import type { ActivityDetail, ActivityPage, ListParams, MutationResult } from '@/typings/api'
import { mutation, request } from './http'

/**
 * 获取授权活动分页。
 * @param params 搜索和分页条件
 * @param common 是否查询跨业务申请目录
 * @returns 分页申请及活动
 */
export function activitiesApi(params: ListParams = {}, common = false): Promise<ActivityPage> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value))
  return request((common ? '/requests?' : '/activities?') + query)
}

/**
 * 下载当前筛选范围内的授权申请CSV。
 * @param common 是否导出跨业务申请目录
 * @param params 已应用的筛选条件
 * @returns CSV文件内容
 */
export function exportActivitiesApi(params: ListParams, common = false): Promise<Blob> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && !['page', 'pageSize'].includes(key)) query.set(key, String(value))
  return request((common ? '/requests/export?' : '/activities/export?') + query, { responseType: 'blob' })
}

/**
 * 读取活动详情。
 * @param id 活动标识
 * @returns 详情、附件与动作
 */
export function activityApi(id: string): Promise<ActivityDetail> {
  return request('/requests/' + encodeURIComponent(id))
}

/**
 * 保存草稿，更新时校验原版本。
 * @param payload 输入字段
 * @param id 已有标识
 * @param expectedVersion 当前版本
 * @param selection 活动类型、模板和预览版本
 * @returns 草稿标识
 */
export function saveDraftApi(payload: Record<string, string>, id?: string, expectedVersion?: number, selection?: TemplateSelection): Promise<MutationResult> {
  return mutation('/requests' + (id ? '/' + id : ''), { payload, ...(id ? { expectedVersion } : {}), ...selection }, id ? 'PATCH' : 'POST', true)
}

/**
 * 提交本人草稿并创建流程实例。
 * @param id 活动标识
 * @param expectedVersion 当前版本
 * @param expectedTemplateVersion 已预览并保存的模板版本
 * @returns 新版本
 */
export function submitApi(id: string, expectedVersion: number, expectedTemplateVersion?: number): Promise<MutationResult> {
  return mutation(`/requests/${id}/submit`, { expectedVersion, expectedTemplateVersion })
}

/**
 * 执行完整业务闭环动作。
 * @param id 活动标识
 * @param command 业务动作及当前版本
 * @returns 更新结果
 */
export function actionApi(id: string, command: ActionCommand): Promise<MutationResult> {
  return mutation(`/requests/${id}/actions`, command)
}

/**
 * 在途插入流程节点。
 * @param id 活动标识
 * @param command 结构调整
 * @returns 新版本
 */
export function adjustmentApi(id: string, command: Omit<Adjustment, 'idempotencyKey'>): Promise<MutationResult> {
  return mutation(`/requests/${id}/adjustments`, command)
}

/**
 * 逻辑删除活动，提交版本与原因，网络重试沿用幂等键。
 * @param id 活动标识
 * @param expectedVersion 用户确认时的活动版本
 * @param reason 删除原因
 * @param attachmentContextId 本次删除表单附件分组
 * @returns 删除成功的活动标识
 */
export function deleteActivityApi(id: string, expectedVersion: number, reason: string, attachmentContextId?: string): Promise<ActivityDeleteResult> {
  return mutation(`/requests/${encodeURIComponent(id)}`, { expectedVersion, reason, attachmentContextId }, 'DELETE')
}
