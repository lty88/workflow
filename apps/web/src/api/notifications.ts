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

/**
 * 增量轮询本人通知，首次请求建立历史基线，支持取消过期会话的请求。
 * @param cursor 上次成功返回的游标
 * @param signal 会话退出或组件卸载时的取消信号
 * @returns 新消息页与后续游标
 */
export function notificationFeedApi(
  cursor?: string,
  signal?: AbortSignal,
): Promise<import('@/typings/api/notifications').NotificationFeed> {
  return request('/notifications/feed' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : undefined,
  });
}
