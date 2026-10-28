<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { useMediaQuery } from '@vueuse/core'
  import { NButton, NTag, NEmpty, NAlert, NCheckbox, NModal, NPopover } from 'naive-ui'
  import { topological } from '@workflow/domain'
  import type { WorkflowNode, WorkflowTask } from '@workflow/domain'
  import { NODE_STATUSES, TASK_STATUSES } from './types'
  import { nodeProgressStatus } from './workflow-progress'
  import { canDecideWorkflowTask, canTransferWorkflowTask } from './workflow-task-access'
  import type { NodeProgressStatus, WorkflowProgressNode, WorkflowViewDetail } from './types'
  import { useAuthStore } from '@/stores/auth'
  import { formatTime } from '@/composables/format'
  import BusinessGraph from '@/components/graph/BusinessGraph.vue'
  import { runtimeGraph } from '@/components/graph/models'
  const props = defineProps<{ detail: WorkflowViewDetail; readOnly?: boolean }>()
  const emit = defineEmits<{ decide: [task: WorkflowTask]; transfer: [task: WorkflowTask] }>()
  const auth = useAuthStore()
  /** 超过该人数时折叠办理人明细，避免大规模会签撑高时间线。 */
  const CROWDED_TASK_THRESHOLD = 6
  const mobile = useMediaQuery('(max-width: 850px)')
  const showHistory = ref(false)
  const graphOpen = ref(false)
  const model = computed(() => runtimeGraph(props.detail, showHistory.value))
  const nodes = computed(() => topological(props.detail.activity.nodes.filter(inCurrentRevision)).order.map(withProgress))
  /** 给节点附加本轮真实审批结果，历史驳回不染红当前新轮次。
   * @param node 实例节点
   * @returns 带展示状态的节点副本
   */
  function withProgress(node: WorkflowNode): WorkflowProgressNode {
    return { ...node, displayStatus: nodeProgressStatus(node, props.detail.activity.tasks, props.detail.activity.status) }
  }
  /**
   * 按历史开关选择本次申请的节点，防止旧轮次和当前审批混杂。
   * @param node 实例节点
   * @returns 是否展示
   */
  function inCurrentRevision(node: WorkflowNode): boolean {
    return !node.businessStage && (showHistory.value || (node.applicationRevision || 1) === (props.detail.activity.revision || 1))
  }
  /**
   * 查找参与人显示名。
   * @param id 人员标识
   * @returns 名称
   */
  function nameFor(id: string): string {
    return (
      props.detail.participants.find(
        /**
         * 按当前目标标识查找配置项或参与人。
         * @param person 当前集合项
         * @returns 是否符合筛选条件
         */ function match(person) {
          return person.id === id
        }
      )?.name || id
    )
  }
  /**
   * 获取节点保留的所有个人意见。
   * @param id 节点标识
   * @returns 节点任务
   */
  function tasksFor(id: string): WorkflowTask[] {
    return props.detail.activity.tasks.filter(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param task 当前集合项
       * @returns 是否符合筛选条件
       */ function match(task) {
        return task.nodeId === id
      }
    )
  }
  /**
   * 获取节点当前轮次的个人任务，排除历史轮次对会签进度的干扰。
   * @param node 当前流程节点
   * @returns 当前轮次个人任务
   */
  function currentTasksFor(node: WorkflowNode): WorkflowTask[] {
    return tasksFor(node.id).filter(
      /**
       * 只保留与节点当前轮次一致的个人任务。
       * @param task 当前个人任务
       * @returns 是否属于当前轮次
       */
      function current(task) {
        return task.generation === node.generation
      }
    )
  }
  /**
   * 统计节点当前轮次指定状态的个人任务数量。
   * @param node 当前流程节点
   * @param statuses 需要纳入统计的任务状态
   * @returns 符合状态条件的任务数量
   */
  function taskCount(node: WorkflowNode, statuses: WorkflowTask['status'][]): number {
    let count = 0
    for (const task of currentTasksFor(node)) if (statuses.includes(task.status)) count++
    return count
  }
  /**
   * 统计当前轮次已经产生明确办理动作的人数，取消任务不计入已操作。
   * @param node 当前流程节点
   * @returns 已通过、已完成、已退回或已终止的人数
   */
  function handledTaskCount(node: WorkflowNode): number {
    return taskCount(node, ['approved', 'completed', 'returned', 'rejected'])
  }
  /**
   * 判断当前节点是否需要折叠多人办理明细。
   * @param node 当前流程节点
   * @returns 当前轮次任务数是否超过普通展示阈值
   */
  function isCrowdedNode(node: WorkflowNode): boolean {
    return currentTasksFor(node).length > CROWDED_TASK_THRESHOLD
  }
  /** 判断评分仍属于当前有效办理结果，源任务或被评节点重办后旧分数仅保留历史。
   * @param task 评分任务
   * @param nodeId 被评节点
   * @param generation 被评轮次
   * @returns 是否为有效评分
   */
  function ratingEffective(task: WorkflowTask, nodeId: string, generation: number): boolean {
    const source = props.detail.activity.nodes.find(
      /** 定位评分来源节点。
       * @param node 当前节点
       * @returns 是否匹配
       */ function match(node) {
        return node.id === task.nodeId
      }
    )
    const target = props.detail.activity.nodes.find(
      /** 定位被评节点。
       * @param node 当前节点
       * @returns 是否匹配
       */ function match(node) {
        return node.id === nodeId
      }
    )
    return (
      source?.generation === task.generation &&
      source.status === 'completed' &&
      task.status === 'approved' &&
      target?.generation === generation &&
      target.status === 'completed' &&
      (source.applicationRevision || 1) === (props.detail.activity.revision || 1)
    )
  }
  /**
   * 判定个人当前任务是否可办理，提交时服务端再次授权。
   * @param task 个人任务
   * @returns 是否可办理
   */
  function canDecide(task: WorkflowTask): boolean {
    return !props.readOnly && canDecideWorkflowTask(props.detail, task, auth.profile)
  }
  /**
   * 获取节点名称。
   * @param id 节点标识
   * @returns 名称
   */
  function nodeName(id: string): string {
    return (
      props.detail.activity.nodes.find(
        /**
         * 匹配节点标识。
         * @param node 节点
         * @returns 是否匹配
         */ function match(node) {
          return node.id === id
        }
      )?.label || id
    )
  }
  /**
   * 判断待办是否允许流程负责人转交。
   * @param task 个人待办
   * @returns 是否可转交
   */
  function canTransfer(task: WorkflowTask): boolean {
    return !props.readOnly && canTransferWorkflowTask(props.detail, task)
  }
  /**
   * 查询当前任务的受理异常说明。
   * @param id 任务标识
   * @returns 异常信息
   */
  function taskWarning(id: string): string {
    return (
      props.detail.taskWarnings?.find(
        /**
         * 匹配当前个人任务的异常。
         * @param item 异常记录
         * @returns 是否匹配
         */ function warning(item) {
          return item.taskId === id
        }
      )?.message || ''
    )
  }
  /**
   * 按节点状态返回标签色调，与步骤条圆点保持一致。
   * @param status 节点状态
   * @returns 标签类型
   */
  function tagType(status: NodeProgressStatus): 'info' | 'success' | 'default' | 'error' | 'warning' {
    if (status === 'rejected') return 'error'
    if (status === 'returned' || status === 'reworking') return 'warning'
    if (status === 'active') return 'info'
    if (status === 'completed') return 'success'
    return 'default'
  }
  /**
   * 按个人任务状态返回弹层标签色调。
   * @param status 个人任务状态
   * @returns Naive UI 标签类型
   */
  function taskTagType(status: WorkflowTask['status']): 'info' | 'success' | 'default' | 'error' | 'warning' {
    if (status === 'approved' || status === 'completed') return 'success'
    if (status === 'returned') return 'warning'
    if (status === 'rejected') return 'error'
    if (status === 'pending') return 'info'
    return 'default'
  }
</script>
<template>
  <div>
    <NEmpty v-if="!nodes.length" description="提交申请后生成流程" size="small" />
    <template v-else>
      <div class="spread mb">
        <NCheckbox v-model:checked="showHistory">显示历史申请节点</NCheckbox>
        <NButton size="small" secondary type="primary" @click="graphOpen = true">完整流程图</NButton>
      </div>
      <div class="flow-timeline">
        <div v-for="node in nodes" :key="node.id" class="flow-step" :class="node.displayStatus">
          <div class="flow-rail">
            <i class="flow-dot" />
            <span class="flow-line" />
          </div>
          <div class="flow-body">
            <div class="spread">
              <strong>{{ node.label }}</strong>
              <NTag size="small" :type="tagType(node.displayStatus)" :bordered="false">{{ NODE_STATUSES[node.displayStatus] }}</NTag>
            </div>
            <div class="node-meta">
              {{ { approval: '审批 · 全员通过', task: '任务 · 全员完成', notice: '知会 · 不阻断流转' }[node.kind] }}
              · V{{ node.applicationRevision || detail.activity.revision || 1 }} · 第{{ node.generation }}轮
            </div>
            <div v-if="node.assignees.length" class="assignee-line help-text">
              <template v-if="!isCrowdedNode(node)">
                受理人：
                <span v-for="(person, index) in node.assignees" :key="person">{{ index ? '、' : '' }}{{ nameFor(person) }}</span>
              </template>
              <template v-else>
                <span>受理人：共 {{ currentTasksFor(node).length }} 人</span>
                <span class="assignee-summary">已处理 {{ handledTaskCount(node) }} · 待办理 {{ taskCount(node, ['pending']) }}</span>
                <NPopover trigger="click" placement="bottom-start" :show-arrow="false">
                  <template #trigger>
                    <NButton text type="primary" size="small">查看办理情况</NButton>
                  </template>
                  <div class="assignee-popover">
                    <div class="assignee-popover-header">
                      <div>
                        <strong>{{ node.label }}</strong>
                        <p>本轮共 {{ currentTasksFor(node).length }} 人，已处理 {{ handledTaskCount(node) }} 人</p>
                      </div>
                      <div class="task-status-counts" aria-label="人员办理状态统计">
                        <NTag v-if="taskCount(node, ['approved', 'completed'])" size="small" type="success" :bordered="false">
                          已通过 {{ taskCount(node, ['approved', 'completed']) }}
                        </NTag>
                        <NTag v-if="taskCount(node, ['returned'])" size="small" type="warning" :bordered="false">
                          已退回 {{ taskCount(node, ['returned']) }}
                        </NTag>
                        <NTag v-if="taskCount(node, ['rejected'])" size="small" type="error" :bordered="false">已终止 {{ taskCount(node, ['rejected']) }}</NTag>
                        <NTag v-if="taskCount(node, ['pending'])" size="small" type="info" :bordered="false">待办理 {{ taskCount(node, ['pending']) }}</NTag>
                        <NTag v-if="taskCount(node, ['cancelled'])" size="small" :bordered="false">已取消 {{ taskCount(node, ['cancelled']) }}</NTag>
                      </div>
                    </div>
                    <div class="popover-task-list">
                      <div
                        v-for="task in tasksFor(node.id)"
                        :key="task.id"
                        class="popover-task-item"
                        :class="{ 'is-history': task.generation !== node.generation }"
                      >
                        <div class="popover-task-main">
                          <span class="popover-person">{{ nameFor(task.assignee) }}</span>
                          <NTag size="small" :type="taskTagType(task.status)" :bordered="false">{{ TASK_STATUSES[task.status] }}</NTag>
                          <span v-if="task.generation !== node.generation" class="task-history-label">历史第{{ task.generation }}轮</span>
                          <span class="task-actions">
                            <NButton v-if="canTransfer(task)" size="tiny" @click="emit('transfer', task)">转交</NButton>
                            <NButton v-if="canDecide(task)" type="primary" size="tiny" @click="emit('decide', task)">办理</NButton>
                          </span>
                        </div>
                        <NAlert v-if="taskWarning(task.id)" type="warning" :bordered="false" style="margin: 8px 0">
                          {{ taskWarning(task.id) }}
                        </NAlert>
                        <div v-if="task.publicComment" class="task-comment">审批意见：{{ task.publicComment }}</div>
                        <div v-if="task.returnTargetId" class="task-comment returned-target">
                          退回至：{{ task.returnTargetId === 'applicant' ? '发起人修改申请' : nodeName(task.returnTargetId) }}
                        </div>
                        <div v-for="rating in task.ratings || []" :key="rating.nodeId" class="task-comment">
                          {{ nodeName(rating.nodeId) }}：{{ rating.score }}分
                          <span v-if="!ratingEffective(task, rating.nodeId, rating.generation)">（历史评分）</span>
                        </div>
                        <small v-if="task.actedAt" class="muted">{{ formatTime(task.actedAt) }}</small>
                      </div>
                    </div>
                  </div>
                </NPopover>
              </template>
            </div>
            <div v-if="node.deps.length" class="help-text">
              前置：
              <template v-for="(dep, index) in node.deps" :key="dep">{{ index ? '、' : '' }}{{ nodeName(dep) }}</template>
            </div>
            <div v-if="!isCrowdedNode(node) && tasksFor(node.id).length" class="task-list">
              <div v-for="task in tasksFor(node.id)" :key="task.id" class="task-line" :class="{ 'is-history': task.generation !== node.generation }">
                <div class="spread">
                  <span>
                    {{ nameFor(task.assignee) }} ·
                    <strong class="task-status-text" :class="task.status">{{ TASK_STATUSES[task.status] }}</strong>
                    <span v-if="task.generation !== node.generation">（历史第{{ task.generation }}轮）</span>
                  </span>
                  <span class="task-actions">
                    <NButton v-if="canTransfer(task)" size="tiny" @click="emit('transfer', task)">转交</NButton>
                    <NButton v-if="canDecide(task)" type="primary" size="tiny" @click="emit('decide', task)">办理</NButton>
                  </span>
                </div>
                <NAlert v-if="taskWarning(task.id)" type="warning" :bordered="false" style="margin: 10px 0">{{ taskWarning(task.id) }}</NAlert>
                <div v-if="task.publicComment" class="task-comment">审批意见：{{ task.publicComment }}</div>
                <div v-if="task.returnTargetId" class="task-comment returned-target">
                  退回至：{{ task.returnTargetId === 'applicant' ? '发起人修改申请' : nodeName(task.returnTargetId) }}
                </div>
                <div v-for="rating in task.ratings || []" :key="rating.nodeId" class="task-comment">
                  {{ nodeName(rating.nodeId) }}：{{ rating.score }}分 · 被评第{{ rating.generation }}轮
                  <span v-if="!ratingEffective(task, rating.nodeId, rating.generation)">（历史评分）</span>
                </div>
                <small v-if="task.actedAt" class="muted">{{ formatTime(task.actedAt) }}</small>
              </div>
            </div>
          </div>
        </div>
      </div>
      <NModal v-model:show="graphOpen" preset="card" title="完整流程图" style="width: min(980px, 96vw)" :z-index="1100">
        <p class="help-text mb">展示本次申请的实际节点、状态与后续业务阶段，可拖动、缩放或全屏查看。</p>
        <BusinessGraph :model="model" :height="mobile ? 420 : 620" label="实际审批节点、状态和后续业务阶段" />
      </NModal>
    </template>
  </div>
</template>

<style scoped>
  .flow-step.returned .flow-dot,
  .flow-step.reworking .flow-dot {
    background: #d79a24;
    box-shadow: 0 0 0 4px #d79a2418;
  }
  .flow-step.returned .flow-body > .spread strong,
  .flow-step.reworking .flow-body > .spread strong,
  .returned-target {
    color: #9a620c;
  }
  .flow-step.returned .flow-body {
    border-radius: 6px;
    background: #fff9ed;
  }
  .flow-step.rejected .flow-dot {
    background: #dc4c5b;
    box-shadow: 0 0 0 4px #dc4c5b18;
  }
  .flow-step.rejected .flow-body > .spread strong {
    color: #c93547;
  }
  .flow-step.rejected .flow-body {
    border-radius: 6px;
    background: #fff3f5;
  }
  .assignee-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px 10px;
    margin: 6px 0 4px;
  }
  .assignee-summary {
    color: #66758b;
  }
  .task-list .task-line.is-history {
    opacity: 0.68;
  }
  .task-status-text {
    font-weight: 600;
  }
  .task-status-text.pending {
    color: #2d64c8;
  }
  .task-status-text.approved,
  .task-status-text.completed {
    color: #18815d;
  }
  .task-status-text.returned {
    color: #a76b10;
  }
  .task-status-text.rejected {
    color: #c73a50;
  }
  .task-status-text.cancelled {
    color: #7d8797;
  }
  .task-actions {
    display: inline-flex;
    gap: 6px;
    margin-left: auto;
  }
  .task-history-label {
    color: #7b8698;
    font-size: 11px;
  }
  .assignee-popover {
    width: min(440px, calc(100vw - 40px));
  }
  .assignee-popover-header {
    padding: 2px 2px 12px;
    border-bottom: 1px solid #e8ecf2;
  }
  .assignee-popover-header strong {
    color: #26354d;
    font-size: 14px;
  }
  .assignee-popover-header p {
    margin: 3px 0 9px;
    color: #7c8799;
    font-size: 12px;
  }
  .task-status-counts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .popover-task-list {
    max-height: 360px;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .popover-task-item {
    padding: 10px 2px;
    border-bottom: 1px solid #edf0f5;
  }
  .popover-task-item:last-child {
    border-bottom: 0;
  }
  .popover-task-item.is-history {
    opacity: 0.64;
  }
  .popover-task-main {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .popover-person {
    min-width: 0;
    color: #2e3b50;
    font-size: 13px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .popover-task-item .task-comment {
    margin-top: 5px;
  }
  .popover-task-item .muted {
    display: block;
    margin-top: 3px;
  }
</style>
