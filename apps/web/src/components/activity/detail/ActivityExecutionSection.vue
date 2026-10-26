<script setup lang="tsx">
  import { computed } from 'vue'
  import { NAlert, NButton, NEmpty, NTag } from 'naive-ui'
  import type { ActivityExecutionProps } from './types'
  import { formatTime, formatMoney } from '@/composables/format'
  import AttachmentList from '@/components/activity/AttachmentList.vue'
  import ExecutionRecordsPanel from './ExecutionRecordsPanel.vue'
  import BusinessAttachmentReceipt from './BusinessAttachmentReceipt.vue'
  import { participantName } from './presentation'
  const props = defineProps<ActivityExecutionProps>()
  const emit = defineEmits<{ uploaded: []; action: [code: string] }>()
  const archivePhase = computed(() => ['archive_draft', 'archive_review', 'archived'].includes(props.detail.activity.status))
  const latest = computed(() => props.detail.activity.executionRecords?.at(-1))
  const completionEvent = computed(() => [...props.detail.activity.audit].reverse().find((event) => event.action === '完成执行并提交归档'))
  /** 查询当前身份是否可打开执行或归档办理表单，历史申请视图只读。
   * @param action 服务端授予的业务动作
   * @returns 是否展示按钮
   */
  function canAct(action: string): boolean {
    return !props.readOnly && props.detail.actions.includes(action)
  }
  /** 根据服务端授权参与人目录展示执行或归档人员姓名。
   * @param id 人员标识
   * @returns 已授权姓名
   */
  function nameFor(id: string): string {
    return participantName(props.detail, id)
  }
</script>
<template>
  <div class="execution-workspace">
    <div class="execution-phase">
      <div :class="{ active: !archivePhase }">
        <span>01</span>
        <strong>持续执行与记录</strong>
        <small>日报、阶段进展及附件</small>
      </div>
      <i>→</i>
      <div :class="{ active: archivePhase }">
        <span>02</span>
        <strong>完成汇总与归档</strong>
        <small>手动确认完成后进入</small>
      </div>
    </div>
    <div class="execution-summary">
      <div>
        <span>执行负责人</span>
        <strong>{{ nameFor(detail.activity.executor) }}</strong>
      </div>
      <div v-if="detail.activity.workflowOwnerId">
        <span>执行指派负责人</span>
        <strong>{{ nameFor(detail.activity.workflowOwnerId) }}</strong>
      </div>
      <div>
        <span>归档审核负责人</span>
        <strong>
          {{
            detail.activity.archive
              ? nameFor(detail.activity.archive.reviewer)
              : detail.activity.workflowOwnerId
                ? nameFor(detail.activity.workflowOwnerId)
                : '按归档岗位办理'
          }}
        </strong>
      </div>
      <div>
        <span>执行记录</span>
        <strong>{{ detail.activity.executionRecords?.length || 0 }} 条</strong>
      </div>
      <div>
        <span>最近记录</span>
        <strong>{{ latest ? formatTime(latest.submittedAt) : '暂无记录' }}</strong>
      </div>
    </div>
    <NAlert v-if="detail.activity.status === 'executing'" type="info" :bordered="false" class="mb">
      可多次新增执行记录，提交记录后活动继续执行。全部执行结束，再点击“完成执行并提交归档”。
    </NAlert>
    <NAlert v-if="detail.activity.status === 'archive_draft'" type="success" :bordered="false" class="mb">
      执行已完成，由执行负责人补齐成果材料并提交归档，{{ detail.activity.workflowOwnerId ? '最后审批人' : '归档审核岗位' }}负责审核。
    </NAlert>
    <div class="execution-quick-actions">
      <NButton v-if="canAct('start')" type="primary" @click="emit('action', 'start')">开始执行</NButton>
      <NButton v-if="canAct('report')" type="primary" @click="emit('action', 'report')">＋ 新增执行记录</NButton>
      <NButton v-if="canAct('execution-complete')" type="success" @click="emit('action', 'execution-complete')">完成执行并提交归档</NButton>
      <NButton v-if="canAct('archive-submit')" type="primary" @click="emit('action', 'archive-submit')">提交归档审核</NButton>
    </div>
    <section class="detail-section assignment-section">
      <h2>
        执行安排
        <NTag v-if="detail.activity.executionCompletedAt" :bordered="false" type="success">已完成执行</NTag>
      </h2>
      <p>{{ detail.activity.assignment || '尚未填写执行安排' }}</p>
      <p class="sub-label">执行阶段补充附件</p>
      <AttachmentList
        :activity-id="detail.activity.id"
        :files="detail.files"
        :activity-version="detail.activity.version"
        stage="execution"
        :can-upload="executionUpload"
        @uploaded="emit('uploaded')"
      />
    </section>
    <ExecutionRecordsPanel :detail="detail" @uploaded="emit('uploaded')" />
    <div v-if="detail.activity.report" class="detail-section">
      <h2>执行完成汇总</h2>
      <dl class="info-grid">
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
          <dd>
            {{ detail.activity.report.spend ? formatMoney(detail.activity.report.spend) : '未提供或权限受限' }}
          </dd>
        </div>
      </dl>
      <p style="margin-top: 15px">{{ detail.activity.report.summary }}</p>
      <template v-if="detail.activity.report.exception">
        <p class="sub-label">异常说明</p>
        <p>{{ detail.activity.report.exception }}</p>
      </template>
    </div>
    <BusinessAttachmentReceipt
      v-if="completionEvent?.attachmentContextId"
      :detail="detail"
      :context-id="completionEvent.attachmentContextId"
      @uploaded="emit('uploaded')"
    />
    <section v-if="archivePhase && !detail.activity.archive" class="detail-section">
      <h2>成果归档材料</h2>
      <NEmpty description="尚未提交归档审核，请补充成果附件或在归档表单填写成果链接" size="small" class="mb" />
      <AttachmentList
        :activity-id="detail.activity.id"
        :files="detail.files"
        :activity-version="detail.activity.version"
        stage="archive"
        include-contexts
        :can-upload="archiveUpload"
        @uploaded="emit('uploaded')"
      />
    </section>
    <div v-if="detail.activity.archive" class="detail-section">
      <h2>
        活动档案
        <small>提交 V{{ detail.activity.archive.version }}{{ detail.activity.archive.code ? ' · ' + detail.activity.archive.code : '' }}</small>
      </h2>
      <p>{{ detail.activity.archive.summary }}</p>
      <p v-if="detail.activity.archive.url" style="margin-top: 10px">
        <a :href="detail.activity.archive.url" target="_blank" rel="noopener noreferrer">查看成果链接 ↗</a>
      </p>
      <dl class="info-grid">
        <div>
          <dt>提交人</dt>
          <dd>{{ nameFor(detail.activity.archive.submittedBy) }}</dd>
        </div>
        <div>
          <dt>审核人</dt>
          <dd>{{ nameFor(detail.activity.archive.reviewer) }}</dd>
        </div>
        <div>
          <dt>档案编号</dt>
          <dd>{{ detail.activity.archive.code || '待审核' }}</dd>
        </div>
        <div>
          <dt>归档意见</dt>
          <dd>{{ detail.activity.archive.comment || '—' }}</dd>
        </div>
      </dl>
      <p class="sub-label">成果附件</p>
      <AttachmentList
        :activity-id="detail.activity.id"
        :files="detail.files"
        :activity-version="detail.activity.version"
        stage="archive"
        include-contexts
        :can-upload="archiveUpload"
        @uploaded="emit('uploaded')"
      />
    </div>
    <div v-if="detail.activity.archives.length" class="detail-section">
      <h2>历次档案提交</h2>
      <div v-for="attempt in [...detail.activity.archives].reverse()" :key="attempt.version" class="history-item">
        <strong>档案 V{{ attempt.version }} · {{ attempt.code || '历史提交' }}</strong>
        <p>{{ attempt.summary }}{{ attempt.comment ? '\n审核意见：' + attempt.comment : '' }}</p>
      </div>
    </div>
  </div>
</template>
<style scoped>
  .execution-phase {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 18px;
    border: 1px solid #e3eafa;
    background: #f6f9ff;
    border-radius: 10px;
    margin-bottom: 18px;
  }
  .execution-phase > div {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 5px 10px;
    color: #8b97ab;
    align-items: center;
  }
  .execution-phase strong {
    font-size: 14px;
  }
  .execution-phase small {
    width: 100%;
    padding-left: 34px;
    font-size: 12px;
  }
  .execution-phase span {
    border-radius: 50%;
    background: #e4eaf4;
    padding: 5px;
    font-size: 12px;
  }
  .execution-phase .active {
    color: #2d5fd0;
  }
  .execution-phase .active span {
    color: #fff;
    background: #3c70e2;
  }
  .execution-phase i {
    font-style: normal;
    color: #9fb4d5;
  }
  .execution-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin: 20px 0;
  }
  .execution-summary > div {
    padding: 14px;
    border-radius: 8px;
    background: #f7f9fc;
  }
  .execution-summary span {
    display: block;
    font-size: 12px;
    color: #7a879b;
    margin-bottom: 8px;
  }
  .execution-summary strong {
    display: block;
    font-size: 14px;
    color: #344e73;
    overflow-wrap: anywhere;
  }
  .execution-quick-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .assignment-section {
    margin-top: 22px;
  }
  .detail-section h2 {
    font-size: 16px;
  }
  @media (max-width: 600px) {
    .execution-summary {
      grid-template-columns: minmax(0, 1fr);
    }
    .execution-phase {
      gap: 8px;
      padding: 12px;
    }
  }
</style>
