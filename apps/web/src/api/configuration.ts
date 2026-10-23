import type { SettingsModule, SettingsChanges, MemberBatchAction } from '@/typings/api/settings'
import type { ConfigState } from '@workflow/domain'
import { request } from './http'

/**
 * 读取数据库主表装配的实时设置，仅管理员可用。
 * @returns 配置状态
 */
export function configApi(): Promise<ConfigState> {
  return request('/config')
}

/**
 * 为已保存成员重置登录密码。
 * @param id 员工标识
 * @param password 新密码
 * @returns 操作结果
 */
export function setMemberPasswordApi(id: string, password: string): Promise<{ ok: boolean }> {
  return request(`/members/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) })
}

/** 直接保存单个设置模块，成功后即生效。
 * @param module 模块标识
 * @param changes 本模块修改内容
 * @param expectedRevision 读取时修订号
 * @returns 最新真实主数据上下文
 */
export function saveSettingsApi(module: SettingsModule, changes: SettingsChanges, expectedRevision: number): Promise<ConfigState> {
  return request(`/settings/${module}`, { method: 'PUT', body: JSON.stringify({ changes, expectedRevision }) })
}

/** 永久删除未被业务引用的成员，返回刷新后的组织与人员状态。
 * @param id 成员稳定ID
 * @param expectedRevision 页面读取时的主数据修订号
 * @returns 删除后的主数据
 */
export function deleteMemberApi(id: string, expectedRevision: number): Promise<ConfigState> {
  return request(`/members/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision }) })
}

/** 原子提交所选成员的批量操作。
 * @param action 删除、启用或停用
 * @param ids 所选人员ID
 * @param expectedRevision 读取时主数据修订号
 * @returns 操作后的主数据
 */
export function batchMembersApi(action: MemberBatchAction, ids: string[], expectedRevision: number): Promise<ConfigState> {
  return request('/members/batch', { method: 'POST', body: JSON.stringify({ action, ids, expectedRevision }) })
}
