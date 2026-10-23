import type { ActivityDetail } from '@/typings/api';

export const EXECUTION_STATUSES = [
  'ready_assign',
  'ready_execute',
  'executing',
  'archive_draft',
  'archive_review',
  'archived',
];

/**
 * 将活动参与人标识映射为服务端授权范围内的姓名。
 * @param detail 已按权限裁剪的活动详情
 * @param id 人员标识
 * @returns 参与人姓名，找不到时显示标识或占位符
 */
export function participantName(detail: ActivityDetail, id: string): string {
  return detail.participants.find((person) => person.id === id)?.name || id || '—';
}
