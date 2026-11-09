<script setup lang="tsx">
  import { computed } from 'vue'
  import { NTag } from 'naive-ui'
  import { formatTime } from '@/composables/format'
  import type { WorkflowNode } from '@workflow/domain'
  import type { CollaborationProgressProps } from './types'
  import { collaborationNodes, collaborationProgressState } from './presentation'
  const props = defineProps<CollaborationProgressProps>()
  const nodes = computed(() => collaborationNodes(props.detail, props.parentNodeId, props.includeHistory))
  const pending = computed(() => nodes.value.filter((node) => !['accepted', 'cancelled'].includes(node.collaboration!.state)).length)
  /** 将任务或验收人的标识转换成详情中的姓名。
   * @param id 成员标识
   * @returns 姓名或账号标识
   */
  function person(id?: string): string {
    return props.detail.participants.find((item) => item.id === id)?.name || id || '—'
  }
  /** 验收人随所属个人审批待办的实际持有人显示。
   * @param node 协作节点
   * @returns 当前验收人名称
   */
  function reviewer(node: WorkflowNode): string {
    return person(props.detail.activity.tasks.find((task) => task.id === node.collaboration?.parentTaskId)?.assignee)
  }
  /** 说明顺序办理的前置交付任务。
   * @param node 协作节点
   * @returns 前置任务名称
   */
  function previous(node: WorkflowNode): string {
    return props.detail.activity.nodes
      .filter((item) => node.deps.includes(item.id))
      .map((item) => item.label)
      .join('、')
  }
</script>
<template>
  <details v-if="nodes.length" class="collaboration-progress" :open="pending > 0" aria-label="本节点协作任务进度">
    <summary class="collaboration-heading"><strong>协作任务 <span>{{ nodes.length }}</span></strong><span>{{ pending ? '待完成 ' + pending : '已全部结束' }} <i aria-hidden="true">⌄</i></span></summary>
    <article v-for="node in nodes" :key="node.id" class="collaboration-step">
      <div class="collaboration-title">
        <strong>{{ node.label }}</strong>
        <NTag size="small" :bordered="false" :type="collaborationProgressState(node).tone">{{ collaborationProgressState(node).label }}</NTag>
      </div>
      <p>办理人 {{ person(node.assignees[0]) }} · 第 {{ node.generation }} 轮</p>
      <p v-if="node.deps.length">前置 {{ previous(node) }}</p>
      <p v-if="node.collaboration!.submissions.length" class="collaboration-result">{{ node.collaboration!.submissions.at(-1)!.summary }}</p>
      <p>
        成果验收 · {{ reviewer(node) }}
        <span>
          {{ node.collaboration!.state === 'accepted' ? '已通过' : node.collaboration!.state === 'submitted' ? '待验收' : node.collaboration!.state === 'cancelled' ? '已关闭' : '等待提交' }}
        </span>
      </p>
      <small v-if="node.collaboration!.submissions.at(-1)?.review">{{ formatTime(node.collaboration!.submissions.at(-1)!.review!.at) }}</small>
    </article>
  </details>
</template>
<style scoped>
  .collaboration-progress {
    margin-top: 12px;
    padding: 10px 12px;
    background: #f8fafd;
    border: 1px solid #e8edf5;
    border-radius: 8px;
  }
  .collaboration-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; list-style: none; cursor: pointer; font-size: 11px; color: #8495af; }
  .collaboration-heading::-webkit-details-marker { display: none; }
  .collaboration-heading strong { font-size: 12px; font-weight: 500; color: #6480aa; }
  .collaboration-heading strong span { margin-left: 5px; }
  .collaboration-heading i { display: inline-block; margin-left: 3px; font-style: normal; }
  details[open] .collaboration-heading i { transform: rotate(180deg); }
  .collaboration-step {
    margin-top: 10px;
    padding-left: 10px;
    border-left: 2px solid #c9d9f6;
  }
  .collaboration-title {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    align-items: flex-start;
    font-size: 12px;
  }
  p {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: #71819a;
    overflow-wrap: anywhere;
  }
  .collaboration-result {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: #405777;
  }
  small {
    color: #8b98ad;
    font-size: 11px;
  }
</style>
