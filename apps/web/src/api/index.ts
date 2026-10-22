import type {
  FileAccessInput,
  ActivityDeleteResult,
  ActionCommand,
  Adjustment,
  ConfigState,
  PageDefinition,
  TransferCommand,
  TemplateSelection,
} from '@workflow/domain';
import type {
  ActivityDetail,
  ActivityPage,
  Directory,
  FileRecord,
  ListParams,
  MutationResult,
  Notification,
  SessionProfile,
  WorkflowPreview,
} from '@/typings/api';
import { ApiError, mutation, request } from './http';
const uploadKeys = new Map<string, string>();

/**
 * 登录服务端会话。
 * @param username 账号
 * @param password 密码
 * @returns 身份与授权
 */
export function loginApi(username: string, password: string): Promise<SessionProfile> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}
/**
 * 读取当前登录资料。
 * @returns 最新授权资料
 */
export function meApi(): Promise<SessionProfile> {
  return request('/auth/me');
}
/**
 * 退出并撤销会话。
 * @returns 退出结果
 */
export function logoutApi(): Promise<{ ok: boolean }> {
  return request('/auth/logout', { method: 'POST' });
}
/**
 * 修改本人密码并撤销旧会话。
 * @param currentPassword 原密码
 * @param password 新密码
 * @returns 修改结果
 */
export function changePasswordApi(currentPassword: string, password: string): Promise<{ ok: boolean }> {
  return request('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, password }) });
}
/**
 * 读取动态页面授权。
 * @param id 页面标识
 * @returns 页面定义
 */
export function pageApi(id: string): Promise<PageDefinition> {
  return request('/pages/' + encodeURIComponent(id));
}
/**
 * 获取授权活动分页。
 * @param params 搜索和分页条件
 * @returns 分页活动
 */
export function activitiesApi(params: ListParams = {}): Promise<ActivityPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  return request('/activities?' + query);
}
/**
 * 下载当前筛选范围内的授权活动CSV。
 * @param params 已应用的筛选条件
 * @returns CSV文件内容
 */
export function exportActivitiesApi(params: ListParams): Promise<Blob> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && !['page', 'pageSize'].includes(key)) query.set(key, String(value));
  return request('/activities/export?' + query, { responseType: 'blob' });
}
/**
 * 读取活动详情。
 * @param id 活动标识
 * @returns 详情、附件与动作
 */
export function activityApi(id: string): Promise<ActivityDetail> {
  return request('/activities/' + encodeURIComponent(id));
}
/**
 * 保存草稿，更新时校验原版本。
 * @param payload 输入字段
 * @param id 已有标识
 * @param expectedVersion 当前版本
 * @param selection 活动类型、模板和预览版本
 * @returns 草稿标识
 */
export function saveDraftApi(
  payload: Record<string, string>,
  id?: string,
  expectedVersion?: number,
  selection?: TemplateSelection,
): Promise<MutationResult> {
  return mutation(
    '/activities' + (id ? '/' + id : ''),
    { payload, ...(id ? { expectedVersion } : {}), ...selection },
    id ? 'PATCH' : 'POST',
    true,
  );
}
/**
 * 提交本人草稿并创建流程实例。
 * @param id 活动标识
 * @param expectedVersion 当前版本
 * @param expectedTemplateVersion 已预览并保存的模板版本
 * @returns 新版本
 */
export function submitApi(
  id: string,
  expectedVersion: number,
  expectedTemplateVersion?: number,
): Promise<MutationResult> {
  return mutation(`/activities/${id}/submit`, { expectedVersion, expectedTemplateVersion });
}
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
 * 执行完整业务闭环动作。
 * @param id 活动标识
 * @param command 业务动作及当前版本
 * @returns 更新结果
 */
export function actionApi(id: string, command: ActionCommand): Promise<MutationResult> {
  return mutation(`/activities/${id}/actions`, command);
}
/**
 * 在途插入流程节点。
 * @param id 活动标识
 * @param command 结构调整
 * @returns 新版本
 */
export function adjustmentApi(
  id: string,
  command: Omit<Adjustment, 'idempotencyKey'>,
): Promise<MutationResult> {
  return mutation(`/activities/${id}/adjustments`, command);
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
/**
 * 获取授权人员选项。
 * @returns 成员与角色选项
 */
export function directoryApi(): Promise<Directory> {
  return request('/directory');
}
/**
 * 获取完整配置草案，仅管理员可用。
 * @returns 配置状态
 */
export function configApi(): Promise<ConfigState> {
  return request('/config');
}
/**
 * 保存配置草案。
 * @param draft 草案
 * @param expectedDraftRevision 草案版本
 * @returns 新状态
 */
export function saveConfigApi(
  draft: ConfigState['draft'],
  expectedDraftRevision: number,
): Promise<ConfigState> {
  return request('/config/draft', { method: 'PUT', body: JSON.stringify({ draft, expectedDraftRevision }) });
}
/**
 * 发布已保存的草案。
 * @param expectedDraftRevision 草案版本
 * @returns 新发布状态
 */
export function publishConfigApi(expectedDraftRevision: number): Promise<ConfigState> {
  return request('/config/publish', { method: 'POST', body: JSON.stringify({ expectedDraftRevision }) });
}
/**
 * 为已发布成员重置登录密码。
 * @param id 员工标识
 * @param password 新密码
 * @returns 操作结果
 */
export function setMemberPasswordApi(id: string, password: string): Promise<{ ok: boolean }> {
  return request(`/members/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) });
}
/**
 * 上传单个阶段附件。
 * @param activityId 活动标识
 * @param file 浏览器文件
 * @param stage 文件阶段
 * @param access 所属节点和只收紧的附件授权
 * @returns 文件元数据
 */
export async function uploadApi(
  activityId: string,
  file: File,
  stage: FileRecord['stage'],
  access: FileAccessInput = {},
): Promise<FileRecord> {
  const data = new FormData();
  data.set('access', JSON.stringify(access));
  data.set('file', file);
  const identity = [activityId, stage, file.name, file.size, file.lastModified, JSON.stringify(access)].join(
    ':',
  );
  const key = uploadKeys.get(identity) || crypto.randomUUID();
  uploadKeys.set(identity, key);
  try {
    const result = await request<FileRecord>(`/activities/${activityId}/files?stage=${stage}`, {
      method: 'POST',
      body: data,
      headers: { 'idempotency-key': key },
    });
    uploadKeys.delete(identity);
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) uploadKeys.delete(identity);
    throw error;
  }
}
/**
 * 查询本人站内消息。
 * @returns 通知
 */
export function notificationsApi(): Promise<Notification[]> {
  return request('/notifications');
}
/**
 * 标记本人消息已读。
 * @param id 消息标识
 * @returns 操作结果
 */
export function readNotificationApi(id: string): Promise<{ ok: boolean }> {
  return request(`/notifications/${id}/read`, { method: 'POST' });
}

/**
 * 修改已上传附件的附加权限，使用主单版本和幂等键防止并发覆盖。
 * @param id 文件标识
 * @param expectedVersion 当前主单版本
 * @param access 新查看和下载授权
 * @returns 主单新版本
 */
export function updateFileAccessApi(
  id: string,
  expectedVersion: number,
  access: FileAccessInput,
): Promise<MutationResult> {
  return mutation(
    `/files/${encodeURIComponent(id)}/access`,
    { expectedVersion, access: access.access, downloadAccess: access.downloadAccess },
    'PATCH',
  );
}

/**
 * 逻辑删除活动，提交版本与原因，网络重试沿用幂等键。
 * @param id 活动标识
 * @param expectedVersion 用户确认时的活动版本
 * @param reason 删除原因
 * @returns 删除成功的活动标识
 */
export function deleteActivityApi(
  id: string,
  expectedVersion: number,
  reason: string,
): Promise<ActivityDeleteResult> {
  return mutation(`/activities/${encodeURIComponent(id)}`, { expectedVersion, reason }, 'DELETE');
}
