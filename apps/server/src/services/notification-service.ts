import type { Pool, PoolConnection } from 'mysql2/promise';
import { z } from 'zod';
import { canReadActivity } from '@workflow/domain';
import type { Notification } from '@workflow/domain';
import { HttpError } from '../errors';
import { loadActivity, loadConfig, query, transaction } from '../db/repository';

const cursorSchema = z.object({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/),
  id: z.string().max(80),
});
interface NotificationRow extends Notification {
  cursorAt: string;
}

/**
 * 按稳定时间与标识分页读取本人新通知，首次只建立最近消息基线；继续执行实时活动权限过滤。
 * @param pool 数据库连接池
 * @param actor 当前会话成员
 * @param cursor 上次返回的不透明游标
 * @returns 可见消息、下一游标和是否还有待拉取消息
 */
export async function notificationFeed(pool: Pool, actor: string, cursor?: string) {
  let previous: z.infer<typeof cursorSchema> | null = null;
  if (cursor) {
    try {
      previous = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    } catch {
      throw new HttpError(422, 'NOTIFICATION_CURSOR_INVALID', '消息游标无效，请刷新页面');
    }
  }
  /**
   * 在一致事务中取一页候选并按实时授权过滤，游标按候选推进避免无权消息阻塞。
   * @param db 当前事务连接
   * @returns 通知增量页
   */
  async function read(db: PoolConnection) {
    const config = (await loadConfig(db)).published;
    const rows = await query<NotificationRow>(
      db,
      `SELECT n.id,n.title,n.activity_id AS activityId,n.read_at AS readAt,n.created_at AS createdAt,
      DATE_FORMAT(n.created_at,'%Y-%m-%d %H:%i:%s.%f') AS cursorAt
      FROM notifications n JOIN activities a ON a.id=n.activity_id
      WHERE n.recipient_id=? AND a.deleted_at IS NULL ${previous ? 'AND (n.created_at>? OR (n.created_at=? AND n.id>?))' : ''}
      ORDER BY n.created_at ${previous ? 'ASC' : 'DESC'},n.id ${previous ? 'ASC' : 'DESC'} LIMIT 101`,
      previous ? [actor, previous.at, previous.at, previous.id] : [actor],
    );
    const page = rows.slice(0, 100);
    const items: Notification[] = [];
    for (const row of page) {
      const activity = await loadActivity(db, row.activityId);
      if (activity && canReadActivity(config, actor, activity)) {
        const { cursorAt: _cursorAt, ...item } = row;
        items.push(item);
      }
    }
    const last = previous ? page.at(-1) : page[0];
    let next = previous;
    if (last) next = { at: last.cursorAt.slice(0, 23), id: last.id };
    if (!next) {
      const now = await query<{ at: string }>(
        db,
        "SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%d %H:%i:%s.%f') AS at",
      );
      next = { at: now[0]!.at.slice(0, 23), id: '' };
    }
    return {
      items,
      cursor: Buffer.from(JSON.stringify(next)).toString('base64url'),
      hasMore: !!previous && rows.length > 100,
    };
  }
  return transaction(pool, read);
}
