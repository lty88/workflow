<script setup lang="tsx">
import { computed } from 'vue';
import {
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NDatePicker,
  NCheckbox,
  NCheckboxGroup,
} from 'naive-ui';
import { visibleFields, amountFen } from '@workflow/domain';
import type { DynamicFormProps } from './types';
const props = defineProps<DynamicFormProps>();
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>] }>();
const fields = computed(() => visibleFields(props.schema, props.modelValue).filter(inSection));
/**
 * 保留当前分区的可见字段，显隐依赖仍基于完整表单。
 * @param field 字段
 * @returns 是否显示
 */
function inSection(field: { key: string }): boolean {
  return !props.keys || props.keys.includes(field.key);
}
/**
 * 更新字段并从费用明细计算总预算。
 * @param key 字段键
 * @param value 输入值
 */
function update(key: string, value: string | number | null): void {
  const next = { ...props.modelValue, [key]: value === null ? '' : String(value) };
  if (['expert_fee', 'conference_fee', 'travel_fee'].includes(key)) {
    const total = amountFen(next.expert_fee) + amountFen(next.conference_fee) + amountFen(next.travel_fee);
    next.budget = Number.isFinite(total) ? (total / 100).toFixed(2) : '';
  }
  emit('update:modelValue', next);
}
/**
 * 将选项文本转成Naive UI选项。
 * @param options 选项文本
 * @returns 下拉选项
 */
function optionsFor(options: string[]): Array<{ label: string; value: string }> {
  return options.map(optionFor);
}
/**
 * 生成单个选项。
 * @param value 文本
 * @returns 下拉选项
 */
function optionFor(value: string): { label: string; value: string } {
  return { label: value, value };
}
/**
 * 转换时间戳，保持服务端统一的ISO格式。
 * @param key 字段键
 * @param value 时间戳
 */
function updateDate(key: string, value: number | null): void {
  update(key, value === null ? '' : new Date(value).toISOString());
}
/**
 * 将ISO时间转换为控件时间戳。
 * @param value ISO时间
 * @returns 有效时间戳或空
 */
function timestamp(value?: string): number | null {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
}
/**
 * 保存多选值，沿用业务表单的分隔规则。
 * @param key 字段键
 * @param values 勾选项
 */
function updateChecks(key: string, values: Array<string | number>): void {
  update(key, values.join('、'));
}
/**
 * 查找当前字段的校验错误，供表单反馈与读屏提示使用。
 * @param label 字段名称
 * @returns 该字段的错误文本
 */
function fieldError(label: string): string {
  return (props.errors || [])
    .filter(
      /**
       * 匹配字段名称对应的校验错误。
       * @param message 错误文本
       * @returns 是否匹配
       */ function match(message) {
        return message.includes(label);
      },
    )
    .join('；');
}
</script>
<template>
  <NForm label-placement="top" :disabled="disabled"
    ><div class="form-grid">
      <NFormItem
        v-for="field in fields"
        :key="field.id"
        :id="'field-' + field.key"
        :validation-status="fieldError(field.label) ? 'error' : undefined"
        :feedback="fieldError(field.label) || undefined"
        :label="field.label"
        :required="field.required"
        :class="{ 'form-wide': field.type === 'textarea' || field.type === 'checkboxes' }"
        ><NInput
          v-if="field.type === 'text' || field.type === 'textarea'"
          :value="modelValue[field.key] || ''"
          :type="field.type === 'textarea' ? 'textarea' : 'text'"
          :autosize="field.type === 'textarea' ? { minRows: 3, maxRows: 7 } : undefined"
          :maxlength="3000"
          :placeholder="'请输入' + field.label"
          @update:value="update(field.key, $event)" /><NInputNumber
          v-else-if="field.type === 'number'"
          :value="modelValue[field.key] ? Number(modelValue[field.key]) : null"
          :min="0"
          :precision="field.key === 'people' ? 0 : 2"
          :max="100000000"
          :disabled="disabled || field.key === 'budget'"
          style="width: 100%"
          :placeholder="field.key === 'budget' ? '费用明细自动合计' : '请输入数字'"
          @update:value="update(field.key, $event)" /><NSelect
          v-else-if="field.type === 'select'"
          :value="modelValue[field.key] || null"
          :options="optionsFor(field.options)"
          clearable
          @update:value="update(field.key, $event)" /><NDatePicker
          v-else-if="field.type === 'datetime'"
          :value="timestamp(modelValue[field.key])"
          type="datetime"
          clearable
          style="width: 100%"
          @update:value="updateDate(field.key, $event)" /><NCheckboxGroup
          v-else-if="field.type === 'checkboxes'"
          :value="modelValue[field.key] ? modelValue[field.key]!.split('、') : []"
          @update:value="updateChecks(field.key, $event)"
          ><div class="gap">
            <NCheckbox
              v-for="option in field.options"
              :key="option"
              :value="option"
              :label="option"
            /></div></NCheckboxGroup
      ></NFormItem></div
  ></NForm>
</template>
