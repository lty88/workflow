<script setup lang="tsx">
  import { useFormValidation } from '@/composables/use-form-validation'
  import { requiredRule } from '@/composables/form-validation'
  import { computed, ref, watch } from 'vue'
  import { useMediaQuery } from '@vueuse/core'
  import { NAlert, NButton, NDrawer, NDrawerContent, NForm, NFormItem, NInput, NSelect } from 'naive-ui'
  import { createUuid } from '@workflow/domain'
  import BusinessFormAttachments from './BusinessFormAttachments.vue'
  import type { ActivityDetail, WorkflowTask } from '@workflow/domain'
  import type { Directory } from '@/typings/api'
  import { directoryApi } from '@/api/workspace'
  import { transferApi } from '@/api/workflow'
  import { useFeedback } from '@/composables/use-feedback'
  const props = defineProps<{ show: boolean; task?: WorkflowTask; detail: ActivityDetail }>()
  const emit = defineEmits<{ 'update:show': [value: boolean]; done: [] }>()
  const feedback = useFeedback()
  const mobile = useMediaQuery('(max-width: 850px)')
  const users = ref<Directory['users']>([])
  const assignee = ref<string | null>(null)
  const reason = ref('')
  const busy = ref(false)
  const uploading = ref(false)
  const attachmentContextId = ref(createUuid())
  const { formRef, validate: validateBeforeSubmit, resetValidation } = useFormValidation()
  const formModel = computed(() => ({ assignee: assignee.value, reason: reason.value }))
  const formRules = { assignee: requiredRule('新受理人', true), reason: requiredRule('转交原因') }
  const options = computed(() => users.value.map(option))
  /**
   * 转换成员选项。
   * @param user 成员
   * @returns 下拉项
   */
  function option(user: Directory['users'][number]): { label: string; value: string } {
    return { label: user.name, value: user.id }
  }
  /**
   * 打开时加载当前有效成员。
   * @param open 是否打开
   */
  async function initialize(open: boolean): Promise<void> {
    if (!open) return
    resetValidation()
    attachmentContextId.value = createUuid()
    assignee.value = null
    reason.value = ''
    try {
      users.value = (await directoryApi()).users
    } catch (error) {
      feedback.failure(error)
    }
  }
  watch(() => props.show, initialize)
  /**
   * 等待附件上传后按任务版本转交，关联本次材料并刷新详情。
   */
  async function submit(): Promise<void> {
    if (busy.value || uploading.value || !props.task || !props.detail.actions.includes('adjust') || !(await validateBeforeSubmit())) return
    busy.value = true
    try {
      await transferApi(props.task.id, {
        assignee: assignee.value || '',
        reason: reason.value,
        attachmentContextId: attachmentContextId.value,
        expectedTaskVersion: props.task.version,
      })
      feedback.success('待办已转交')
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
    :width="mobile ? '100%' : 480"
    @update:show="emit('update:show', $event)"
  >
    <NDrawerContent title="转交待办" :closable="!busy && !uploading">
      <NAlert type="info" class="mb">只转交未办理任务。新受理人须具备节点动作权限和数据范围；审批仍遵守禁止自审规则。</NAlert>
      <NForm ref="formRef" :model="formModel" :rules="formRules" label-placement="top" :disabled="busy || uploading">
        <NFormItem label="新受理人" path="assignee" required><NSelect v-model:value="assignee" :options="options" filterable /></NFormItem>
        <NFormItem label="转交原因" path="reason" required>
          <NInput v-model:value="reason" type="textarea" :maxlength="500" :autosize="{ minRows: 4 }" />
        </NFormItem>
        <BusinessFormAttachments
          v-if="show"
          :detail="detail"
          :context-id="attachmentContextId"
          action-key="adjust"
          stage="operation"
          :disabled="busy || uploading"
          @busy="uploading = $event"
        />
      </NForm>
      <template #footer><NButton type="primary" :loading="busy" :disabled="uploading" @click="submit">确认转交</NButton></template>
    </NDrawerContent>
  </NDrawer>
</template>
