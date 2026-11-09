<script setup lang="tsx">
  import { computed } from 'vue'
  import { NAlert, NTag } from 'naive-ui'
  import type { ActivityExecutionProps } from './types'
  import AttachmentList from '@/components/activity/AttachmentList.vue'
  import ActivityLifecycleStrip from './ActivityLifecycleStrip.vue'
  import ActivityOutcomePanel from './ActivityOutcomePanel.vue'
  import ExecutionRecordsPanel from './ExecutionRecordsPanel.vue'
  import { participantName } from './presentation'
  const props = defineProps<ActivityExecutionProps>()
  const emit = defineEmits<{ uploaded: [] }>()
  const executionFiles = computed(() => props.detail.files.some((file) => file.stage === 'execution' && !file.fieldKey && !file.contextId))
  /** 根据服务端授权参与人目录展示执行与归档责任人。
   * @param id 人员标识
   * @returns 已授权姓名或占位符
   */
  function nameFor(id: string): string {
    return participantName(props.detail, id)
  }
</script>
<template>
  <div class="execution-workspace">
    <ActivityLifecycleStrip :detail="detail" />
    <dl class="responsibility-strip">
      <div>
        <dt>执行负责人</dt>
        <dd>
          <span class="role-marker executor" />
          {{ nameFor(detail.activity.executor) }}
        </dd>
      </div>
      <div>
        <dt>指派负责人</dt>
        <dd>
          <span class="role-marker" />
          {{ nameFor(detail.activity.workflowOwnerId || '') }}
        </dd>
      </div>
      <div>
        <dt>归档审核人</dt>
        <dd>
          <span class="role-marker reviewer" />
          {{ nameFor(detail.activity.archive?.reviewer || detail.activity.workflowOwnerId || '') }}
        </dd>
      </div>
    </dl>
    <NAlert v-if="detail.activity.status === 'executing'" type="info" :bordered="false" class="phase-hint">
      可持续新增执行记录。全部结束后，在底部操作栏确认完成并提交归档。
    </NAlert>
    <NAlert v-if="detail.activity.status === 'archive_draft'" type="info" :bordered="false" class="phase-hint">
      执行已完成，请由执行负责人补齐成果材料并提交归档审核。
    </NAlert>
    <section class="execution-card assignment-card">
      <header class="card-heading">
        <h2>
          <span class="card-marker" />
          执行安排
        </h2>
        <NTag v-if="detail.activity.executionCompletedAt" size="small" :bordered="false" type="success">已完成执行</NTag>
      </header>
      <p class="body-copy">{{ detail.activity.assignment || '待指派执行人后补充执行安排' }}</p>
      <div v-if="executionUpload || executionFiles" class="section-attachments">
        <span class="field-label">补充附件</span>
        <AttachmentList
          :activity-id="detail.activity.id"
          :files="detail.files"
          :activity-version="detail.activity.version"
          stage="execution"
          compact-empty
          :can-upload="executionUpload && !readOnly"
          @uploaded="emit('uploaded')"
        />
      </div>
    </section>
    <ExecutionRecordsPanel :detail="detail" @uploaded="emit('uploaded')" />
    <ActivityOutcomePanel :detail="detail" :archive-upload="archiveUpload && !readOnly" @uploaded="emit('uploaded')" />
  </div>
</template>
<style scoped src="./execution-sections.css" />
<style scoped>
  .execution-workspace {
    display: grid;
    gap: 18px;
  }
  .execution-workspace > :first-child {
    margin-bottom: 0;
  }
  .responsibility-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
    margin: 0;
    padding: 2px 2px 6px;
  }
  .responsibility-strip > div {
    min-width: 0;
  }
  dt {
    color: #8b96a7;
    font-size: 12px;
    margin-bottom: 8px;
  }
  dd {
    display: flex;
    align-items: baseline;
    gap: 7px;
    margin: 0;
    color: #4e607c;
    font-size: 13px;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }
  .role-marker {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 2px;
    background: #a2afc5;
    flex: none;
  }
  .role-marker.executor {
    background: #6b8ce0;
  }
  .role-marker.reviewer {
    background: #5fa994;
  }
  .phase-hint {
    font-size: 13px;
  }
  .assignment-card .body-copy {
    margin: 0;
  }
  @media (max-width: 600px) {
    .responsibility-strip {
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }
    .responsibility-strip > div {
      display: grid;
      grid-template-columns: 90px minmax(0, 1fr);
      gap: 8px;
    }
    dt {
      margin: 0;
      line-height: 1.7;
    }
  }
</style>
