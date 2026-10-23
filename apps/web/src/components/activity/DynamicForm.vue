<script setup lang="tsx">
  import FormAttachmentField from './FormAttachmentField.vue'
  import { computed } from 'vue'
  import { NForm, NFormItem, NInput, NInputNumber, NSelect, NDatePicker, NCheckbox, NCheckboxGroup } from 'naive-ui'
  import { visibleFields, amountFen } from '@workflow/domain'
  import type { FormField } from '@workflow/domain'
  import type { DynamicFormProps } from './types'
  const props = defineProps<DynamicFormProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>]; 'upload-busy': [value: boolean] }>()
  const fields = computed(() => visibleFields(props.schema, props.modelValue).filter(inSection))
  /**
   * 保留当前分区的可见字段，显隐依赖仍基于完整表单。
   * @param field 字段
   * @returns 是否显示
   */
  function inSection(field: { key: string }): boolean {
    return !props.keys || props.keys.includes(field.key)
  }
  /**
   * 只更新可编辑字段并从费用明细计算总预算，受限字段保持只读。
   * @param key 字段键
   * @param value 输入值
   * @param attachmentResult 是否为已启动的附件上传完成回调，允许回填上传期间锁定的表单
   */
  function update(key: string, value: string | number | null, attachmentResult = false): void {
    const field = props.schema.fields.find(
      /**
       * 查找要修改字段的服务端只读标记。
       * @param item 表单字段
       * @returns 是否匹配字段键
       */
      function match(item) {
        return item.key === key
      }
    )
    if ((props.disabled && !attachmentResult) || !field || field.readOnly || field.redacted) return
    const next = { ...props.modelValue, [key]: value === null ? '' : String(value) }
    if (['expert_fee', 'conference_fee', 'travel_fee'].includes(key)) {
      const total = amountFen(next.expert_fee) + amountFen(next.conference_fee) + amountFen(next.travel_fee)
      next.budget = Number.isFinite(total) ? (total / 100).toFixed(2) : ''
    }
    emit('update:modelValue', next)
  }
  /**
   * 将选项文本转成Naive UI选项。
   * @param options 选项文本
   * @returns 下拉选项
   */
  function optionsFor(options: string[]): Array<{ label: string; value: string }> {
    return options.map(optionFor)
  }
  /**
   * 生成单个选项。
   * @param value 文本
   * @returns 下拉选项
   */
  function optionFor(value: string): { label: string; value: string } {
    return { label: value, value }
  }
  /**
   * 转换时间戳，保持服务端统一的ISO格式。
   * @param key 字段键
   * @param value 时间戳
   */
  function updateDate(key: string, value: number | null): void {
    update(key, value === null ? '' : new Date(value).toISOString())
  }
  /**
   * 将ISO时间转换为控件时间戳。
   * @param value ISO时间
   * @returns 有效时间戳或空
   */
  function timestamp(value?: string): number | null {
    const time = Date.parse(value || '')
    return Number.isFinite(time) ? time : null
  }
  /**
   * 保存多选值，沿用业务表单的分隔规则。
   * @param key 字段键
   * @param values 勾选项
   */
  function updateChecks(key: string, values: Array<string | number>): void {
    update(key, values.join('、'))
  }
  /**
   * 优先按字段键匹配分步校验反馈，兼容未提供结构化问题的旧表单。
   * @param field 当前字段定义
   * @returns 当前字段的错误说明
   */
  function fieldError(field: FormField): string {
    const messages: string[] = []
    if (props.issues?.length) {
      for (const issue of props.issues) if (issue.key === field.key && !messages.includes(issue.message)) messages.push(issue.message)
    } else {
      for (const message of props.errors || []) if (message.includes(field.label)) messages.push(message)
    }
    return messages.join('；')
  }
</script>
<template>
  <NForm label-placement="top" :disabled="disabled">
    <div class="form-grid">
      <NFormItem
        v-for="field in fields"
        :key="field.id"
        :id="'field-' + field.key"
        :validation-status="fieldError(field) ? 'error' : undefined"
        :feedback="fieldError(field) || undefined"
        :label="field.label"
        :required="field.required"
        :class="{ 'form-wide': field.type === 'textarea' || field.type === 'checkboxes' || field.type === 'attachment' }"
      >
        <FormAttachmentField
          v-if="field.type === 'attachment'"
          :field="field"
          :model-value="modelValue[field.key] || ''"
          :activity-id="activityId"
          :files="files"
          :prepare-upload="prepareUpload"
          :refresh-files="refreshFiles"
          :disabled="disabled || field.readOnly || field.redacted"
          @update:model-value="update(field.key, $event, true)"
          @busy="emit('upload-busy', $event)"
        />
        <NInput
          v-else-if="field.type === 'text' || field.type === 'textarea'"
          :value="modelValue[field.key] || ''"
          :disabled="disabled || field.readOnly || field.redacted"
          :type="field.type === 'textarea' ? 'textarea' : 'text'"
          :autosize="field.type === 'textarea' ? { minRows: 3, maxRows: 7 } : undefined"
          :maxlength="3000"
          :placeholder="'请输入' + field.label"
          @update:value="update(field.key, $event)"
        />
        <NInputNumber
          v-else-if="field.type === 'number'"
          :value="modelValue[field.key] ? Number(modelValue[field.key]) : null"
          :min="0"
          :precision="field.key === 'people' ? 0 : 2"
          :max="100000000"
          :disabled="disabled || field.readOnly || field.redacted || field.key === 'budget'"
          style="width: 100%"
          :placeholder="field.key === 'budget' ? '费用明细自动合计' : '请输入数字'"
          @update:value="update(field.key, $event)"
        />
        <NSelect
          v-else-if="field.type === 'select'"
          :value="modelValue[field.key] || null"
          :disabled="disabled || field.readOnly || field.redacted"
          :options="optionsFor(field.options)"
          clearable
          @update:value="update(field.key, $event)"
        />
        <NDatePicker
          v-else-if="field.type === 'datetime'"
          :value="timestamp(modelValue[field.key])"
          :disabled="disabled || field.readOnly || field.redacted"
          type="datetime"
          clearable
          style="width: 100%"
          @update:value="updateDate(field.key, $event)"
        />
        <NCheckboxGroup
          v-else-if="field.type === 'checkboxes'"
          :value="modelValue[field.key] ? modelValue[field.key]!.split('、') : []"
          :disabled="disabled || field.readOnly || field.redacted"
          @update:value="updateChecks(field.key, $event)"
        >
          <div class="gap">
            <NCheckbox v-for="option in field.options" :key="option" :value="option" :label="option" />
          </div>
        </NCheckboxGroup>
      </NFormItem>
    </div>
  </NForm>
</template>
