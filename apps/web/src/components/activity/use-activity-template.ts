import { computed, ref, watch } from 'vue';
import { defaultValues, lifecycleOf } from '@workflow/domain';
import type { Activity, ActivityType, FormField, TemplateSelection, TemplateSummary } from '@workflow/domain';
import { activityTypesApi, templatesApi } from '@/api/templates';
import { ApiError } from '@/api/http';
import { useFeedback } from '@/composables/use-feedback';
import type { ActivityTemplateOptions } from './types';

/**
 * 管理申请的活动类型、模板发布版本与冻结表单，提供刷新、恢复和冲突处理能力。
 * @param options 表单输入、后备表单、现有字段受限状态与清除旧预览的回调
 * @returns 模板状态、对应表单、读取目录、恢复旧单选择和冲突恢复方法
 */
export function useActivityTemplate(options: ActivityTemplateOptions) {
  const feedback = useFeedback();
  const templates = ref<TemplateSummary[]>([]);
  const activityTypes = ref<ActivityType[]>([]);
  const selection = ref<TemplateSelection | null>(null);
  const templateNotice = ref('');
  const selectedTemplate = computed(() => templates.value.find(matches));
  const schema = computed(() => {
    const base = selectedTemplate.value?.form || options.fallbackForm.value;
    const existing = options.existingDetail?.value;
    if (!existing) return base;
    const fields: FormField[] = [];
    const hidden = new Set(existing.access?.hiddenFieldKeys || []);
    for (const field of base.fields) {
      let old: FormField | undefined;
      for (const candidate of existing.activity.schema.fields)
        if (candidate.key === field.key) old = candidate;
      if (hidden.has(field.key)) {
        if (old?.redacted) fields.push({ ...old });
        continue;
      }
      fields.push(old?.readOnly ? { ...field, readOnly: true } : field);
    }
    return { ...base, fields };
  });
  /**
   * 匹配当前选择的已发布模板。
   * @param template 授权模板
   * @returns 是否选中
   */
  function matches(template: TemplateSummary): boolean {
    return template.id === selection.value?.templateId;
  }
  /**
   * 更换模板时保留兼容输入并补齐默认值，旧预览立即失效。
   * @param value 新模板选择
   */
  function changed(value: TemplateSelection | null): void {
    options.invalidatePreview();
    if (!value) return;
    const next = defaultValues(schema.value);
    for (const field of schema.value.fields)
      if (Object.hasOwn(options.payload.value, field.key))
        next[field.key] = options.payload.value[field.key]!;
    options.payload.value = next;
  }
  /** 从接口刷新当前身份可选模板，已发布版本变化后要求重新预览。 */
  async function refreshTemplates(): Promise<void> {
    const [available, types] = await Promise.all([templatesApi(undefined, options.businessType?.value || 'activity'), activityTypesApi()]);
    templates.value = available;
    activityTypes.value = options.businessType?.value === 'general' ? [{id:'general',code:'general',name:'通用申请',active:true,sort:0}] : types;
    if (!selection.value) return;
    const previous = selection.value;
    let next: TemplateSummary | undefined;
    for (const item of available)
      if (
        item.id === previous.templateId &&
        (lifecycleOf(item.definition).businessType === 'general' ? previous.activityTypeId === 'general' : item.definition.activityTypeIds.includes(previous.activityTypeId))
      )
        next = item;
    selection.value = next ? { ...previous, expectedTemplateVersion: next.version } : null;
  }
  /**
   * 处理模板版本、启停或授权冲突，保留业务输入并刷新选择。
   * @param error 接口异常
   */
  async function recoverTemplate(error: unknown): Promise<void> {
    if (
      !(error instanceof ApiError) ||
      !['TEMPLATE_VERSION_CONFLICT', 'TEMPLATE_UNAVAILABLE', 'TEMPLATE_FORBIDDEN'].includes(error.code)
    )
      return;
    templateNotice.value = error.message;
    options.invalidatePreview();
    try {
      await refreshTemplates();
    } catch (reloadError) {
      feedback.failure(reloadError);
    }
  }
  /**
   * 将旧单或复制来源匹配到当前有效模板，保留版本变化提示。
   * @param activity 活动来源
   */
  function restoreSelection(activity: Activity): void {
    let matching: TemplateSummary | undefined;
    for (const item of templates.value) if (item.id === activity.templateId) matching = item;
    if (
      matching &&
      activity.activityTypeId &&
      (lifecycleOf(matching.definition).businessType === 'general' ? activity.activityTypeId === 'general' : matching.definition.activityTypeIds.includes(activity.activityTypeId))
    ) {
      selection.value = {
        activityTypeId: activity.activityTypeId,
        templateId: matching.id,
        expectedTemplateVersion: matching.version,
      };
      if (activity.templateVersion !== matching.version)
        templateNotice.value = `原申请使用V${activity.templateVersion}，当前为V${matching.version}。重提使用当前版本，请核对字段并重新预览。`;
    } else {
      selection.value = null;
      templateNotice.value = activity.templateId
        ? '原模板已停用或不在当前授权范围，请选择可用模板并预览。'
        : '此单来自历史流程，请选择已发布模板并预览后提交。';
    }
  }
  watch(selection, changed);
  return {
    templates,
    activityTypes,
    selection,
    templateNotice,
    selectedTemplate,
    schema,
    refreshTemplates,
    restoreSelection,
    recoverTemplate,
  };
}
