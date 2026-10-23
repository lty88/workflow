import type { ConfigState } from '@workflow/domain';
import { request } from './http';

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
