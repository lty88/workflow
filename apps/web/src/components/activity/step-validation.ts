import { validateForm } from '@workflow/domain';
import type { FormDefinition } from '@workflow/domain';
import type { ActivityStepValidation } from './types';

/**
 * 判断字段是否归入活动基础信息，其他动态字段归入内容与预算。
 * @param key 表单字段键
 * @returns 是否属于第一步
 */
export function isBasicField(key: string): boolean {
  return [
    'activity_name',
    'delivery_mode',
    'start_at',
    'end_at',
    'location',
    'meeting_url',
    'nature',
    'service_type',
  ].includes(key);
}

/**
 * 取得当前步骤的字段键，受限占位值由服务端使用原值校验。
 * @param form 当前模板表单
 * @param step 步骤序号
 * @param includeRedacted 是否包含只读脱敏占位字段，展示时保留，校验时排除
 * @returns 当前步骤字段键
 */
export function activityStepKeys(form: FormDefinition, step: number, includeRedacted = true): string[] {
  const keys: string[] = [];
  if (step !== 1 && step !== 2) return keys;
  for (const field of form.fields)
    if ((includeRedacted || !field.redacted) && isBasicField(field.key) === (step === 1))
      keys.push(field.key);
  return keys;
}

/**
 * 在完整显隐上下文中校验单步，基础步骤同时要求有效活动类型和流程模板。
 * @param form 当前模板表单
 * @param payload 完整用户输入
 * @param step 需要校验的步骤
 * @param hasTemplate 是否已选择当前可用的模板版本
 * @returns 本步骤错误摘要和可定位的字段问题
 */
export function validateActivityStep(
  form: FormDefinition,
  payload: Record<string, string>,
  step: number,
  hasTemplate: boolean,
): ActivityStepValidation {
  const result = validateForm(form, payload, activityStepKeys(form, step, false));
  const issues = [...result.issues];
  if (step === 1 && !hasTemplate)
    issues.unshift({ key: '__template__', message: '请选择活动类型和有效的流程模板' });
  const errors: string[] = [];
  for (const issue of issues) if (!errors.includes(issue.message)) errors.push(issue.message);
  return { step, errors, issues };
}

/**
 * 校验目标步骤之前的所有步骤，防止通过顶部步骤条跳过基础或内容必填项。
 * @param form 当前模板表单
 * @param payload 完整用户输入
 * @param target 将要进入的步骤
 * @param hasTemplate 当前模板是否有效
 * @returns 第一个未通过步骤；全部通过时返回目标步骤及空错误
 */
export function validateActivityTransition(
  form: FormDefinition,
  payload: Record<string, string>,
  target: number,
  hasTemplate: boolean,
): ActivityStepValidation {
  for (let step = 1; step < Math.min(target, 3); step += 1) {
    const result = validateActivityStep(form, payload, step, hasTemplate);
    if (result.errors.length) return result;
  }
  return { step: target, errors: [], issues: [] };
}
