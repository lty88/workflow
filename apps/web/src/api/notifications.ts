import type { Notification } from '@/typings/api';
import { request } from './http';

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
