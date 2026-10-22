import { computed, nextTick, ref, watch } from 'vue';
import { validateForm } from '@workflow/domain';
import type { FormValidationIssue } from '@workflow/domain';
import type { ActivityStepOptions, ActivityStepValidation } from './types';
import {
  activityStepKeys,
  isBasicField,
  validateActivityStep,
  validateActivityTransition,
} from './step-validation';

/**
 * 管理申请分步校验与字段定位，阻止下一步或顶部跳步绕过校验，并保留后退和不完整草稿能力。
 * @param options 模板表单、完整输入、模板有效性及禁用状态
 * @returns 当前步骤、错误、字段集合、步骤切换、提交前校验及错误定位能力
 */
export function useActivitySteps(options: ActivityStepOptions) {
  const step = ref(1);
  const errors = ref<string[]>([]);
  const issues = ref<FormValidationIssue[]>([]);
  const attemptedStep = ref<number | null>(null);
  const sectionKeys = computed(() => activityStepKeys(options.schema.value, step.value));

  /**
   * 展示目标步骤的错误，随后输入变化时更新该步骤反馈。
   * @param result 当前步骤校验结果
   */
  function applyValidation(result: ActivityStepValidation): void {
    step.value = result.step;
    errors.value = result.errors;
    issues.value = result.issues;
    attemptedStep.value = result.step;
  }

  /**
   * 等待字段渲染后滚动到具体输入，模板错误定位到选择区域。
   * @param key 字段键或模板选择标记
   */
  async function focusField(key: string): Promise<void> {
    await nextTick();
    if (typeof document === 'undefined') return;
    const element = document.getElementById(
      key === '__template__' ? 'activity-template-selection' : 'field-' + key,
    );
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element?.querySelector<HTMLElement>('input,textarea,button,[tabindex="0"]')?.focus();
  }

  /**
   * 所有前进方式共用校验；后退直接放行，操作中或提交待确认时禁止切换。
   * @param target 目标步骤序号
   */
  async function changeStep(target: number): Promise<void> {
    if (
      options.disabled.value ||
      !Number.isInteger(target) ||
      target < 1 ||
      target > 3 ||
      target === step.value
    )
      return;
    if (target > step.value) {
      const result = validateActivityTransition(
        options.schema.value,
        options.payload.value,
        target,
        options.hasTemplate.value,
      );
      if (result.errors.length) {
        applyValidation(result);
        await focusField(result.issues[0]!.key);
        return;
      }
    }
    step.value = target;
    errors.value = [];
    issues.value = [];
    attemptedStep.value = null;
  }

  /**
   * 根据字段键定位错误，兼容服务端返回的文本错误。
   * @param message 校验错误文本
   */
  async function locateError(message: string): Promise<void> {
    if (options.disabled.value) return;
    for (const issue of issues.value)
      if (issue.message === message) {
        step.value = issue.key === '__template__' || isBasicField(issue.key) ? 1 : 2;
        await focusField(issue.key);
        return;
      }
    for (const field of options.schema.value.fields)
      if (message.includes(field.label)) {
        step.value = isBasicField(field.key) ? 1 : 2;
        await focusField(field.key);
        return;
      }
  }

  /**
   * 预览与提交时复核全部可见字段，发现问题后返回对应步骤；隐藏原值仍由服务端完整校验。
   * @returns 当前模板与全部可填写字段是否通过
   */
  function validateAll(): boolean {
    const transition = validateActivityTransition(
      options.schema.value,
      options.payload.value,
      3,
      options.hasTemplate.value,
    );
    if (transition.errors.length) {
      applyValidation(transition);
      void focusField(transition.issues[0]!.key);
      return false;
    }
    const keys = [
      ...activityStepKeys(options.schema.value, 1, false),
      ...activityStepKeys(options.schema.value, 2, false),
    ];
    const result = validateForm(options.schema.value, options.payload.value, keys);
    errors.value = result.errors;
    issues.value = result.issues;
    attemptedStep.value = null;
    return result.errors.length === 0;
  }

  /** 当前步骤校验失败后，随着用户修正输入刷新错误，未操作的后续步骤不提前报错。 */
  function refreshValidation(): void {
    if (attemptedStep.value !== step.value) return;
    const result = validateActivityStep(
      options.schema.value,
      options.payload.value,
      step.value,
      options.hasTemplate.value,
    );
    errors.value = result.errors;
    issues.value = result.issues;
  }
  watch(options.payload, refreshValidation, { deep: true });
  watch(options.hasTemplate, refreshValidation);
  watch(options.schema, refreshValidation);
  return { step, errors, issues, sectionKeys, changeStep, locateError, validateAll };
}
