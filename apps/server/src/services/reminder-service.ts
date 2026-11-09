import { REQUEST_CATALOG, REQUEST_TASK_CATALOG, REQUEST_NODE_CATALOG } from '../db/request-store';
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { Activity } from '@workflow/domain';
import { canHandleTask, canReadActivity, findById, hasPermission } from '@workflow/domain';
import { enqueue, loadActivity, loadConfig, query, transaction } from '../db/repository';
let after = '';

/**
 * 跳过已删除活动并扫描当前待办，24小时提醒受理人，48小时通知有管理范围的流程负责人；不代替人工决定。
 * @param pool 数据库连接池
 */
export async function scheduleReminders(pool: Pool): Promise<void> {
  /**
   * 逐批锁定审批中活动，以当前任务版本去重提醒。
   * @param connection 事务连接
   */
  async function scan(connection: PoolConnection): Promise<void> {
    const config = (await loadConfig(connection, 'share')).published;
    const rows = await query<{ id: string }>(
      connection,
      `SELECT DISTINCT a.id FROM ${REQUEST_CATALOG} a JOIN ${REQUEST_TASK_CATALOG} t ON t.activity_id=a.id JOIN ${REQUEST_NODE_CATALOG} n ON n.id=t.node_id WHERE a.deleted_at IS NULL AND a.status='approving' AND a.id>? AND t.status='pending' AND (CAST(JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.createdAt')) AS CHAR) < ? OR JSON_UNQUOTE(JSON_EXTRACT(n.data,'$.collaboration.dueAt')) < ?) ORDER BY a.id LIMIT 100`,
      [after, new Date(Date.now() - 24 * 3600000).toISOString(), new Date().toISOString()],
    );
    after = rows.at(-1)?.id || '';
    for (const row of rows) {
      const activity = await loadActivity(connection, row.id, true);
      if (!activity || activity.status !== 'approving') continue;
      for (const task of activity.tasks) {
        const age = Date.now() - Date.parse(task.createdAt || activity.updatedAt);
        const node = findById(activity.nodes, task.nodeId);
        if (task.status !== 'pending' || node?.status !== 'active' || task.generation !== node.generation)
          continue;
        if (node.collaboration?.dueAt && Date.parse(node.collaboration.dueAt) < Date.now() && canHandleTask(config, task.assignee, activity, task)) {
          const parent = findById(activity.tasks, node.collaboration.parentTaskId);
          const recipients = new Set([task.assignee, parent?.assignee]);
          for (const recipient of recipients) if (recipient) await enqueue(connection, activity, recipient, `协作任务已逾期：${node.label}`, `collaboration-due:${task.id}:${node.collaboration.dueAt}:${recipient}`);
        }
        if (age >= 24 * 3600000 && canHandleTask(config, task.assignee, activity, task))
          await enqueue(
            connection,
            activity,
            task.assignee,
            `待办超过24小时：${activity.name}`,
            `remind:${task.id}:${task.version}:24`,
          );
        if (age >= 48 * 3600000 || !canHandleTask(config, task.assignee, activity, task))
          for (const user of config.users)
            if (
              hasPermission(config, user.id, 'workflow:adjust') &&
              canReadActivity(config, user.id, activity)
            )
              await enqueue(
                connection,
                activity,
                user.id,
                `流程需关注：${activity.name} · ${node.label}`,
                `escalate:${task.id}:${task.version}:${user.id}`,
              );
      }
    }
  }
  return transaction(pool, scan);
}
