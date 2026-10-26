<script setup lang="tsx">
  import { useFormValidation } from '@/composables/use-form-validation'
  import { requiredRule } from '@/composables/form-validation'
  import { computed, ref } from 'vue'
  import { NAlert, NButton, NInput, NModal, NSpace, NForm, NFormItem } from 'naive-ui'
  import { createUuid } from '@workflow/domain'
  import type { ActivityDetail } from '@workflow/domain'
  import BusinessFormAttachments from './BusinessFormAttachments.vue'
  import { activityApi, deleteActivityApi } from '@/api/activities'
  import { ApiError } from '@/api/http'
  import { useAuthStore } from '@/stores/auth'
  import { useFeedback } from '@/composables/use-feedback'
  import type { DeleteActivityProps } from './types'
  const props = defineProps<DeleteActivityProps>()
  const emit = defineEmits<{ deleted: []; refresh: [] }>()
  const auth = useAuthStore()
  const feedback = useFeedback()
  const open = ref(false)
  const busy = ref(false)
  const uploading = ref(false)
  const attachmentContextId = ref(createUuid())
  const fullDetail = ref<ActivityDetail | null>(null)
  const reason = ref('')
  const expectedVersion = ref(0)
  const { formRef, validate: validateBeforeSubmit, resetValidation } = useFormValidation()
  const formModel = computed(() => ({ reason: reason.value }))
  const formRules = { reason: requiredRule('删除原因') }
  const visible = computed(() => props.allowed && (auth.can('activity:delete') || auth.can('activity:delete:any')))

  /** 请求最新活动与删除资格，清空上次材料分组后展示确认并冻结版本。 */
  async function showConfirmation(): Promise<void> {
    if (!visible.value || busy.value || uploading.value || props.disabled) return
    busy.value = true
    try {
      fullDetail.value = await activityApi(props.activity.id)
      if (!fullDetail.value.actions.includes('delete')) throw new Error('当前活动已不允许删除，请刷新后查看')
      resetValidation()
      reason.value = ''
      attachmentContextId.value = createUuid()
      expectedVersion.value = fullDetail.value.activity.version
      open.value = true
    } catch (error) {
      feedback.failure(error)
      emit('refresh')
    } finally {
      busy.value = false
    }
  }

  /** 等待附件上传后核验权限和原因，按刷新后的版本提交删除，冲突时重新读取活动。 */
  async function remove(): Promise<void> {
    if (!visible.value || busy.value || uploading.value || props.disabled) return
    if (!(await validateBeforeSubmit())) return
    const note = reason.value.trim()
    busy.value = true
    try {
      await deleteActivityApi(props.activity.id, expectedVersion.value, note, attachmentContextId.value)
      open.value = false
      feedback.success('活动已删除')
      emit('deleted')
    } catch (error) {
      feedback.failure(error)
      if (error instanceof ApiError && [403, 409].includes(error.status)) {
        open.value = false
        emit('refresh')
      }
      if (error instanceof ApiError && error.status === 404) {
        open.value = false
        emit('deleted')
      }
    } finally {
      busy.value = false
    }
  }
</script>
<template>
  <NButton
    v-if="visible"
    :text="!prominent"
    :secondary="prominent"
    type="error"
    :size="prominent ? 'medium' : 'small'"
    :disabled="disabled || busy"
    @click.stop.prevent="showConfirmation"
  >
    {{ prominent ? '删除活动' : '删除' }}
  </NButton>
  <NModal
    v-model:show="open"
    preset="card"
    title="删除活动"
    :style="{ width: '480px', maxWidth: 'calc(100vw - 32px)' }"
    :mask-closable="!busy && !uploading"
    :close-on-esc="!busy && !uploading"
    :closable="!busy && !uploading"
  >
    <div class="delete-activity-title">
      <strong>{{ activity.name || '未命名草稿' }}</strong>
      <span>{{ activity.code }}</span>
    </div>
    <NAlert type="warning" :bordered="false">删除后活动将从列表、待办和看板中移除，未完成任务停止，评价链接失效。审批、附件和评价历史会保留。</NAlert>
    <NForm ref="formRef" :model="formModel" :rules="formRules" label-placement="top" style="margin-top: 20px">
      <NFormItem label="删除原因" path="reason" required>
        <NInput
          v-model:value="reason"
          type="textarea"
          :disabled="busy || uploading"
          :maxlength="500"
          show-count
          :autosize="{ minRows: 3, maxRows: 6 }"
          placeholder="请说明删除原因，例如：重复创建的测试活动"
          aria-label="删除原因"
        />
      </NFormItem>
    </NForm>
    <BusinessFormAttachments
      v-if="open && fullDetail"
      :detail="fullDetail"
      :context-id="attachmentContextId"
      action-key="delete"
      stage="operation"
      :disabled="busy || uploading"
      @busy="uploading = $event"
      @refreshed="expectedVersion = $event"
    />
    <template #footer>
      <NSpace justify="end">
        <NButton :disabled="busy || uploading" @click="open = false">保留活动</NButton>
        <NButton type="error" :loading="busy" :disabled="uploading || !visible" @click="remove">确认删除</NButton>
      </NSpace>
    </template>
  </NModal>
</template>
<style scoped>
  .delete-activity-title {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 18px;
  }
  .delete-activity-title strong {
    font-size: 16px;
    word-break: break-word;
  }
  .delete-activity-title span {
    font-size: 12px;
    color: #8390a7;
  }
  .delete-reason-label {
    display: block;
    font-size: 14px;
    margin: 20px 0 10px;
  }
  .delete-reason-label span {
    font-size: 12px;
    color: #8390a7;
    margin-left: 8px;
  }
</style>
