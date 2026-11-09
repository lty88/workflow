<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NButton } from 'naive-ui'
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
  <section class="execution-card execution-records">
    <header class="card-heading">
      <h2>
        <span class="card-marker" />
        执行记录
        <span class="record-count">{{ records.length }}</span>
      </h2>
      <span class="card-caption">最新记录在前</span>
    </header>
    <p v-if="!records.length" class="records-empty">
      {{ detail.activity.report ? '该活动使用单次汇报，请查看执行完成汇总。' : '暂无执行记录，执行人可按日报或阶段进展持续提交。' }}
    </p>
    <article v-for="record in visibleRecords" :key="record.id" class="execution-record">
      <div class="record-heading">
        <span class="record-avatar" aria-hidden="true">{{ record.authorName.slice(0, 1) }}</span>
        <div class="record-title">
          <strong>{{ record.title || '执行进展记录' }}</strong>
          <span>{{ record.authorName }}</span>
        </div>
        <time>{{ formatTime(record.submittedAt) }}</time>
      </div>
      <div class="record-content">
        <div class="record-period">{{ formatTime(record.start) }} — {{ formatTime(record.end) }}</div>
        <p class="body-copy">{{ record.summary }}</p>
        <div class="record-metrics">
          <span>
            本次实到
            <b>{{ record.people }}</b>
            人
          </span>
          <span v-if="record.spend">
            本次支出
            <b>{{ formatMoney(record.spend) }}</b>
          </span>
        </div>
        <div v-if="record.exception" class="record-exception">
          <strong>异常说明</strong>
          <p class="body-copy">{{ record.exception }}</p>
        </div>
        <BusinessAttachmentReceipt :detail="detail" :context-id="record.id" @uploaded="emit('uploaded')" />
      </div>
    </article>
    <NButton v-if="records.length > count" block secondary class="more-records" @click="showMore">查看更多记录（剩余 {{ records.length - count }} 条）</NButton>
  </section>
</template>
<style scoped src="./execution-sections.css" />
<style scoped>
  .record-count {
    padding: 0 6px;
    color: #7c8da8;
    font-size: 12px;
    font-weight: 400;
    line-height: 20px;
    border-radius: 5px;
    background: #f0f4fa;
  }
  .execution-record + .execution-record {
    border-top: 1px solid #edf1f6;
    margin-top: 18px;
    padding-top: 18px;
  }
  .record-heading {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .record-avatar {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 10px;
    background: #eef3fc;
    color: #6b86b6;
    font-size: 12px;
  }
  .record-title {
    flex: 1;
    min-width: 0;
  }
  .record-title strong {
    display: block;
    color: #435775;
    font-size: 14px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .record-title > span {
    display: block;
    margin-top: 2px;
    color: #8a96a9;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  time {
    color: #98a4b5;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .record-content {
    margin: 12px 0 0 42px;
    padding: 14px 16px;
    border-radius: 9px;
    background: #f8fafd;
    border: 1px solid #f0f3f8;
  }
  .record-period {
    color: #8a99ae;
    font-size: 11px;
    margin-bottom: 10px;
    font-variant-numeric: tabular-nums;
  }
  .record-metrics {
    display: flex;
    gap: 8px 24px;
    flex-wrap: wrap;
    margin-top: 12px;
    color: #8090a7;
    font-size: 12px;
  }
  .record-metrics b {
    color: #5a708f;
    font-weight: 500;
  }
  .record-exception {
    margin-top: 14px;
    padding: 10px 12px;
    background: #fff8eb;
    border-radius: 6px;
  }
  .record-exception strong {
    color: #a18143;
    font-size: 12px;
  }
  .record-exception .body-copy {
    font-size: 13px;
    margin-top: 5px;
    color: #987d50;
  }
  .records-empty {
    margin: 0;
    padding: 14px;
    border-radius: 8px;
    background: #f7f9fc;
    color: #8a97aa;
    font-size: 13px;
    line-height: 1.8;
  }
  .more-records {
    margin-top: 18px;
  }
  @media (max-width: 600px) {
    .record-heading {
      flex-wrap: wrap;
    }
    time {
      width: 100%;
      padding-left: 42px;
    }
    .record-content {
      margin-left: 0;
      padding: 12px;
    }
  }
</style>
