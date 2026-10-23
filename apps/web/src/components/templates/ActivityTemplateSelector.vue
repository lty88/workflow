<script setup lang="tsx">
import { computed, ref, watch } from 'vue';
import { NAlert, NFormItem, NSelect, NTag } from 'naive-ui';
import { templateExecutionSummary } from '@workflow/domain';
import type { TemplateSelectorProps } from './types';
import type { TemplateSelection, TemplateSummary } from '@workflow/domain';
const props = defineProps<TemplateSelectorProps>();
const emit = defineEmits<{ 'update:modelValue': [value: TemplateSelection | null] }>();
const typeId = ref(props.modelValue?.activityTypeId || '');
const typeOptions = computed(() => props.types.map(typeOption));
const candidates = computed(() => props.templates.filter(matchesType));
const options = computed(() => candidates.value.map(templateOption));
const selected = computed(() => props.templates.find(matchesSelection));
const execution = computed(() =>
  selected.value ? templateExecutionSummary(selected.value.definition.nodes) : null,
);
/**
 * 将活动类型转成下拉选项。
 * @param item 活动类型
 * @returns 类型选项
 */
function typeOption(item: { id: string; name: string }) {
  return { label: item.name, value: item.id };
}
/**
 * 筛选当前活动类型可用的已发布模板。
 * @param item 已授权模板
 * @returns 是否可选
 */
function matchesType(item: TemplateSummary): boolean {
  return item.definition.activityTypeIds.includes(typeId.value);
}
/**
 * 匹配当前绑定模板。
 * @param item 已授权模板
 * @returns 是否选中
 */
function matchesSelection(item: TemplateSummary): boolean {
  return item.id === props.modelValue?.templateId;
}
/**
 * 显示模板名称、版本与默认推荐标记。
 * @param item 已发布模板
 * @returns 选择项
 */
function templateOption(item: TemplateSummary) {
  return {
    label: `${item.definition.name} · V${item.version}${item.definition.defaultForTypeIds.includes(typeId.value) ? ' · 默认推荐' : ''}`,
    value: item.id,
  };
}
/**
 * 明确选取模板及其当前版本，清空时要求申请人重新选择。
 * @param id 模板标识或空
 */
function select(id: string | null): void {
  for (const template of candidates.value)
    if (template.id === id) {
      emit('update:modelValue', {
        activityTypeId: typeId.value,
        templateId: id,
        expectedTemplateVersion: template.version,
      });
      return;
    }
  emit('update:modelValue', null);
}
/**
 * 更换活动类型后，优先选择唯一默认模板；多个非默认模板由申请人明确选择。
 * @param id 活动类型标识
 */
function changeType(id: string): void {
  typeId.value = id;
  let recommended = candidates.value.length === 1 ? candidates.value[0] : undefined;
  for (const item of candidates.value) if (item.definition.defaultForTypeIds.includes(id)) recommended = item;
  select(recommended?.id || null);
}
/** 初始化或刷新模板选择，同步已载入草稿的类型，不覆盖有效选择。 */
function initialize(): void {
  if (props.modelValue) {
    typeId.value = props.modelValue.activityTypeId;
    return;
  }
  if (!typeId.value && props.types[0]) changeType(props.types[0].id);
}
watch(() => props.modelValue, initialize);
watch(() => props.templates, initialize, { immediate: true });
</script>
<template>
  <div class="template-selection">
    <NFormItem label="活动类型" required
      ><NSelect
        :value="typeId || null"
        :options="typeOptions"
        :disabled="disabled"
        placeholder="请选择活动类型"
        @update:value="changeType"
    /></NFormItem>
    <NFormItem label="活动流程模板" required
      ><NSelect
        :value="modelValue?.templateId || null"
        :options="options"
        :disabled="disabled"
        placeholder="请选择已发布的流程模板"
        @update:value="select"
    /></NFormItem>
    <NAlert v-if="!candidates.length" type="warning"
      >此类型暂无可用模板，请联系配置管理员发布或启用模板。</NAlert
    >
    <div v-if="selected" class="template-summary">
      <NTag type="info" :bordered="false">{{ selected.definition.name }} · V{{ selected.version }}</NTag>
      <NAlert
        v-if="execution"
        :type="execution.approvals ? 'info' : 'warning'"
        :bordered="false"
        class="execution-hint"
        >{{ execution.message }}</NAlert
      >
      <p>
        本模板共{{
          selected.definition.nodes.length
        }}个节点。填写后请预览实际受理人和条件分支，提交时将保存此版本快照。
      </p>
    </div>
  </div>
</template>
<style scoped>
.template-selection {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 24px;
}
.template-summary,
.template-selection > .n-alert {
  grid-column: 1/-1;
}
.execution-hint {
  margin-top: 12px;
}
.template-summary p {
  font-size: 13px;
  color: #687993;
  margin: 10px 0 0;
}
@media (max-width: 700px) {
  .template-selection {
    grid-template-columns: 1fr;
  }
}
</style>
