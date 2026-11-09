<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NAlert, NButton, NTag, NModal, NFormItem, NInput, NCheckbox, NEmpty } from 'naive-ui'
  import { createUuid } from '@workflow/domain'
  import type { FileRecord, WorkflowNode } from '@workflow/domain'
  import type { CollaborationPanelProps, CollaborationAction } from './types'
  import { COLLABORATION_STATES } from './types'
  import AttachmentList from '@/components/activity/AttachmentList.vue'
  import BusinessFormAttachments from '@/components/activity/BusinessFormAttachments.vue'
  import { collaborationActionApi } from '@/api/workflow'
  import { formatTime } from '@/composables/format'
  import { useFeedback } from '@/composables/use-feedback'
  const props = defineProps<CollaborationPanelProps>()
  const emit = defineEmits<{ done: [] }>()
  const feedback = useFeedback()
  const history = ref(false)
  const root = ref<HTMLElement>()
  const nodes = computed(() =>
    props.detail.activity.nodes.filter(
      (node) =>
        node.collaboration &&
        (history.value || ((node.applicationRevision || 1) === (props.detail.activity.revision || 1) && node.collaboration.state !== 'cancelled'))
    )
  )
  const total = computed(() => props.detail.activity.nodes.some((node) => node.collaboration))
  const selected = ref<WorkflowNode>()
  const action = ref<CollaborationAction>('submit')
  const open = ref(false)
  const busy = ref(false)
  const uploading = ref(false)
  const summary = ref('')
  const error = ref('')
  const contextId = ref('')
  const uploadedFiles = ref<FileRecord[]>([])
  const modalTitle = computed(() => ({ save: '保存进展', submit: '提交任务成果', accept: '验收通过', return: '退回补充', cancel: '撤销任务' })[action.value])
  /** 使用详情参与者快照显示人员名称。
   * @param id 人员标识
   * @returns 姓名或标识
   */
  function person(id?: string): string {
    return props.detail.participants.find((item) => item.id === id)?.name || id || '—'
  }
  /** 查询服务端授予的操作能力，前端不自行扩大办理权限。
   * @param node 协作节点
   * @param kind 提交或验收
   * @returns 是否可展示对应入口
   */
  function allowed(node: WorkflowNode, kind: 'submit' | 'review'): boolean {
    return !props.readOnly && !!props.detail.collaborationCapabilities?.[kind === 'submit' ? 'submitNodeIds' : 'reviewNodeIds'].includes(node.id)
  }
  /** 打开本次操作并建立独立成果附件分组。
   * @param node 当前协作节点
   * @param kind 本次操作
   */
  function begin(node: WorkflowNode, kind: CollaborationAction): void {
    if (!allowed(node, kind === 'submit' ? 'submit' : 'review')) return
    selected.value = node
    action.value = kind
    summary.value = kind === 'submit' ? node.collaboration?.draft?.summary || '' : ''
    error.value = ''
    contextId.value = kind === 'submit' ? node.collaboration?.draft?.attachmentContextId || createUuid() : createUuid()
    uploadedFiles.value = props.detail.files
    open.value = true
  }
  /** 从固定操作栏打开本人首个成果表单，验收人定位到任务清单。
   */
  function openMyTask(): void {
    for (const node of nodes.value)
      if (allowed(node, 'submit')) {
        begin(node, 'submit')
        return
      }
    root.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    root.value?.focus({ preventScroll: true })
  }
  defineExpose({ openMyTask })
  /** 上传后同步申请版本，避免同一人的上传造成提交版本冲突。
   * @param _nextVersion 子组件维护的最新版本
   * @param files 最新已授权附件
   */
  function refreshed(_nextVersion: number, files: FileRecord[]): void {
    uploadedFiles.value = files
  }
  /** 校验必填说明与附件后保存进展、提交成果或验收，并刷新父页面。
   * @param save 是否仅保存本人进展草稿
   */
  async function submit(save = false): Promise<void> {
    const node = selected.value
    if (!node || busy.value || uploading.value || !allowed(node, action.value === 'submit' ? 'submit' : 'review')) return
    const needsSummary = !save && action.value !== 'accept'
    error.value = ''
    if (needsSummary && !summary.value.trim()) {
      error.value = action.value === 'submit' ? '请填写成果说明' : '请填写原因或补充要求'
      return
    }
    if (
      !save &&
      action.value === 'submit' &&
      node.collaboration?.attachmentRequired &&
      !uploadedFiles.value.some((file) => file.nodeId === node.id && file.contextId === contextId.value)
    ) {
      error.value = '请上传本次成果附件'
      return
    }
    busy.value = true
    try {
      await collaborationActionApi(props.detail.activity.id, node.id, {
        action: save ? 'save' : action.value,
        generation: node.generation,
        expectedCollaborationVersion: node.collaboration?.version || 1,
        summary: summary.value,
        attachmentContextId: action.value === 'submit' ? contextId.value : undefined,
      })
      feedback.success(save ? '进展已保存' : modalTitle.value + '成功')
      open.value = false
      emit('done')
    } catch (cause) {
      feedback.failure(cause)
    } finally {
      busy.value = false
    }
  }
</script>
<template>
  <section v-if="total" ref="root" tabindex="-1" class="collaboration-panel">
    <header class="panel-heading">
      <div><h2>协作任务</h2><p class="panel-subtitle">查看任务交付、补充记录与验收结果</p></div>
      <NCheckbox v-model:checked="history">显示历史与撤销任务</NCheckbox>
    </header>
    <NEmpty v-if="!nodes.length" description="当前没有协作任务，可勾选查看历史与撤销任务" size="small" />
    <article v-for="node in nodes" :key="node.id" class="collaboration-card">
      <header>
        <strong>{{ node.label }}</strong>
        <NTag :bordered="false" :type="node.collaboration!.state === 'accepted' ? 'success' : node.collaboration!.state === 'submitted' ? 'warning' : 'info'">
          {{ node.status === 'waiting' ? '等待前序验收' : COLLABORATION_STATES[node.collaboration!.state] }}
        </NTag>
      </header>
      <p class="task-meta">
        所属审批 {{ detail.activity.nodes.find((item) => item.id === node.collaboration!.parentNodeId)?.label }} · 办理人 {{ person(node.assignees[0]) }} ·
        验收人 {{ person(detail.activity.tasks.find((item) => item.id === node.collaboration!.parentTaskId)?.assignee) }}
      </p>
      <p v-if="node.collaboration!.dueAt" class="task-meta">
        截止 {{ formatTime(node.collaboration!.dueAt) }}
        <NTag
          v-if="Date.parse(node.collaboration!.dueAt) < Date.now() && !['accepted', 'cancelled'].includes(node.collaboration!.state)"
          size="small"
          type="error"
          :bordered="false"
        >
          已逾期
        </NTag>
      </p>
      <NAlert
        v-for="warning in detail.taskWarnings.filter((item) => detail.activity.tasks.some((task) => task.id === item.taskId && task.nodeId === node.id))"
        :key="warning.taskId"
        type="warning"
        :bordered="false"
      >
        {{ warning.message }}
      </NAlert>
      <p class="task-instructions">{{ node.collaboration!.instructions }}</p>
      <div v-for="record in node.collaboration!.submissions" :key="record.id" class="task-submission">
        <strong>第 {{ record.generation }} 轮成果 · {{ person(record.submittedBy) }} · {{ formatTime(record.submittedAt) }}</strong>
        <p>{{ record.summary }}</p>
        <p v-if="record.review">
          {{ record.review.decision === 'accept' ? '验收通过' : '退回补充' }} · {{ person(record.review.actor) }} · {{ record.review.comment || '已确认' }}
        </p>
      </div>
      <AttachmentList
        :activity-id="detail.activity.id"
        :activity-version="detail.activity.version"
        :files="detail.files"
        stage="node"
        compact-empty
        :node-id="node.id"
        :node-scope="detail.access?.nodeAttachmentScopes?.[node.id]"
        include-contexts
        :can-upload="false"
        @uploaded="emit('done')"
      />
      <footer v-if="allowed(node, 'submit') || allowed(node, 'review')">
        <NButton v-if="allowed(node, 'submit')" type="primary" @click="begin(node, 'submit')">提交成果</NButton>
        <template v-if="allowed(node, 'review')">
          <NButton v-if="node.collaboration!.state === 'submitted'" type="success" @click="begin(node, 'accept')">验收通过</NButton>
          <NButton v-if="node.collaboration!.state === 'submitted'" type="warning" secondary @click="begin(node, 'return')">退回补充</NButton>
          <NButton tertiary type="error" @click="begin(node, 'cancel')">撤销任务</NButton>
        </template>
      </footer>
    </article>
    <NModal
      :show="open"
      preset="card"
      :title="modalTitle"
      style="width: min(620px, 95vw)"
      :mask-closable="!busy && !uploading"
      :close-on-esc="!busy && !uploading"
      :closable="!busy && !uploading"
      @update:show="open = $event"
    >
      <template v-if="selected">
        <p>{{ selected.label }}</p>
        <NAlert v-if="error" type="error" class="mb">{{ error }}</NAlert>
        <NFormItem :label="action === 'submit' ? '成果说明' : '意见或补充要求'" :required="action !== 'accept'">
          <NInput v-model:value="summary" type="textarea" :autosize="{ minRows: 4 }" :disabled="busy || uploading" maxlength="4000" />
        </NFormItem>
        <BusinessFormAttachments
          v-if="action === 'submit'"
          :detail="detail"
          stage="node"
          :node-id="selected.id"
          :context-id="contextId"
          action-key="collaboration-submit"
          :disabled="busy"
          @busy="uploading = $event"
          @refreshed="refreshed"
        />
      </template>
      <template #footer>
        <div class="modal-actions">
          <NButton :disabled="busy || uploading" @click="open = false">取消</NButton>
          <NButton v-if="action === 'submit'" :disabled="busy || uploading" @click="submit(true)">保存进展</NButton>
          <NButton type="primary" :loading="busy" :disabled="uploading" @click="submit(false)">{{ modalTitle }}</NButton>
        </div>
      </template>
    </NModal>
  </section>
</template>
<style scoped>
  .collaboration-panel {
    margin-top: 0;
  }
  .panel-heading,
  .collaboration-card header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 4px;
  }
  .panel-subtitle { margin: 0; font-size: 12px; color: #8b99ad; }
  .panel-heading { margin-bottom: 20px; }
  .collaboration-card {
    border: 1px solid #dce6f7;
    border-radius: 12px;
    padding: 18px;
    background: #fff;
    margin-top: 12px;
  }
  .task-meta {
    font-size: 12px;
    color: #78879c;
    line-height: 1.8;
  }
  .task-instructions,
  .task-submission p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.8;
  }
  .task-submission {
    padding: 12px;
    margin: 10px 0;
    background: #f5f8fd;
    border-radius: 8px;
    font-size: 13px;
  }
  footer,
  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
    margin-top: 12px;
  }
</style>
