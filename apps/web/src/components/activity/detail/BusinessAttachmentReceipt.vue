<script setup lang="tsx">
  import { computed } from 'vue'
  import AttachmentList from '@/components/activity/AttachmentList.vue'
  import type { ActivityDetail } from '@workflow/domain'
  const emit = defineEmits<{ uploaded: [] }>()
  const props = defineProps<{ detail: ActivityDetail; contextId: string }>()
  const files = computed(() => props.detail.files.filter((file) => file.contextId === props.contextId))
  const firstFile = computed(() => files.value[0])
</script>
<template>
  <div v-if="firstFile" class="attachment-receipt">
    <p>本次记录附件 · {{ files.length }} 个</p>
    <AttachmentList
      :activity-id="detail.activity.id"
      :activity-version="detail.activity.version"
      :files="files"
      :stage="firstFile.stage"
      :node-id="firstFile.nodeId"
      :context-id="contextId"
      :can-upload="false"
      @uploaded="emit('uploaded')"
    />
  </div>
</template>
<style scoped>
  .attachment-receipt {
    background: #f7f9fd;
    padding: 14px;
    border-radius: 9px;
    margin-top: 16px;
  }
  p {
    font-size: 13px;
    color: #62718c;
    margin: 0 0 10px;
  }
</style>
