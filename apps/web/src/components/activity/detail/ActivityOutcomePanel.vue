<script setup lang="tsx">
  import { computed } from 'vue'
  import { NTag } from 'naive-ui'
  import type { ActivityOutcomeProps } from './types'
  import AttachmentList from '@/components/activity/AttachmentList.vue'
  import BusinessAttachmentReceipt from './BusinessAttachmentReceipt.vue'
  import { formatTime, formatMoney } from '@/composables/format'
  import { participantName } from './presentation'
  const props = defineProps<ActivityOutcomeProps>()
  const emit = defineEmits<{ uploaded: [] }>()
  const archivePhase = computed(() => ['archive_draft', 'archive_review', 'archived'].includes(props.detail.activity.status))
  const completionEvent = computed(() => [...props.detail.activity.audit].reverse().find((event) => event.action === '完成执行并提交归档'))
  /** 读取当前用户获准查看的档案责任人姓名。
   * @param id 人员标识
   * @returns 姓名或占位符
   */
  function nameFor(id: string): string {
    return participantName(props.detail, id)
  }
</script>
<template>
  <div v-if="detail.activity.report || archivePhase || detail.activity.archive" class="outcome-grid">
    <section v-if="detail.activity.report" class="execution-card completion-card">
      <header class="card-heading">
        <h2>
          <span class="card-marker" />
          执行完成汇总
        </h2>
        <NTag size="small" type="success" :bordered="false">执行成果</NTag>
      </header>
      <dl class="summary-grid">
        <div>
          <dt>实际开始</dt>
          <dd>{{ formatTime(detail.activity.report.start) }}</dd>
        </div>
        <div>
          <dt>实际结束</dt>
          <dd>{{ formatTime(detail.activity.report.end) }}</dd>
        </div>
        <div>
          <dt>实到人数</dt>
          <dd>{{ detail.activity.report.people }} 人</dd>
        </div>
        <div>
          <dt>实际支出参考</dt>
          <dd>{{ detail.activity.report.spend ? formatMoney(detail.activity.report.spend) : '未提供或权限受限' }}</dd>
        </div>
      </dl>
      <span class="field-label">执行情况与成果</span>
      <p class="body-copy">{{ detail.activity.report.summary }}</p>
      <div v-if="detail.activity.report.exception" class="exception-note">
        <span class="field-label">异常说明</span>
        <p class="body-copy">{{ detail.activity.report.exception }}</p>
      </div>
      <BusinessAttachmentReceipt
        v-if="completionEvent?.attachmentContextId"
        :detail="detail"
        :context-id="completionEvent.attachmentContextId"
        @uploaded="emit('uploaded')"
      />
    </section>
    <section v-if="archivePhase || detail.activity.archive" class="execution-card archive-card">
      <header class="card-heading">
        <h2>
          <span class="card-marker" />
          成果档案
        </h2>
        <NTag v-if="detail.activity.archive" size="small" :type="detail.activity.status === 'archived' ? 'success' : 'info'" :bordered="false">
          {{ detail.activity.status === 'archived' ? '审核通过' : '已提交' }}
        </NTag>
        <span v-else class="card-caption">待提交</span>
      </header>
      <template v-if="detail.activity.archive">
        <div class="archive-identifier">
          <span>档案编号</span>
          <strong>{{ detail.activity.archive.code || '审核后生成' }}</strong>
          <small>提交 V{{ detail.activity.archive.version }}</small>
        </div>
        <dl class="summary-grid">
          <div>
            <dt>归档提交人</dt>
            <dd>{{ nameFor(detail.activity.archive.submittedBy) }}</dd>
          </div>
          <div>
            <dt>归档审核人</dt>
            <dd>{{ nameFor(detail.activity.archive.reviewer) }}</dd>
          </div>
        </dl>
        <span class="field-label">成果说明</span>
        <p class="body-copy">{{ detail.activity.archive.summary }}</p>
        <a v-if="detail.activity.archive.url" :href="detail.activity.archive.url" target="_blank" rel="noopener noreferrer" class="result-link">
          查看成果链接
          <span aria-hidden="true">↗</span>
        </a>
        <div v-if="detail.activity.archive.comment" class="archive-comment">
          <span class="field-label">审核意见</span>
          <p class="body-copy">{{ detail.activity.archive.comment }}</p>
        </div>
      </template>
      <p v-else class="body-copy archive-empty">由执行负责人整理成果材料，提交后由归档审核人审核。</p>
      <div class="section-attachments">
        <span class="field-label">成果附件</span>
        <AttachmentList
          :activity-id="detail.activity.id"
          :files="detail.files"
          :activity-version="detail.activity.version"
          stage="archive"
          include-contexts
          compact-empty
          :can-upload="archiveUpload"
          @uploaded="emit('uploaded')"
        />
      </div>
      <details v-if="detail.activity.archives.length" class="archive-history">
        <summary>
          历次档案提交
          <span>{{ detail.activity.archives.length }}</span>
        </summary>
        <article v-for="attempt in [...detail.activity.archives].reverse()" :key="attempt.version">
          <strong>档案 V{{ attempt.version }} · {{ attempt.code || '历史提交' }}</strong>
          <p class="body-copy">{{ attempt.summary }}</p>
          <p v-if="attempt.comment" class="body-copy">审核意见 {{ attempt.comment }}</p>
        </article>
      </details>
    </section>
  </div>
</template>
<style scoped src="./execution-sections.css" />
<style scoped>
  .outcome-grid > :only-child {
    grid-column: 1 / -1;
  }
  .outcome-grid {
    display: grid;
    gap: 18px;
    align-items: start;
  }
  .archive-card .card-marker {
    background: #5da78d;
  }
  .exception-note {
    margin-top: 16px;
    padding: 12px 14px;
    background: #fff9ef;
    border-radius: 8px;
  }
  .exception-note .field-label {
    color: #a88447;
  }
  .exception-note .body-copy {
    color: #907143;
  }
  .archive-identifier {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 12px 14px;
    margin-bottom: 18px;
    background: #f4f8f6;
    border: 1px solid #e8f0ec;
    border-radius: 8px;
  }
  .archive-identifier > span {
    color: #81968d;
    font-size: 11px;
  }
  .archive-identifier strong {
    color: #477762;
    font-size: 13px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .archive-identifier small {
    margin-left: auto;
    color: #92a398;
    font-size: 11px;
  }
  .result-link {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
    padding: 7px 11px;
    color: #4f79c8;
    background: #f1f5fd;
    border-radius: 6px;
    font-size: 12px;
  }
  .result-link:hover {
    background: #e8effb;
  }
  .archive-comment {
    margin-top: 16px;
  }
  .archive-history {
    margin-top: 18px;
    border-top: 1px solid #edf1f6;
    padding-top: 14px;
  }
  .archive-history summary {
    color: #71829b;
    font-size: 12px;
    cursor: pointer;
  }
  .archive-history summary span {
    margin-left: 6px;
    color: #9aa7b8;
  }
  .archive-history article {
    margin-top: 14px;
    padding: 12px;
    border-radius: 8px;
    background: #f7f9fc;
  }
  .archive-history strong {
    font-size: 12px;
    color: #61738d;
  }
  .archive-history .body-copy {
    font-size: 13px;
    margin-top: 6px;
  }
  @media (min-width: 1500px) {
    .outcome-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
