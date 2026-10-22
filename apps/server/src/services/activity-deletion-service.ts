import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import {
  activeMember,
  auditActivity,
  canDeleteActivity,
  hasPermission,
  invalidatePending,
} from '@workflow/domain';
import type { ActivityDeleteCommand, ActivityDeleteResult } from '@workflow/domain';
import { jsonValue, loadActivity, loadConfig, query, saveActivity, transaction } from '../db/repository';
import { digest } from './auth';
import { ensure } from '../errors';

/**
 * 事务内逻辑删除活动，取消待办、关闭评价并保留审批及附件历史，使用幂等键防止重试重复操作。
 * @param pool 数据库连接池
 * @param actor 当前登录成员
 * @param id 活动标识
 * @param input 当前版本、删除原因和幂等键
 * @returns 已删除活动标识
 */
export async function deleteActivity(
  pool: Pool,
  actor: string,
  id: string,
  input: ActivityDeleteCommand,
): Promise<ActivityDeleteResult> {
  /**
   * 锁定配置、幂等记录与活动后核验权限及版本，所有业务变更整体提交或回滚。
   * @param db 当前事务连接
   * @returns 删除成功结果
   */
  async function remove(db: PoolConnection): Promise<ActivityDeleteResult> {
    const config = (await loadConfig(db, 'share')).published;
    ensure(activeMember(config, actor), 403, 'ACCOUNT_DISABLED', '账号或部门已停用');
    ensure(
      hasPermission(config, actor, 'activity:delete') || hasPermission(config, actor, 'activity:delete:any'),
      403,
      'FORBIDDEN',
      '无活动删除权限',
    );
    const requestHash = digest(`delete-activity:${id}:${JSON.stringify(input)}`);
    const [reserved] = await db.execute<ResultSetHeader>(
      'INSERT IGNORE INTO idempotency_records(actor_id,request_key,request_hash) VALUES (?,?,?)',
      [actor, input.idempotencyKey, requestHash],
    );
    if (!reserved.affectedRows) {
      const rows = await query<{ request_hash: string; response: unknown }>(
        db,
        'SELECT request_hash,response FROM idempotency_records WHERE actor_id=? AND request_key=? FOR UPDATE',
        [actor, input.idempotencyKey],
      );
      ensure(
        rows[0]?.request_hash === requestHash,
        409,
        'IDEMPOTENCY_CONFLICT',
        '同一个请求标识不能用于不同删除操作',
      );
      ensure(rows[0]?.response, 409, 'REQUEST_PENDING', '删除请求正在处理中，请稍后重试');
      return jsonValue<ActivityDeleteResult>(rows[0].response);
    }
    const activity = await loadActivity(db, id, true);
    ensure(activity, 404, 'NOT_FOUND', '活动不存在或已删除');
    ensure(
      canDeleteActivity(config, actor, activity),
      403,
      'DELETE_FORBIDDEN',
      '当前无删除资格；发起者需先撤回或完成取消后再删除',
    );
    ensure(activity.version === input.expectedVersion, 409, 'VERSION_CONFLICT', '活动已变化，请刷新后再删除');
    const now = new Date();
    activity.deleted = { at: now.toISOString(), by: actor, reason: input.reason };
    invalidatePending(activity);
    auditActivity(config, activity, actor, '删除活动', input.reason);
    activity.version += 1;
    activity.updatedAt = now.toISOString();
    await saveActivity(db, activity);
    await db.execute(
      'UPDATE activities SET deleted_at=?,deleted_by=?,deletion_reason=? WHERE id=? AND deleted_at IS NULL',
      [now, actor, input.reason, id],
    );
    await db.execute('UPDATE activity_surveys SET active=FALSE,version=version+1 WHERE activity_id=?', [id]);
    await db.execute('UPDATE outbox_events SET delivered=TRUE WHERE activity_id=? AND delivered=FALSE', [id]);
    await db.execute(
      'UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP(3)) WHERE activity_id=?',
      [id],
    );
    const result: ActivityDeleteResult = { id, deleted: true };
    await db.execute('UPDATE idempotency_records SET response=? WHERE actor_id=? AND request_key=?', [
      JSON.stringify(result),
      actor,
      input.idempotencyKey,
    ]);
    return result;
  }
  return transaction(pool, remove);
}
