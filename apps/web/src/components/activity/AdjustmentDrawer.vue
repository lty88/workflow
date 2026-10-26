<script setup lang="tsx">
  import { useFormValidation } from '@/composables/use-form-validation'
  import { requiredRule } from '@/composables/form-validation'
  import type { FormRules } from 'naive-ui'
  import { computed, ref, watch } from 'vue'
  import { useMediaQuery } from '@vueuse/core'
  import { NDrawer, NDrawerContent, NForm, NFormItem, NInput, NSelect, NButton, NAlert } from 'naive-ui'
  import BusinessFormAttachments from './BusinessFormAttachments.vue'
  import { createUuid } from '@workflow/domain'
  import type { Adjustment, WorkflowNode } from '@workflow/domain'
  import type { AdjustmentProps } from './types'
  import type { Directory } from '@/typings/api'
  import { adjustmentApi } from '@/api/activities'
  import { directoryApi } from '@/api/workspace'
  import { useFeedback } from '@/composables/use-feedback'
  const props = defineProps<AdjustmentProps>()
  const emit = defineEmits<{ 'update:show': [value: boolean]; done: [] }>()
  const feedback = useFeedback()
  const mobile = useMediaQuery('(max-width: 850px)')
  const directory = ref<Directory | null>(null)
  const busy = ref(false)
  const uploading = ref(false)
  const form = ref<Omit<Adjustment, 'idempotencyKey'>>({
    attachmentContextId: createUuid(),
    name: '',
    kind: 'approval',
    assignee: { type: 'user', value: '' },
    anchor: '',
    position: 'before',
    reason: '',
    expectedStructureRevision: 1,
  })
  const { formRef, validate: validateBeforeSubmit, resetValidation } = useFormValidation()
  const formRules = computed<FormRules>(() => ({
    name: requiredRule('节点名称'),
    anchor: requiredRule('参考节点', true),
    reason: requiredRule('调整原因'),
    kind: requiredRule('节点类型', true),
    position: requiredRule('插入位置', true),
    assignee: { type: requiredRule('受理人规则', true), ...(form.value.assignee.type !== 'manager' ? { value: requiredRule('受理人或角色', true) } : {}) },
  }))
  const anchors = computed(() => props.detail.activity.nodes.filter(validNode).map(nodeOption))
  const people = computed(() =>
    form.value.assignee.type === 'department_manager'
      ? (directory.value?.departments || []).filter(activeDepartment).map(option)
      : form.value.assignee.type === 'role'
        ? (directory.value?.roles || []).map(option)
        : (directory.value?.users || []).map(option)
  )
  /** 在途插入时只提供启用的指定部门。
   * @param department 部门
   * @returns 是否启用
   */
  function activeDepartment(department: { active: boolean }): boolean {
    return department.active
  }
  /**
   * 筛选有效实例节点。
   * @param node 实例节点
   * @returns 是否可作锚点
   */
  function validNode(node: WorkflowNode): boolean {
    return !['skipped', 'invalidated'].includes(node.status)
  }
  /**
   * 转换节点下拉项。
   * @param node 实例节点
   * @returns 下拉项
   */
  function nodeOption(node: WorkflowNode): { label: string; value: string } {
    return { label: node.label, value: node.id }
  }
  /**
   * 转换人员或角色下拉项。
   * @param item 配置项
   * @returns 下拉项
   */
  function option(item: { name: string; id: string }): { label: string; value: string } {
    return { label: item.name, value: item.id }
  }
  /**
   * 打开调整抽屉并加载实时人员目录。
   * @param open 是否打开
   */
  async function initialize(open: boolean): Promise<void> {
    if (!open) return
    resetValidation()
    form.value = {
      attachmentContextId: createUuid(),
      name: '',
      kind: 'approval',
      assignee: { type: 'user', value: '' },
      anchor: '',
      position: 'before',
      reason: '',
      expectedStructureRevision: props.detail.activity.structureRevision,
    }
    try {
      directory.value = await directoryApi()
    } catch (error) {
      feedback.failure(error)
    }
  }
  watch(() => props.show, initialize)
  /**
   * 清除受理方式变更后遗留的人员值。
   */
  function clearAssignee(): void {
    form.value.assignee.value = ''
  }
  /**
   * 等待附件上传后提交节点插入，保存本次材料、结构版本和受影响任务历史。
   */
  async function submit(): Promise<void> {
    if (busy.value || uploading.value || !props.detail.actions.includes('adjust') || !(await validateBeforeSubmit())) return
    busy.value = true
    try {
      await adjustmentApi(props.detail.activity.id, form.value)
      feedback.success('节点已插入，待办已按新依赖重新计算')
      emit('update:show', false)
      emit('done')
    } catch (error) {
      feedback.failure(error)
    } finally {
      busy.value = false
    }
  }
</script>
<template>
  <NDrawer
    :show="show"
    :mask-closable="!busy && !uploading"
    :close-on-esc="!busy && !uploading"
    :width="mobile ? '100%' : 520"
    @update:show="emit('update:show', $event)"
  >
    <NDrawerContent title="新增流程节点" :closable="!busy && !uploading">
      <NAlert type="warning" :bordered="false" class="mb">
        调整当前工单 R{{ detail.activity.structureRevision }}。受影响的未完成任务将重新生成；已完成意见保留。知会节点不阻断后续。
      </NAlert>
      <NForm ref="formRef" :model="form" :rules="formRules" label-placement="top" :disabled="busy || uploading">
        <NFormItem label="节点名称" path="name" required><NInput v-model:value="form.name" :maxlength="80" /></NFormItem>
        <NFormItem label="节点类型" path="kind" required>
          <NSelect
            v-model:value="form.kind"
            :options="[
              { label: '审批（全员通过）', value: 'approval' },
              { label: '任务（全员完成）', value: 'task' },
              { label: '知会（不阻断）', value: 'notice' },
            ]"
          />
        </NFormItem>
        <NFormItem label="参考节点" path="anchor" required><NSelect v-model:value="form.anchor" :options="anchors" /></NFormItem>
        <NFormItem label="插入位置" path="position" required>
          <NSelect
            v-model:value="form.position"
            :options="[
              { label: '参考节点之前', value: 'before' },
              { label: '参考节点之后', value: 'after' },
              { label: '与参考节点并行，后续汇合', value: 'parallel' },
            ]"
          />
        </NFormItem>
        <NFormItem label="受理人规则" path="assignee.type" required>
          <NSelect
            v-model:value="form.assignee.type"
            :options="[
              { label: '指定人员', value: 'user' },
              { label: '指定角色（全部成员）', value: 'role' },
              { label: '申请人部门负责人', value: 'manager' },
              { label: '指定部门负责人', value: 'department_manager' },
            ]"
            @update:value="clearAssignee"
          />
        </NFormItem>
        <NFormItem v-if="form.assignee.type !== 'manager'" label="受理人 / 角色" path="assignee.value" required>
          <NSelect v-model:value="form.assignee.value" :options="people" filterable />
        </NFormItem>
        <NFormItem label="调整原因" path="reason" required>
          <NInput v-model:value="form.reason" type="textarea" :maxlength="500" :autosize="{ minRows: 4 }" />
        </NFormItem>
        <BusinessFormAttachments
          v-if="show"
          :detail="detail"
          :context-id="form.attachmentContextId!"
          action-key="adjust"
          stage="operation"
          :disabled="busy || uploading"
          @busy="uploading = $event"
        />
      </NForm>
      <template #footer><NButton type="primary" :loading="busy" :disabled="uploading" @click="submit">确认新增节点</NButton></template>
    </NDrawerContent>
  </NDrawer>
</template>
