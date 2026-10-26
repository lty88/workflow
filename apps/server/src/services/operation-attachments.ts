import { attachmentContextCommitted } from '@workflow/domain';
import type { FileRecord } from '@workflow/domain';
import type { MutationContext } from './activity-service';
import { activityFiles } from '../db/repository';
import { ensure } from '../errors';

/**
 * 验证表单附件仅来自本活动、本提交人、本次动作，正式提交时关联操作审计。
 * @param context 已锁定的活动事务上下文
 * @param actor 当前提交人
 * @param contextId 本次附件分组
 * @param actionKey 上传时的动作标识
 * @param stage 本次动作允许的文件阶段
 * @param nodeId 节点办理时的实际节点标识
 */
export async function validateOperationAttachments(
  context: MutationContext,
  actor: string,
  contextId: string | undefined,
  actionKey: string,
  stage: FileRecord['stage'],
  nodeId?: string,
): Promise<void> {
  if (!contextId) return;
  const activity = context.activity!;
  ensure(
    !attachmentContextCommitted(activity, contextId),
    409,
    'ATTACHMENTS_COMMITTED',
    '本次记录或附件已提交，请刷新后查看',
  );
  const files = (await activityFiles(context.connection, activity.id)).filter(
    (file) => file.contextId === contextId,
  );
  ensure(
    files.length <= 10 &&
      files.every(
        (file) =>
          file.uploaderId === actor &&
          file.stage === stage &&
          file.actionKey === actionKey &&
          file.nodeId === nodeId,
      ),
    422,
    'FILE_CONTEXT',
    '附件与本次提交的活动、人员或业务动作不匹配',
  );
}

/**
 * 为已成功执行的业务操作记录附件归属，后续详情按原权限展示。
 * @param context 活动事务上下文
 * @param contextId 已校验的附件分组
 */
export function linkOperationAttachments(context: MutationContext, contextId: string | undefined): void {
  if (!contextId) return;
  const event = context.activity!.audit.at(-1);
  if (event) event.attachmentContextId = contextId;
}
