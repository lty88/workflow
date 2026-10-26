<script setup lang="tsx">
  import { computed, ref, watch } from 'vue'
  import { NButton, NSelect, NTag } from 'naive-ui'
  import type { WorkflowTask } from '@workflow/domain'
  import type { ActivityActionBarProps } from './types'
  import { ACTION_LABELS } from '@/components/activity/types'
  import ActivityDeleteButton from '@/components/activity/ActivityDeleteButton.vue'
  import { canDecideWorkflowTask, canTransferWorkflowTask } from '@/components/activity/workflow-task-access'
  import { useAuthStore } from '@/stores/auth'
  import { participantName } from './presentation'
  import { detailActionAppearance } from './action-presentation'
  const props = defineProps<ActivityActionBarProps>()
  const emit = defineEmits<{ action: [code: string]; decide: [task: WorkflowTask]; transfer: [task: WorkflowTask]; deleted: []; refresh: []; current: [] }>()
  const auth = useAuthStore()
  const selectedTaskId = ref<string | null>(null)
  const transferTaskId = ref<string | null>(null)
  const personalTasks = computed(() => props.detail.activity.tasks.filter((task) => canDecideWorkflowTask(props.detail, task, auth.profile)))
  const transferableTasks = computed(() => props.detail.activity.tasks.filter((task) => canTransferWorkflowTask(props.detail, task)))
  const taskOptions = computed(() => personalTasks.value.map(taskOption))
  const transferOptions = computed(() => transferableTasks.value.map(taskOption))
  const selectedTask = computed(() => personalTasks.value.find((task) => task.id === selectedTaskId.value))
  const selectedTransfer = computed(() => transferableTasks.value.find((task) => task.id === transferTaskId.value))
  const taskKind = computed(() => props.detail.activity.nodes.find((node) => node.id === selectedTask.value?.nodeId)?.kind)
  const hasActions = computed(
    () => props.actions.length || props.detail.actions.includes('delete') || personalTasks.value.length || transferableTasks.value.length
  )

  /**
   * 将待办转换为含节点与受理人的选择项，避免并行任务混淆。
   * @param task 当前可办理或可转交的任务
   * @returns 待办选择项
   */
  function taskOption(task: WorkflowTask): { label: string; value: string } {
    const node = props.detail.activity.nodes.find((item) => item.id === task.nodeId)
    return { label: `${node?.label || '流程节点'} · ${participantName(props.detail, task.assignee)}`, value: task.id }
  }

  /** 待办更新后保留仍然有效的选择，失效时切换到首个可办理任务。 */
  function syncSelection(): void {
    if (!personalTasks.value.some((task) => task.id === selectedTaskId.value)) selectedTaskId.value = personalTasks.value[0]?.id || null
    if (!transferableTasks.value.some((task) => task.id === transferTaskId.value)) transferTaskId.value = transferableTasks.value[0]?.id || null
  }

  /** 再次核验当前视图和任务资格后打开个人办理抽屉。 */
  function decide(): void {
    if (!props.loading && !props.historical && selectedTask.value) emit('decide', selectedTask.value)
  }

  /** 再次核验当前视图和转交资格后打开待办转交抽屉。 */
  function transfer(): void {
    if (!props.loading && !props.historical && selectedTransfer.value) emit('transfer', selectedTransfer.value)
  }
  watch([personalTasks, transferableTasks], syncSelection, { immediate: true })
</script>
<template>
  <footer class="activity-action-bar" aria-label="活动办理操作">
    <div class="action-context">
      <strong>{{ historical ? '正在查看历史申请' : personalTasks.length ? `你有 ${personalTasks.length} 项待办` : '活动操作' }}</strong>
      <span>{{ historical ? '返回当前申请后可继续办理' : hasActions ? '按当前身份与活动状态展示可用操作' : '当前暂无待办，可查看活动资料与办理记录' }}</span>
    </div>
    <NButton v-if="historical" type="primary" @click="emit('current')">返回当前申请</NButton>
    <template v-else>
      <div class="action-groups">
        <div v-if="transferableTasks.length" class="action-group transfer-group">
          <NSelect v-model:value="transferTaskId" :options="transferOptions" :disabled="loading" filterable aria-label="选择待转交的节点" />
          <NButton :disabled="loading || !selectedTransfer" @click="transfer">转交待办</NButton>
        </div>
        <div class="action-group business-actions">
          <NButton
            v-for="item in actions"
            :key="item"
            :disabled="loading"
            :type="detailActionAppearance(item).type"
            :secondary="detailActionAppearance(item).secondary"
            @click="emit('action', item)"
          >
            {{ item === 'adjust' ? '调整审批流程' : ACTION_LABELS[item] || item }}
          </NButton>
          <ActivityDeleteButton
            :activity="detail.activity"
            :allowed="detail.actions.includes('delete')"
            :disabled="loading"
            prominent
            @deleted="emit('deleted')"
            @refresh="emit('refresh')"
          />
        </div>
        <div v-if="personalTasks.length" class="action-group personal-actions">
          <NSelect v-if="personalTasks.length > 1" v-model:value="selectedTaskId" :options="taskOptions" :disabled="loading" aria-label="选择我的待办节点" />
          <NTag v-else :bordered="false" type="info" class="task-node-label">
            {{ detail.activity.nodes.find((node) => node.id === selectedTask?.nodeId)?.label }}
          </NTag>
          <NButton :type="taskKind === 'approval' ? 'primary' : 'success'" :disabled="loading || !selectedTask" @click="decide">
            {{ taskKind === 'approval' ? '办理审批' : '完成节点任务' }}
          </NButton>
        </div>
      </div>
    </template>
  </footer>
</template>
<style scoped>
  .activity-action-bar {
    position: sticky;
    bottom: 12px;
    z-index: 8;
    margin-top: 22px;
    padding: 16px 20px;
    background: #fff;
    border: 1px solid #dce5f4;
    border-radius: 12px;
    box-shadow: 0 -4px 24px #23345212;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .action-context {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .action-context strong {
    color: #273d62;
    font-size: 14px;
  }
  .action-context span {
    color: #77859b;
    font-size: 12px;
  }
  .action-groups {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 12px 16px;
    flex: 1;
  }
  .action-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .personal-actions {
    border-left: 1px solid #e5eaf2;
    padding-left: 16px;
  }
  .action-group :deep(.n-base-selection) {
    min-height: 34px;
  }
  .action-group :deep(.n-select) {
    width: 225px;
    max-width: 100%;
  }
  .task-node-label {
    max-width: 230px;
    height: auto;
    white-space: normal;
    padding-block: 5px;
  }
  @media (max-width: 850px) {
    .activity-action-bar {
      bottom: 0;
      padding: 14px;
      gap: 12px;
    }
    .action-context,
    .action-groups {
      width: 100%;
    }
    .action-groups {
      justify-content: flex-start;
    }
    .personal-actions {
      padding-left: 0;
      border-left: 0;
    }
  }
</style>
