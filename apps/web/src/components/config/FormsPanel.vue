<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { useMediaQuery } from '@vueuse/core'
  import { NButton, NCard, NDrawer, NDrawerContent, NForm, NFormItem, NInput, NSelect, NSwitch, NTag, NPopconfirm, NAlert } from 'naive-ui'
  import type { CompanyConfig, FormField } from '@workflow/domain'
  import type { ConfigPanelProps } from './types'
  import { FIELD_TYPES } from './types'
  import { clone, newId } from '@/composables/format'
  import { useFeedback } from '@/composables/use-feedback'
  import ConditionEditor from './ConditionEditor.vue'
  import FieldAccessEditor from '@/components/security/FieldAccessEditor.vue'
  import DynamicForm from '@/components/activity/DynamicForm.vue'
  import AttachmentFieldSettings from './AttachmentFieldSettings.vue'
  import { attachmentOptions, defaultValues } from '@workflow/domain'
  const props = defineProps<ConfigPanelProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: CompanyConfig] }>()
  const feedback = useFeedback()
  const mobile = useMediaQuery('(max-width: 850px)')
  const editing = ref<FormField | null>(null)
  const open = ref(false)
  const previewOpen = ref(false)
  const preview = ref<Record<string, string>>({})
  const optionText = ref('')
  const existing = ref(false)
  const dragIndex = ref(-1)
  const dropIndex = ref(-1)
  const dropAfter = ref(false)
  const typeOptions = Object.entries(FIELD_TYPES).map(typeOption)
  const fields = computed(() => props.modelValue.form.fields)
  const requiredCount = computed(
    () =>
      fields.value.filter(
        /**
         * 统计必填字段数量。
         * @param field 当前字段
         * @returns 是否必填
         */ function required(field) {
          return !!field.required
        }
      ).length
  )
  /**
   * 转换字段类型选项。
   * @param pair 类型键值
   * @returns 下拉项
   */
  function typeOption(pair: [string, string]): { label: string; value: string } {
    return { label: pair[1], value: pair[0] }
  }
  /**
   * 打开新增或已有字段的编辑抽屉。
   * @param field 既有字段
   */
  function edit(field?: FormField): void {
    existing.value = !!field
    editing.value = field ? clone(field) : { id: newId('f'), key: '', label: '', type: 'text', required: false, default: '', options: [] }
    optionText.value = editing.value.options.join('\n')
    open.value = true
  }
  /**
   * 校验稳定键并提交当前表单并保留修订记录。
   */
  async function save(): Promise<void> {
    if (props.saving) return
    if (!editing.value) return
    const item = clone(editing.value)
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(item.key) || !item.label.trim()) {
      feedback.failure(new Error('请填写名称与2至40位英文小写字段键'))
      return
    }
    for (const field of fields.value)
      if (field.id !== item.id && field.key === item.key) {
        feedback.failure(new Error('字段键已存在'))
        return
      }
    if (item.type === 'attachment') item.default = ''
    else delete item.upload
    item.options = ['select', 'checkboxes'].includes(item.type) ? optionText.value.split('\n').map(trimOption).filter(Boolean) : []
    const next = clone(props.modelValue)
    const index = next.form.fields.findIndex(matchesEditing)
    if (index < 0) next.form.fields.push(item)
    else next.form.fields[index] = item
    try {
      if (props.persist) await props.persist(next)
      else emit('update:modelValue', next)
    } catch (error) {
      feedback.failure(error)
      return
    }
    open.value = false
  }
  /** 切换控件时清理不适用的上传规则或默认值。
   * @param type 新控件类型
   */
  function changeType(type: FormField['type']): void {
    if (!editing.value || editing.value.system) return
    editing.value.type = type
    if (type === 'attachment') {
      editing.value.default = ''
      editing.value.upload = attachmentOptions(editing.value)
    } else delete editing.value.upload
  }
  /**
   * 匹配当前编辑字段。
   * @param field 字段
   * @returns 是否同一字段
   */
  function matchesEditing(field: FormField): boolean {
    return field.id === editing.value?.id
  }
  /**
   * 清理选项两端空格。
   * @param value 选项
   * @returns 清理后的文本
   */
  function trimOption(value: string): string {
    return value.trim()
  }
  /**
   * 提交字段变动，优先走自动保存，失败时保留草稿由页面按钮兜底。
   * @param next 修改后的配置
   */
  async function apply(next: CompanyConfig): Promise<void> {
    try {
      if (props.persist) await props.persist(next)
      else emit('update:modelValue', next)
    } catch (error) {
      feedback.failure(error)
    }
  }
  /**
   * 删除非系统字段，跨模块引用由保存接口校验。
   * @param id 字段标识
   */
  function remove(id: string): void {
    const next = clone(props.modelValue)
    const index = next.form.fields.findIndex(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param field 当前集合项
       * @returns 是否符合筛选条件
       */ function match(field) {
        return field.id === id
      }
    )
    if (index < 0 || next.form.fields[index]?.system) return
    next.form.fields.splice(index, 1)
    void apply(next)
  }
  /**
   * 移动字段到指定位置，支持拖拽与上下箭头两种操作。
   * @param from 原索引
   * @param to 目标索引
   */
  function reorder(from: number, to: number): void {
    if (from === to || from < 0 || to < 0) return
    const next = clone(props.modelValue)
    const item = next.form.fields.splice(from, 1)[0]!
    next.form.fields.splice(to, 0, item)
    void apply(next)
  }
  /**
   * 调整字段展示顺序。
   * @param index 当前索引
   * @param offset 移动方向
   */
  function move(index: number, offset: number): void {
    const other = index + offset
    if (other < 0 || other >= fields.value.length) return
    reorder(index, other)
  }
  /**
   * 记录被拖拽的字段行。
   * @param index 字段索引
   */
  function dragStart(index: number): void {
    dragIndex.value = index
  }
  /**
   * 按指针在行内的位置计算插入点，上半插入行前、下半插入行后。
   * @param event 拖拽事件
   * @param index 当前行索引
   */
  function dragOver(event: DragEvent, index: number): void {
    event.preventDefault()
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    dropAfter.value = event.clientY - box.top > box.height / 2
    dropIndex.value = index
  }
  /**
   * 在目标行落下后重排字段并清除拖拽状态。
   * @param index 目标行索引
   */
  function drop(index: number): void {
    const from = dragIndex.value
    const after = dropAfter.value
    resetDrag()
    if (from < 0 || from === index) return
    let to = after ? index + 1 : index
    if (from < to) to -= 1
    reorder(from, to)
  }
  /** 清除拖拽高亮，拖拽取消或结束时使用。 */
  function resetDrag(): void {
    dragIndex.value = -1
    dropIndex.value = -1
    dropAfter.value = false
  }
  /**
   * 使用当前编辑内容初始化动态表单试填。
   */
  function showPreview(): void {
    preview.value = defaultValues(props.modelValue.form)
    previewOpen.value = true
  }
</script>
<template>
  <NCard :title="modelValue.form.name">
    <template #header-extra>
      <div class="gap">
        <NButton size="small" @click="showPreview">试填预览</NButton>
        <NButton type="primary" size="small" @click="edit()">＋ 新增字段</NButton>
      </div>
    </template>
    <p class="help-text">
      共 {{ fields.length }} 个字段 · {{ requiredCount }} 个必填 ·
      按住左侧手柄拖动排序，也可用右侧上下箭头调整。字段键保存后保持稳定，系统字段用于金额、时间和流程计算。
    </p>
    <div class="config-list" @dragend="resetDrag">
      <div
        v-for="(field, index) in fields"
        :key="field.id"
        class="config-item form-row"
        :class="{ dragging: dragIndex === index, 'drop-before': dropIndex === index && !dropAfter, 'drop-after': dropIndex === index && dropAfter }"
        @dragover="dragOver($event, index)"
        @dragleave="resetDrag"
        @drop="drop(index)"
      >
        <span class="drag-handle" draggable="true" title="按住拖动排序" aria-label="拖动排序" @dragstart="dragStart(index)" />
        <div class="config-main">
          <div class="page-title">
            <strong>{{ field.label }}</strong>
            <NTag v-if="field.required" size="small" type="info" :bordered="false">必填</NTag>
            <NTag v-if="field.system" size="small" :bordered="false">系统</NTag>
          </div>
          <small class="page-meta">
            {{ field.key }} · {{ FIELD_TYPES[field.type] }}
            <span v-if="field.visible">· 条件显示</span>
          </small>
        </div>
        <div class="config-actions">
          <NButton size="tiny" quaternary :disabled="index === 0" title="上移" @click="move(index, -1)">↑</NButton>
          <NButton size="tiny" quaternary :disabled="index === fields.length - 1" title="下移" @click="move(index, 1)">↓</NButton>
          <NButton size="small" text type="primary" @click="edit(field)">编辑</NButton>
          <NPopconfirm v-if="!field.system" @positive-click="remove(field.id)">
            <template #trigger><NButton size="small" text type="error">删除</NButton></template>
            删除后请检查条件与流程引用。
          </NPopconfirm>
        </div>
      </div>
    </div>
  </NCard>
  <NDrawer :z-index="overlayZIndex || 2000" v-model:show="open" :width="mobile ? '100%' : 520">
    <NDrawerContent :title="existing ? '编辑字段' : '新增字段'" closable>
      <NForm v-if="editing" label-placement="top">
        <NFormItem label="字段名称" required><NInput v-model:value="editing.label" :maxlength="80" /></NFormItem>
        <NFormItem label="字段键（英文小写 / 数字 / 下划线）" required><NInput v-model:value="editing.key" :disabled="existing" :maxlength="40" /></NFormItem>
        <NFormItem label="控件类型"><NSelect :value="editing.type" @update:value="changeType" :options="typeOptions" :disabled="editing.system" /></NFormItem>
        <NFormItem label="必填"><NSwitch v-model:value="editing.required" :disabled="editing.system" /></NFormItem>
        <NFormItem v-if="['select', 'checkboxes'].includes(editing.type)" label="选项（每行一个）" required>
          <NInput v-model:value="optionText" type="textarea" :autosize="{ minRows: 4 }" />
        </NFormItem>
        <AttachmentFieldSettings v-if="editing.type === 'attachment'" :model-value="attachmentOptions(editing)" @update:model-value="editing.upload = $event" />
        <NFormItem v-else label="默认值">
          <NInput v-model:value="editing.default" placeholder="多选使用顿号连接，日期使用ISO格式" :maxlength="3000" />
        </NFormItem>
        <ConditionEditor v-if="!editing.system" v-model="editing.visible" :fields="fields" :excluded="editing.key" label="满足条件时显示" />
        <NAlert v-else type="info">此字段参与系统计算，条件显隐保持固定；数据权限可单独配置。</NAlert>
        <FieldAccessEditor v-model="editing.access" :config="modelValue" />
      </NForm>
      <template #footer><NButton type="primary" :loading="saving" :disabled="saving" @click="save">保存</NButton></template>
    </NDrawerContent>
  </NDrawer>
  <NDrawer :z-index="overlayZIndex || 2000" v-model:show="previewOpen" :width="mobile ? '100%' : 820">
    <NDrawerContent title="动态表单试填" closable>
      <NAlert type="info" class="mb">试填只保留在当前页面，可检查条件显隐与费用合计。</NAlert>
      <DynamicForm v-model="preview" :schema="modelValue.form" />
    </NDrawerContent>
  </NDrawer>
</template>
