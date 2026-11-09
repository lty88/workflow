<script setup lang="tsx">
  import { NCard, NEmpty } from 'naive-ui'
  import type { WorkflowTask } from '@workflow/domain'
  import type { ActivityHistoryProps } from './types'
  import { ACTION_LABELS } from '@/components/activity/types'
  import { formatTime } from '@/composables/format'
  import BusinessAttachmentReceipt from './BusinessAttachmentReceipt.vue'
  import WorkflowTimeline from '@/components/activity/WorkflowTimeline.vue'

  defineProps<ActivityHistoryProps>()
  const emit = defineEmits<{ uploaded: []; decide: [task: WorkflowTask]; transfer: [task: WorkflowTask] }>()
</script>
<template>
  <div class="stack">
    <NCard v-if="section !== 'records'" title="办理进度">
      <template #header-extra>
        <span class="muted">申请 V{{ detail.activity.revision }}</span>
      </template>
      <WorkflowTimeline :detail="detail" :read-only="readOnly" @decide="emit('decide', $event)" @transfer="emit('transfer', $event)" />
    </NCard>
    <section v-if="section !== 'progress'" class="records-panel">
      <header class="records-header">
        <h2>
          办理记录
          <span>{{ detail.activity.audit.length }}</span>
        </h2>
        <small>按发生时间倒序</small>
      </header>
      <div class="history">
        <div v-for="item in [...detail.activity.audit].reverse()" :key="item.id" class="history-item">
          <div class="history-heading">
            <strong>{{ ACTION_LABELS[item.action] || item.action }}</strong>
            <time>{{ formatTime(item.createdAt) }}</time>
          </div>
          <span class="history-actor">{{ item.actorName }}</span>
          <p v-if="item.publicNote">{{ item.publicNote }}</p>
          <p v-if="item.note">{{ item.note }}</p>
          <BusinessAttachmentReceipt v-if="item.attachmentContextId" :detail="detail" :context-id="item.attachmentContextId" @uploaded="emit('uploaded')" />
        </div>
        <NEmpty v-if="!detail.activity.audit.length" description="暂无记录" size="small" />
      </div>
    </section>
  </div>
</template>

<style scoped>
  .records-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 24px;
  }
  .records-header h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 16px;
    color: #2e405b;
  }
  .records-header h2 span {
    border-radius: 5px;
    padding: 2px 6px;
    background: #f0f4fb;
    color: #8798b4;
    font-size: 12px;
    font-weight: 400;
  }
  .records-header small {
    font-size: 12px;
    color: #96a2b3;
  }
  .history-item {
    position: relative;
    margin: 0 0 0 5px;
    padding: 0 0 24px 22px;
    border-left: 1px solid #e5ebf4;
    border-bottom: 0;
  }
  .history-item::before {
    content: '';
    position: absolute;
    left: -4px;
    top: 7px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #b7c8e4;
    box-shadow: 0 0 0 4px #fff;
  }
  .history-item:first-child::before {
    background: #5d84d5;
  }
  .history-item:last-child {
    border-left-color: transparent;
    padding-bottom: 0;
  }
  .history-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .history-heading strong {
    color: #425571;
    font-size: 14px;
    font-weight: 500;
  }
  .history-heading time {
    color: #98a5b8;
    font-size: 11px;
  }
  .history-actor {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: #8291a8;
  }
  .history-item p {
    margin: 10px 0 0;
    padding: 10px 12px;
    background: #f8fafd;
    border-radius: 7px;
    font-size: 13px;
    color: #687b97;
    line-height: 1.8;
  }
  :deep(.node-meta),
  :deep(.task-line),
  :deep(.muted) {
    font-size: 12px;
  }
</style>
