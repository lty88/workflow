import type { CompanyConfig } from '@workflow/domain';
import { findById } from '@workflow/domain';
import type { Database } from '../db/repository';

/**
 * 记录敏感阅读、附件预览和下载行为，不将资料内容或文件名写入审计。
 * @param db 当前连接
 * @param config 当前组织
 * @param actor 当前成员
 * @param activityId 活动标识
 * @param action 访问动作
 * @param resourceId 可选资源标识
 */
export async function recordDataAccess(
  db: Database,
  config: CompanyConfig,
  actor: string,
  activityId: string,
  action: string,
  resourceId?: string,
): Promise<void> {
  const event = {
    id: crypto.randomUUID(),
    actor,
    actorName: findById(config.users, actor)?.name || actor,
    action,
    note: '',
    fileId: resourceId,
    createdAt: new Date().toISOString(),
  };
  await db.execute('INSERT INTO audit_events(id,activity_id,actor_id,action,data) VALUES (?,?,?,?,?)', [
    event.id,
    activityId,
    actor,
    action,
    JSON.stringify(event),
  ]);
}
