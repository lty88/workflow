<script setup lang="tsx">
  import { computed } from 'vue'
  import { NFormItem, NInput, NInputNumber, NButton } from 'naive-ui'
  import type { ApprovalDecisionFieldsProps } from './types'
  import AttachmentList from './AttachmentList.vue'
  const props = defineProps<ApprovalDecisionFieldsProps>()
  const emit = defineEmits<{ 'update:opinion': [value: string]; 'update:scores': [value: Record<string, number | null>] }>()
  const upstream = computed(() => {
    const node = props.detail.activity.nodes.find(
      /** 定位正在办理的审批。
       * @param item 流程节点
       * @returns 是否为当前任务所属节点
       */ function current(item) {
        return item.id === props.task.nodeId
      }
    )
    return props.detail.activity.nodes.filter(
      /** 展示已经完成的直接前置业务结果。
       * @param item 上游候选
       * @returns 是否需要查看
       */ function previous(item) {
        return node?.deps.includes(item.id) && item.status === 'completed' && item.kind !== 'notice'
      }
    )
  })
  /** 提取上游当前有效轮次已完成的共享意见，不展示历史私密说明。
   * @param id 上游节点
   * @param generation 当前有效轮次
   * @returns 公开办理意见
   */
  function opinions(id: string, generation: number): string[] {
    const result: string[] = []
    for (const task of props.detail.activity.tasks)
      if (task.nodeId === id && task.generation === generation && ['approved', 'completed'].includes(task.status) && task.publicComment)
        result.push(task.publicComment)
    return result
  }
  /** 检查经过服务端过滤的列表是否包含指定上游的附件。
   * @param id 上游节点标识
   * @returns 是否存在可查看附件
   */
  function hasFiles(id: string): boolean {
    for (const file of props.detail.files) if (file.nodeId === id) return true
    return false
  }
  /** 写入单个评分，保留其他上游对象已填写的分数。
   * @param id 被评节点
   * @param score 0至100整数或未填写
   */
  function score(id: string, score: number | null): void {
    emit('update:scores', { ...props.scores, [id]: score })
  }
</script>
<template>
  <section v-if="upstream.length" class="review-results">
    <h3>上游办理结果</h3>
    <article v-for="node in upstream" :key="node.id">
      <strong>{{ node.label }} · 第{{ node.generation }}轮</strong>
      <p v-for="(text, index) in opinions(node.id, node.generation)" :key="index">{{ text }}</p>
      <AttachmentList
        v-if="hasFiles(node.id)"
        :activity-id="detail.activity.id"
        :activity-version="detail.activity.version"
        :files="detail.files"
        stage="node"
        :node-id="node.id"
        include-contexts
        :can-upload="false"
      />
    </article>
  </section>
  <section v-if="capabilities?.ratingTargets.length" class="review-scores">
    <h3>上游办理质量评分</h3>
    <p class="help-text">0～100整数，评价本轮节点成果；分数不自动改变审批结论。</p>
    <NFormItem v-for="target in capabilities.ratingTargets" :key="target.nodeId" :label="target.label" :path="`scores.${target.nodeId}`" :required="required">
      <div class="score-controls">
        <NInputNumber
          :value="scores[target.nodeId] ?? null"
          :min="0"
          :max="100"
          :precision="0"
          clearable
          placeholder="填写分数"
          @update:value="score(target.nodeId, $event)"
        />
        <span>分</span>
        <NButton
          v-for="value in [60, 80, 90, 100]"
          :key="value"
          size="small"
          :type="scores[target.nodeId] === value ? 'primary' : 'default'"
          secondary
          @click="score(target.nodeId, value)"
        >
          {{ value }}
        </NButton>
      </div>
    </NFormItem>
  </section>
  <NFormItem label="审批意见（活动相关人员可见）" path="publicComment">
    <NInput
      :value="opinion"
      type="textarea"
      :autosize="{ minRows: 4 }"
      placeholder="通过时选填；退回或终止时请说明具体原因"
      @update:value="emit('update:opinion', $event)"
    />
  </NFormItem>
</template>
<style scoped>
  h3 {
    font-size: 15px;
    margin: 0 0 12px;
  }
  .review-results,
  .review-scores {
    margin-bottom: 24px;
  }
  .review-results article {
    padding: 14px;
    border: 1px solid #e1e8f2;
    border-radius: 10px;
    margin-top: 10px;
    background: #f8faff;
  }
  .review-results p {
    white-space: pre-wrap;
    line-height: 1.7;
    margin: 8px 0;
  }
  .score-controls {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .score-controls :deep(.n-input-number) {
    width: 135px;
  }
</style>
