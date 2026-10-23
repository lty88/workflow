import type { SessionProfile } from '@/typings/api';
import { request } from './http';

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
