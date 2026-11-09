import type { Pool } from 'mysql2/promise';
import type { Activity } from '@workflow/domain';
import {
  actOnCollaboration,
  dispatchCollaboration,
  collaborationParent,
  findById,
  lifecycleOf,
} from '@workflow/domain';
import type { CollaborationActionCommand, CollaborationDispatchCommand } from '@workflow/domain';
import { findRequestTask } from '../db/request-store';
import { activityFiles, enqueue } from '../db/repository';
import { mutateActivity } from './activity-service';
import type { MutationContext } from './activity-service';
import { validateOperationAttachments, linkOperationAttachments } from './operation-attachments';
import { ensure } from '../errors';

/** 在个人待办所属申请的幂等事务内派发协作，原子保存节点及投递待办。
 * @param pool 数据库连接池
 * @param actor 当前会话审批人
 * @param taskId 父个人审批待办
 * @param command 派发规则和幂等标识
 * @returns 更新后的申请版本
 */
export async function createCollaboration(
  pool: Pool,
  actor: string,
  taskId: string,
  command: CollaborationDispatchCommand,
) {
  const rows = await findRequestTask(pool, taskId, actor);
  ensure(rows[0], 404, 'NOT_FOUND', '当前审批待办不存在');
  /** 在主单锁内复核当前审批资格并派发任务。
   * @param context 事务及实时配置
   * @returns 变更后的申请
   */
  async function apply(context: MutationContext): Promise<Activity> {
    ensure(context.activity, 404, 'NOT_FOUND', '申请不存在');
    dispatchCollaboration(context.config, actor, context.activity, taskId, command);
    return context.activity;
  }
  return mutateActivity(
    pool,
    actor,
    command.idempotencyKey,
    `collaboration-create:${taskId}:${JSON.stringify(command)}`,
    rows[0].activity_id,
    apply,
  );
}

/** 提交成果或验收返工，在同一事务校验附件归属、任务轮次和实例版本并发送通知。
 * @param pool 连接池
 * @param actor 当前会话操作者
 * @param id 所属申请
 * @param nodeId 协作节点
 * @param command 操作及并发版本
 * @returns 更新后的申请版本
 */
export async function updateCollaboration(
  pool: Pool,
  actor: string,
  id: string,
  nodeId: string,
  command: CollaborationActionCommand,
) {
  /** 校验本次成果附件后执行状态变更并通知验收人。
   * @param context 已锁定主单及配置
   * @returns 变更后的申请
   */
  async function apply(context: MutationContext): Promise<Activity> {
    const activity = context.activity;
    ensure(activity, 404, 'NOT_FOUND', '申请不存在');
    const node = findById(activity.nodes, nodeId);
    ensure(node?.collaboration, 404, 'NOT_FOUND', '协作任务不存在');
    const parent = collaborationParent(activity, node);
    let hasAttachment = false;
    if (command.action === 'submit' || command.action === 'save') {
      await validateOperationAttachments(
        context,
        actor,
        command.attachmentContextId,
        'collaboration-submit',
        'node',
        nodeId,
      );
      const files = await activityFiles(context.connection, id, lifecycleOf(activity).businessType);
      for (const file of files)
        if (
          command.attachmentContextId &&
          file.contextId === command.attachmentContextId &&
          file.nodeId === nodeId &&
          file.uploaderId === actor
        )
          hasAttachment = true;
    } else ensure(!command.attachmentContextId, 422, 'VALIDATION', '验收操作不接受成果附件分组');
    actOnCollaboration(context.config, actor, activity, nodeId, command, hasAttachment);
    if (command.action === 'submit') linkOperationAttachments(context, command.attachmentContextId);
    if (parent && command.action === 'submit')
      await enqueue(
        context.connection,
        activity,
        parent.assignee,
        `待验收：${node.label}`,
        `collaboration-review:${node.id}:${node.generation}`,
      );
    return activity;
  }
  return mutateActivity(
    pool,
    actor,
    command.idempotencyKey,
    `collaboration-action:${id}:${nodeId}:${JSON.stringify(command)}`,
    id,
    apply,
  );
}
