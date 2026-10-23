import type { Activity, AttachmentOptions, FileRecord, FormDefinition, FormField } from './types';
import { visibleFields } from './forms';
export const ATTACHMENT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx'] as const;
/** 取得附件字段的数量、大小与格式规则，兼容未设置选项的历史定义。
 * @param field 附件字段
 * @returns 可直接用于控件和服务端校验的上传规则
 */
export function attachmentOptions(field: FormField): AttachmentOptions {
  return field.upload || { maxCount: 10, maxSizeMB: 20, extensions: [...ATTACHMENT_EXTENSIONS] };
}
/** 解析表单保存的附件ID数组；空值视为未上传，损坏或重复的引用返回空标记。
 * @param value 字段原始输入
 * @returns 附件ID列表，格式无效时返回null
 */
export function attachmentIds(value?: string): string[] | null {
  if (!value?.trim()) return [];
  try {
    const ids: unknown = JSON.parse(value);
    if (!Array.isArray(ids) || ids.length > 10) return null;
    for (const id of ids)
      if (typeof id !== 'string' || !id.trim() || id.length > 80 || id !== id.trim()) return null;
    return new Set(ids).size === ids.length ? ids : null;
  } catch {
    return null;
  }
}
/** 检查文件的扩展名及真实大小是否满足当前附件字段限制。
 * @param field 附件字段
 * @param file 文件名与字节数
 * @returns 用户可理解的校验错误
 */
export function attachmentFileErrors(field: FormField, file: Pick<FileRecord, 'name' | 'size'>): string[] {
  const rules = attachmentOptions(field);
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const errors: string[] = [];
  if (!rules.extensions.includes(extension))
    errors.push(`${field.label}仅支持${rules.extensions.join('、').toUpperCase()}格式`);
  if (file.size <= 0 || file.size > rules.maxSizeMB * 1024 * 1024)
    errors.push(`${field.label}单个文件需大于0且不超过${rules.maxSizeMB}MB`);
  return errors;
}
/** 核对附件ID真实属于该活动、申请阶段和字段，草稿保存也不能伪造其他字段或活动的引用。
 * @param form 活动使用的完整表单
 * @param payload 已合并的输入
 * @param files 该活动的真实文件元数据
 * @param activityId 当前活动ID
 * @returns 引用、格式、大小与数量错误
 */
export function validateAttachmentReferences(
  form: FormDefinition,
  payload: Record<string, string>,
  files: FileRecord[],
  activityId: string,
): string[] {
  const errors: string[] = [];
  for (const field of form.fields) {
    if (field.type !== 'attachment') continue;
    const ids = attachmentIds(payload[field.key]);
    if (ids === null) {
      errors.push(`${field.label}附件数据格式无效`);
      continue;
    }
    if (ids.length > attachmentOptions(field).maxCount)
      errors.push(`${field.label}最多上传${attachmentOptions(field).maxCount}个文件`);
    for (const id of ids) {
      let file: FileRecord | undefined;
      for (const candidate of files) if (candidate.id === id) file = candidate;
      if (
        !file ||
        file.activityId !== activityId ||
        file.fieldKey !== field.key ||
        file.stage !== 'application'
      ) {
        errors.push(`${field.label}包含不属于本活动该字段的附件`);
        continue;
      }
      errors.push(...attachmentFileErrors(field, file));
    }
  }
  return [...new Set(errors)];
}
/** 定位当前申请和历史快照中真实引用文件的可见字段，供直接下载与详情授权共同使用。
 * @param activity 活动及历史表单快照
 * @param file 需要读取的文件
 * @returns 实际引用该文件的可见附件字段
 */
export function attachmentFieldsForFile(activity: Activity, file: FileRecord): FormField[] {
  if (!file.fieldKey || file.stage !== 'application' || file.activityId !== activity.id) return [];
  const fields: FormField[] = [];
  for (const snapshot of [activity, ...activity.snapshots])
    for (const field of visibleFields(snapshot.schema, snapshot.payload))
      if (
        field.key === file.fieldKey &&
        field.type === 'attachment' &&
        attachmentIds(snapshot.payload[field.key])?.includes(file.id)
      )
        fields.push(field);
  return fields;
}
