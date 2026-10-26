<script setup lang="tsx">
  import { computed, ref, watch } from 'vue'
  import { useMediaQuery } from '@vueuse/core'
  import { NDrawer, NDrawerContent, NForm, NFormItem, NInput, NSelect, NButton, NCheckbox, NAlert, NRadioGroup, NRadioButton } from 'naive-ui'
  import type { FormRules } from 'naive-ui'
  import type { FileRecord } from '@workflow/domain'
  import { createUuid, executionReportErrors, isHttps } from '@workflow/domain'
  import { useFormValidation } from '@/composables/use-form-validation'
  import { requiredRule } from '@/composables/form-validation'
  import BusinessFormAttachments from './BusinessFormAttachments.vue'
  import ExecutionReportForm from './ExecutionReportForm.vue'
  import { actionApi } from '@/api/activities'
  import { decisionApi } from '@/api/workflow'
  import { directoryApi } from '@/api/workspace'
  import type { Directory } from '@/typings/api'
  import type { ActionProps } from './types'
  import { ACTION_LABELS } from './types'
  import { useFeedback } from '@/composables/use-feedback'
  const props = defineProps<ActionProps>()
  const emit = defineEmits<{ 'update:show': [value: boolean]; done: [] }>()
  const feedback = useFeedback()
  const mobile = useMediaQuery('(max-width: 850px)')
  const busy = ref(false)
  const uploading = ref(false)
  const attachmentContextId = ref(createUuid())
  const attachmentVersion = ref(props.detail.activity.version)
  const reportAction = computed(() => ['report', 'execution-complete'].includes(props.action))
  const attachmentStage = computed(() => (props.task ? 'node' : reportAction.value ? 'execution' : props.action === 'archive-submit' ? 'archive' : 'operation'))
  const { formRef, validate: validateBeforeSubmit, resetValidation } = useFormValidation()
  const hasArchiveFile = ref(false)
  const commentRequired = computed(
    () => !props.task && ['assign', 'archive-submit', 'archive-return', 'cancel-request', 'cancel-reject'].includes(props.action)
  )
  const formModel = computed(() => ({
    executor: executor.value,
    report: report.value,
    comment: comment.value,
    publicComment: publicComment.value,
    disposal: disposal.value,
    checks: checks.value,
    url: url.value,
  }))
  const formRules = computed<FormRules>(() => ({
    ...(props.action === 'assign' ? { executor: requiredRule('执行负责人', true) } : {}),
    ...(reportAction.value
      ? {
          report: {
            start: requiredRule('实际开始时间', true),
            end: requiredRule('实际结束时间', true),
            people: requiredRule('实到人数'),
            summary: requiredRule('执行情况与成果'),
            ...(props.action === 'execution-complete' && report.value.people === 0 ? { exception: requiredRule('零人数原因') } : {}),
          },
        }
      : {}),
    ...(commentRequired.value
      ? { comment: requiredRule(props.action === 'assign' ? '执行安排' : props.action === 'archive-submit' ? '成果摘要' : '意见或原因') }
      : {}),
    ...(props.task && decision.value !== 'approve' ? { publicComment: requiredRule('公开补充要求或原因') } : {}),
    ...(props.action === 'cancel-request' && props.detail.activity.status === 'executing' ? { disposal: requiredRule('已发生费用处置方式') } : {}),
    ...(props.action === 'archive-submit' && !hasArchiveFile.value ? { url: requiredRule('成果链接或上传成果附件') } : {}),
    ...(props.action === 'archive-approve'
      ? {
          checks: {
            required: true,
            /** 全部归档检查项确认后才发送审核请求。
             * @returns 全部确认标记或字段错误
             */
            validator() {
              return checks.value.length === 3 && checks.value.every(Boolean) ? true : new Error('请确认全部归档检查项')
            },
            trigger: 'change',
          },
        }
      : {}),
  }))
  const directory = ref<Directory | null>(null)
  const decision = ref<'approve' | 'return' | 'reject'>('approve')
  const comment = ref('')
  const publicComment = ref('')
  const executor = ref<string | null>(null)
  const url = ref('')
  const disposal = ref('')
  const checks = ref([false, false, false])
  const report = ref({ title: '', start: '', end: '', people: 0, summary: '', spend: '', exception: '' })
  const nodeKind = computed(() => props.detail.activity.nodes.find(matchesNode)?.kind)
  const executors = computed(() => (directory.value?.users || []).filter(canExecute).map(memberOption))
  const title = computed(() => (props.task ? (nodeKind.value === 'approval' ? '办理审批' : '完成节点任务') : ACTION_LABELS[props.action] || '办理工单'))
  /**
   * 找到当前任务节点。
   * @param node 节点
   * @returns 是否对应
   */
  function matchesNode(node: { id: string }): boolean {
    return node.id === props.task?.nodeId
  }
  /**
   * 筛选可执行成员并排除终审人，防止执行归档与归档审核由同一人完成。
   * @param user 成员
   * @returns 是否有执行权限
   */
  function canExecute(user: Directory['users'][number]): boolean {
    return user.canExecute && user.id !== props.detail.activity.workflowOwnerId
  }
  /**
   * 转换成员下拉项。
   * @param user 成员
   * @returns 下拉项
   */
  function memberOption(user: Directory['users'][number]): { label: string; value: string } {
    return { label: user.name, value: user.id }
  }
  /**
   * 每次打开时建立本次附件分组、预填执行记录，并按需加载执行人员。
   * @param open 是否打开
   */
  async function initialize(open: boolean): Promise<void> {
    if (!open) return
    attachmentContextId.value = createUuid()
    attachmentVersion.value = props.detail.activity.version
    resetValidation()
    updateAttachmentState(props.detail.activity.version, props.detail.files)
    comment.value = ''
    publicComment.value = ''
    decision.value = 'approve'
    executor.value = null
    url.value = props.detail.activity.archive?.url || ''
    disposal.value = ''
    checks.value = [false, false, false]
    const start = props.detail.activity.actualStart || new Date().toISOString()
    const latest = props.detail.activity.executionRecords?.at(-1)
    report.value = {
      title: '',
      start: props.action === 'report' ? latest?.end || start : start,
      end: new Date().toISOString(),
      people: props.action === 'execution-complete' ? (latest?.people ?? Number(props.detail.activity.payload.people || 0)) : 0,
      summary: props.action === 'execution-complete' ? latest?.summary || '' : '',
      spend: '',
      exception: '',
    }
    if (props.action === 'assign')
      try {
        directory.value = await directoryApi()
      } catch (error) {
        feedback.failure(error)
      }
  }
  watch(() => props.show, initialize)
  /** 上传或权限修改后同步活动版本及可用于归档的成果附件。
   * @param version 最新活动版本
   * @param files 当前有权查看的文件列表
   */
  function updateAttachmentState(version: number, files: FileRecord[]): void {
    attachmentVersion.value = version
    hasArchiveFile.value = files.some(
      (file) =>
        file.stage === 'archive' &&
        (!file.contextId ||
          file.contextId === attachmentContextId.value ||
          props.detail.activity.audit.some((event) => event.attachmentContextId === file.contextId))
    )
  }
  /**
   * 等待附件上传完成后提交任务或执行记录，使用上传刷新后的版本，由服务端核验实时权限。
   */
  async function submit(): Promise<void> {
    if (busy.value || uploading.value || !(await validateBeforeSubmit())) return
    if (reportAction.value) {
      const issues = executionReportErrors(report.value, props.action === 'execution-complete')
      if (issues.length) {
        feedback.failure(new Error(issues.join('；')))
        return
      }
    }
    if (props.action === 'archive-submit' && url.value && !isHttps(url.value)) {
      feedback.failure(new Error('成果链接必须使用HTTPS'))
      return
    }
    busy.value = true
    try {
      if (props.task) {
        if (nodeKind.value !== 'approval' && decision.value !== 'approve') throw new Error('任务节点只能完成')
        await decisionApi(props.task.id, props.task.version, decision.value, comment.value, publicComment.value, attachmentContextId.value)
      } else {
        await actionApi(props.detail.activity.id, {
          action: props.action as Parameters<typeof actionApi>[1]['action'],
          expectedVersion: attachmentVersion.value,
          attachmentContextId: attachmentContextId.value,
          comment: comment.value,
          ...(props.action === 'assign' ? { executor: executor.value || '' } : {}),
          ...(reportAction.value ? { report: report.value } : {}),
          ...(props.action === 'archive-submit' ? { url: url.value } : {}),
          ...(props.action === 'archive-approve' ? { checks: checks.value } : {}),
          ...(props.action === 'cancel-request' ? { disposal: disposal.value } : {}),
        })
      }
      feedback.success(props.action === 'report' ? '执行记录已保存，可继续追加；执行结束后请手动完成执行' : '操作已完成')
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
    :width="mobile ? '100%' : 600"
    :mask-closable="!busy && !uploading"
    :close-on-esc="!busy && !uploading"
    @update:show="emit('update:show', $event)"
  >
    <NDrawerContent :title="title" :closable="!busy && !uploading">
      <NAlert type="info" :bordered="false" class="mb">{{ detail.activity.name || '未命名活动' }} · {{ detail.activity.code }}</NAlert>
      <NForm ref="formRef" :model="formModel" :rules="formRules" :disabled="busy || uploading" label-placement="top">
        <NFormItem v-if="task && nodeKind === 'approval'" label="审批结论">
          <NRadioGroup v-model:value="decision">
            <NRadioButton value="approve">通过</NRadioButton>
            <NRadioButton value="return">退回补充</NRadioButton>
            <NRadioButton value="reject">拒绝</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NAlert v-if="action === 'assign' && detail.activity.workflowOwnerId" type="info" :bordered="false" class="mb">
          本活动由最后审批人指派执行人，并由该审批人审核归档。为避免自审，执行人需另选他人。
        </NAlert>
        <NFormItem v-if="action === 'assign'" label="执行负责人" path="executor" required>
          <NSelect v-model:value="executor" :options="executors" filterable placeholder="选择有效执行人" />
        </NFormItem>
        <ExecutionReportForm v-if="reportAction" v-model="report" :completion="action === 'execution-complete'" />
        <NFormItem v-if="action === 'archive-submit'" label="成果链接" path="url" :required="!hasArchiveFile">
          <NInput v-model:value="url" placeholder="https://，已上传成果附件时可不填" />
        </NFormItem>
        <NFormItem v-if="action === 'cancel-request' && detail.activity.status === 'executing'" label="已发生费用处置方式" path="disposal" required>
          <NInput v-model:value="disposal" type="textarea" :maxlength="1000" />
        </NFormItem>
        <NFormItem v-if="action === 'archive-approve'" label="归档检查项" path="checks" required>
          <div class="stack">
            <NCheckbox v-model:checked="checks[0]">活动信息与执行情况一致</NCheckbox>
            <NCheckbox v-model:checked="checks[1]">成果资料完整且可访问</NCheckbox>
            <NCheckbox v-model:checked="checks[2]">费用与异常情况已说明</NCheckbox>
          </div>
        </NFormItem>
        <NFormItem v-if="task" label="公开结论 / 补充要求（活动内共享）" path="publicComment" :required="decision !== 'approve'">
          <NInput
            v-model:value="publicComment"
            type="textarea"
            :maxlength="500"
            :autosize="{ minRows: 3 }"
            placeholder="请填写可向活动相关人员公开的结论；退回时说明申请人需要补充什么"
          />
        </NFormItem>
        <NAlert v-if="task" type="info" :bordered="false" class="mb">
          内部说明是给节点授权人员的办理备注，同部门或活动发起人不会自动看到。需要申请人查看的意见请填“公开结论”；附件默认继承节点，需共享时单独设置文件权限。
        </NAlert>
        <NFormItem
          v-if="!reportAction"
          path="comment"
          :label="task ? '节点内部说明（按节点授权可见）' : action === 'archive-submit' ? '成果摘要' : action === 'assign' ? '执行安排' : '意见 / 原因'"
          :required="commentRequired"
        >
          <NInput
            v-model:value="comment"
            type="textarea"
            :maxlength="task ? 500 : 1000"
            show-count
            :autosize="{ minRows: 4 }"
            :placeholder="task ? '仅向节点授权人员开放，可填写详细判断依据' : '请填写活动内共享的具体意见或说明'"
          />
        </NFormItem>
        <BusinessFormAttachments
          v-if="show"
          :detail="detail"
          :context-id="attachmentContextId"
          :action-key="task ? 'decision' : action"
          :stage="attachmentStage"
          :node-id="task?.nodeId"
          :disabled="busy || uploading"
          @busy="uploading = $event"
          @refreshed="updateAttachmentState"
        />
      </NForm>
      <template #footer>
        <div class="gap">
          <NButton :disabled="busy || uploading" @click="emit('update:show', false)">取消</NButton>
          <NButton type="primary" :loading="busy" :disabled="uploading" @click="submit">确认{{ title }}</NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>
