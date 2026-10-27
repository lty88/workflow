<script setup lang="tsx">
  import { computed, ref, watch } from 'vue'
  import { NModal, NForm, NFormItem, NInput, NSelect, NAlert, NButton } from 'naive-ui'
  import { topological } from '@workflow/domain'
  import { useFormValidation } from '@/composables/use-form-validation'
  import { requiredRule } from '@/composables/form-validation'
  import type { ApprovalReturnDialogProps, NegativeDecisionInput } from './types'
  const props = defineProps<ApprovalReturnDialogProps>()
  const emit = defineEmits<{ 'update:show': [value: boolean]; confirm: [value: NegativeDecisionInput] }>()
  const { formRef, validate, resetValidation } = useFormValidation()
  const targetId = ref<string | null>(null)
  const reason = ref('')
  const model = computed(() => ({ targetId: targetId.value, reason: reason.value }))
  const rules = computed(() => ({
    reason: requiredRule(props.decision === 'return' ? '退回修改要求' : '终止原因'),
    ...(props.decision === 'return' ? { targetId: requiredRule('退回目标', true) } : {}),
  }))
  const options = computed(() => [
    ...(props.capabilities?.returnTargets || []).map(
      /** 将服务端授权目标转换为选择项。
       * @param target 已完成的上游节点
       * @returns 带重办轮次的选项
       */ function option(target) {
        return { label: `${target.label} · 第${target.generation}轮`, value: target.nodeId }
      }
    ),
    ...(props.capabilities?.canReturnToApplicant ? [{ label: '发起人 · 修改申请内容并重新提交', value: 'applicant' }] : []),
  ])
  const target = computed(() =>
    props.capabilities?.returnTargets.find(
      /** 查找选定目标的服务端影响范围。
       * @param item 可选目标
       * @returns 是否当前选择
       */ function same(item) {
        return item.nodeId === targetId.value
      }
    )
  )
  const impact = computed(() =>
    topological(props.detail.activity.nodes)
      .order.filter(
        /** 筛选需要重新办理的节点。
         * @param node 活动节点
         * @returns 是否受退回影响
         */ function affected(node) {
          return target.value?.affectedNodeIds.includes(node.id)
        }
      )
      .map(
        /** 提取受影响节点名称。
         * @param node 待重办节点
         * @returns 节点名称
         */ function name(node) {
          return node.label
        }
      )
      .join('、')
  )
  const pendingCount = computed(
    () =>
      props.detail.activity.tasks.filter(
        /** 统计终止后将取消的待办。
         * @param task 个人任务
         * @returns 是否未完成
         */ function pending(task) {
          return task.status === 'pending'
        }
      ).length
  )
  /** 每次打开预填意见；只有一个合格目标时自动选中，多个目标需明确选择。
   * @param open 是否打开确认窗口
   */
  function initialize(open: boolean): void {
    if (!open) return
    reason.value = props.opinion
    targetId.value = options.value.length === 1 ? options.value[0]!.value : null
    resetValidation()
  }
  watch(() => props.show, initialize)
  /** 前端先校验原因及目标，再把明确的决定交给父组件请求接口。 */
  async function confirm(): Promise<void> {
    if (props.busy || !(await validate())) return
    emit('confirm', {
      decision: props.decision,
      publicComment: reason.value.trim(),
      ...(props.decision === 'return' ? { returnTargetId: targetId.value!, expectedTargetGeneration: target.value?.generation } : {}),
    })
  }
</script>
<template>
  <NModal
    :show="show"
    preset="card"
    :title="decision === 'return' ? '退回修改' : '终止整个申请'"
    :closable="!busy"
    :mask-closable="!busy"
    :close-on-esc="!busy"
    style="width: min(560px, 94vw)"
    :z-index="2300"
    @update:show="emit('update:show', $event)"
  >
    <p>
      <strong>{{ detail.activity.name }}</strong>
      · {{ detail.activity.code }}
    </p>
    <NForm ref="formRef" :model="model" :rules="rules" :disabled="busy" label-placement="top">
      <NFormItem v-if="decision === 'return'" label="退回目标" path="targetId" required>
        <NSelect v-model:value="targetId" :options="options" filterable placeholder="请选择退回目标" />
      </NFormItem>
      <NAlert :type="decision === 'return' ? 'warning' : 'error'" :bordered="false" style="margin-bottom: 18px">
        <template v-if="decision === 'reject'">
          将终止整个申请并取消剩余{{ pendingCount }}个待办。后续审批、执行指派和归档流转停止；再次申请需复制后重新提交。
        </template>
        <template v-else-if="targetId === 'applicant'">将退给发起人修改申请，取消本轮剩余待办；重新提交后生成新的申请版本，全部生效节点重新办理。</template>
        <template v-else>需要重新办理：{{ impact || '请选择目标' }}。独立并行分支保留结果，历史意见保留。</template>
      </NAlert>
      <NFormItem :label="decision === 'return' ? '退回修改要求' : '终止原因'" path="reason" required>
        <NInput v-model:value="reason" type="textarea" :autosize="{ minRows: 4 }" placeholder="请说明原因及需要处理的内容，活动相关人员可见" />
      </NFormItem>
    </NForm>
    <template #footer>
      <div class="dialog-actions">
        <NButton :disabled="busy" @click="emit('update:show', false)">取消</NButton>
        <NButton :type="decision === 'return' ? 'warning' : 'error'" :loading="busy" @click="confirm">
          {{ decision === 'return' ? '确认退回修改' : '确认终止申请' }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>
<style scoped>
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
</style>
