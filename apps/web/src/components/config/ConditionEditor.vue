<script setup lang="tsx">
  import { computed } from 'vue'
  import { NCheckbox, NFormItem, NInput, NSelect } from 'naive-ui'
  import type { Condition, FormField } from '@workflow/domain'
  import type { ConditionProps } from './types'
  const props = defineProps<ConditionProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: Condition | undefined] }>()
  const fields = computed(() => props.fields.filter(otherField).map(fieldOption))
  /**
   * 排除字段本身，防止直接循环。
   * @param field 字段
   * @returns 是否候选
   */
  function otherField(field: FormField): boolean {
    return field.type !== 'attachment' && field.key !== props.excluded
  }
  /**
   * 转换条件字段下拉项。
   * @param field 字段
   * @returns 下拉项
   */
  function fieldOption(field: FormField): { label: string; value: string } {
    return { label: field.label, value: field.key }
  }
  /**
   * 启用或移除条件规则。
   * @param checked 是否开启
   */
  function toggle(checked: boolean): void {
    emit('update:modelValue', checked ? { field: fields.value[0]?.value || '', operator: 'eq', value: '' } : undefined)
  }
  /**
   * 更新条件的单一属性。
   * @param key 属性
   * @param value 新值
   */
  function update(key: keyof Condition, value: string): void {
    if (!props.modelValue) return
    emit('update:modelValue', { ...props.modelValue, [key]: value })
  }
</script>
<template>
  <div class="mb">
    <NCheckbox :checked="!!modelValue" @update:checked="toggle">{{ label || '满足条件时生效' }}</NCheckbox>
    <div v-if="modelValue" class="stack" style="gap: 10px; margin-top: 14px">
      <NSelect :value="modelValue.field" :options="fields" placeholder="选择依赖字段" @update:value="update('field', $event)" />
      <NSelect
        :value="modelValue.operator"
        :options="[
          { label: '等于', value: 'eq' },
          { label: '不等于', value: 'neq' },
          { label: '大于等于（数字）', value: 'gte' },
        ]"
        @update:value="update('operator', $event)"
      />
      <NInput :value="modelValue.value" placeholder="条件值必须与字段选项一致" @update:value="update('value', $event)" />
    </div>
  </div>
</template>
