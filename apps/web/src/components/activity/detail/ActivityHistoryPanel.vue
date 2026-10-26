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
    <NCard v-if="section !== 'progress'" title="办理记录">
      <template #header-extra>
        <span class="muted">{{ detail.activity.audit.length }} 条</span>
      </template>
      <div class="history">
        <div v-for="item in [...detail.activity.audit].reverse()" :key="item.id" class="history-item">
          <strong>{{ ACTION_LABELS[item.action] || item.action }} · {{ item.actorName }}</strong>
          <p v-if="item.note">{{ item.note }}</p>
          <time>{{ formatTime(item.createdAt) }}</time>
          <BusinessAttachmentReceipt v-if="item.attachmentContextId" :detail="detail" :context-id="item.attachmentContextId" @uploaded="emit('uploaded')" />
        </div>
        <NEmpty v-if="!detail.activity.audit.length" description="暂无记录" size="small" />
      </div>
    </NCard>
  </div>
</template>

<style scoped>
  :deep(.history-item),
  :deep(.history-item p) {
    font-size: 14px;
    line-height: 1.8;
  }
  :deep(.history-item time),
  :deep(.node-meta),
  :deep(.task-line),
  :deep(.muted) {
    font-size: 12px;
  }
</style>
