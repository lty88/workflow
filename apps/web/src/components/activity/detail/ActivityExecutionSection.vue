<script setup lang="tsx">
import { computed } from 'vue';
import type { ActivityExecutionProps } from './types';
import { formatTime, formatMoney } from '@/composables/format';
import AttachmentList from '@/components/activity/AttachmentList.vue';
import { EXECUTION_STATUSES, participantName } from './presentation';

const props = defineProps<ActivityExecutionProps>();
const emit = defineEmits<{ uploaded: [] }>();
const executionVisible = computed(() => {
  const activity = props.detail.activity;
  return (
    EXECUTION_STATUSES.includes(activity.status) ||
    !!activity.report ||
    !!activity.archive ||
    !!activity.assignment
  );
});

/**
 * 按参与人标识读取已授权的展示姓名。
 * @param id 人员标识
 * @returns 姓名或占位标识
 */
function nameFor(id: string): string {
  return participantName(props.detail, id);
}
</script>
<template>
  <div v-if="executionVisible" class="detail-section">
    <h2>执行安排</h2>
    <p>执行人：{{ nameFor(detail.activity.executor) }}</p>
    <p v-if="detail.activity.assignment">{{ detail.activity.assignment }}</p>
    <p class="sub-label">执行资料附件</p>
    <AttachmentList
      :activity-id="detail.activity.id"
      :files="detail.files"
      :activity-version="detail.activity.version"
      stage="execution"
      :can-upload="executionUpload"
      @uploaded="emit('uploaded')"
    />
  </div>
  <div v-if="detail.activity.report" class="detail-section">
    <h2>执行汇报</h2>
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
    <template v-if="detail.activity.report.exception"
      ><p class="sub-label">异常说明</p>
      <p>{{ detail.activity.report.exception }}</p></template
    >
  </div>
  <div v-if="detail.activity.archive" class="detail-section">
    <h2>
      活动档案
      <small
        >提交 V{{ detail.activity.archive.version
        }}{{ detail.activity.archive.code ? ' · ' + detail.activity.archive.code : '' }}</small
      >
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
      :can-upload="archiveUpload"
      @uploaded="emit('uploaded')"
    />
  </div>
  <div v-if="detail.activity.archives.length" class="detail-section">
    <h2>历次档案提交</h2>
    <div
      v-for="attempt in [...detail.activity.archives].reverse()"
      :key="attempt.version"
      class="history-item"
    >
      <strong>档案 V{{ attempt.version }} · {{ attempt.code || '历史提交' }}</strong>
      <p>{{ attempt.summary }}{{ attempt.comment ? '\n审核意见：' + attempt.comment : '' }}</p>
    </div>
  </div>
</template>
