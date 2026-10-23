<script setup lang="tsx">
import { NCard, NEmpty } from 'naive-ui';
import type { WorkflowTask } from '@workflow/domain';
import type { ActivityDetailSectionProps } from './types';
import { ACTION_LABELS } from '@/components/activity/types';
import { formatTime } from '@/composables/format';
import WorkflowTimeline from '@/components/activity/WorkflowTimeline.vue';

const props = defineProps<ActivityDetailSectionProps>();
const emit = defineEmits<{ decide: [task: WorkflowTask]; transfer: [task: WorkflowTask] }>();
</script>
<template>
  <div class="stack">
    <NCard title="办理进度"
      ><template #header-extra
        ><span class="muted">申请 V{{ detail.activity.revision }}</span></template
      ><WorkflowTimeline
        :detail="detail"
        @decide="emit('decide', $event)"
        @transfer="emit('transfer', $event)"
    /></NCard>
    <NCard title="办理记录"
      ><template #header-extra
        ><span class="muted">{{ detail.activity.audit.length }} 条</span></template
      >
      <div class="history">
        <div v-for="item in [...detail.activity.audit].reverse()" :key="item.id" class="history-item">
          <strong>{{ ACTION_LABELS[item.action] || item.action }} · {{ item.actorName }}</strong>
          <p v-if="item.note">{{ item.note }}</p>
          <time>{{ formatTime(item.createdAt) }}</time>
        </div>
        <NEmpty v-if="!detail.activity.audit.length" description="暂无记录" size="small" /></div
    ></NCard>
  </div>
</template>
