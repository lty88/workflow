<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NButton, NEmpty, NTag } from 'naive-ui'
  import type { ActivityDetailSectionProps } from './types'
  import { formatTime, formatMoney } from '@/composables/format'
  import BusinessAttachmentReceipt from './BusinessAttachmentReceipt.vue'
  const emit = defineEmits<{ uploaded: [] }>()
  const props = defineProps<ActivityDetailSectionProps>()
  const count = ref(10)
  const records = computed(() => [...(props.detail.activity.executionRecords || [])].reverse())
  const visibleRecords = computed(() => records.value.slice(0, count.value))
  /** 展开下一批执行记录，减少较长执行周期活动的初次渲染量。 */
  function showMore(): void {
    count.value += 10
  }
</script>
<template>
  <section class="execution-records">
    <div class="records-heading">
      <h2>
        执行记录
        <NTag :bordered="false" type="info">{{ records.length }} 条</NTag>
      </h2>
      <span>按提交时间倒序</span>
    </div>
    <NEmpty
      v-if="!records.length"
      :description="detail.activity.report ? '该活动使用历史单次汇报，请查看完成汇总' : '暂无执行记录，执行人可以按日报或阶段进展持续提交'"
      size="small"
    />
    <article v-for="record in visibleRecords" :key="record.id" class="execution-record">
      <header>
        <strong>{{ record.title || '执行进展记录' }}</strong>
        <time>{{ formatTime(record.submittedAt) }}</time>
      </header>
      <div class="record-author">提交人：{{ record.authorName }} · 本次实到 {{ record.people }} 人</div>
      <div class="record-period">{{ formatTime(record.start) }} — {{ formatTime(record.end) }}</div>
      <p>{{ record.summary }}</p>
      <div v-if="record.spend" class="record-spend">本次支出：{{ formatMoney(record.spend) }}</div>
      <div v-if="record.exception" class="record-exception">
        <strong>异常说明</strong>
        <p>{{ record.exception }}</p>
      </div>
      <BusinessAttachmentReceipt :detail="detail" :context-id="record.id" @uploaded="emit('uploaded')" />
    </article>
    <NButton v-if="records.length > count" block @click="showMore">查看更多记录（剩余 {{ records.length - count }} 条）</NButton>
  </section>
</template>
<style scoped>
  .execution-records {
    margin-top: 28px;
  }
  .records-heading,
  .execution-record header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .records-heading {
    margin-bottom: 18px;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 17px;
    margin: 0;
  }
  .records-heading > span,
  time {
    color: #7e8ba0;
    font-size: 12px;
  }
  .execution-record {
    padding: 20px;
    border: 1px solid #e2e9f4;
    border-left: 3px solid #4c7de5;
    border-radius: 10px;
    margin-bottom: 16px;
    background: #fff;
  }
  .execution-record header strong {
    color: #2a426c;
    font-size: 15px;
    overflow-wrap: anywhere;
  }
  .record-author {
    color: #647591;
    margin-top: 10px;
    font-size: 13px;
  }
  .record-period {
    color: #8490a4;
    font-size: 12px;
    margin: 7px 0 14px;
  }
  p {
    color: #445875;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.9;
    font-size: 14px;
    margin: 0;
  }
  .record-spend {
    color: #5b6f8e;
    font-size: 13px;
    margin-top: 12px;
  }
  .record-exception {
    margin-top: 15px;
    padding: 12px 14px;
    background: #fff7e9;
    border-radius: 8px;
    color: #9b6e24;
  }
  .record-exception strong {
    font-size: 13px;
  }
  .record-exception p {
    color: #8b703f;
    margin-top: 6px;
  }
</style>
