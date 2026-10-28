<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NCard, NTag } from 'naive-ui'
  import { STATUSES, lifecycleOf } from '@workflow/domain'
  import type { ActivityDetailSectionProps } from './types'
  import { formatTime } from '@/composables/format'
  import { participantName } from './presentation'
  import { useActivityPresentation } from './use-activity-presentation'
  const props = defineProps<ActivityDetailSectionProps>()
  const { statusTone, nextHint, templateLabel } = useActivityPresentation(
    computed(() => props.detail),
    ref('current')
  )
  const applicant = computed(() => props.detail.activity.applicantName || participantName(props.detail, props.detail.activity.applicant))
</script>
<template>
  <NCard class="activity-overview" :bordered="false">
    <div class="overview-heading">
      <div>
        <span class="overview-code">{{ lifecycleOf(detail.activity).businessType === 'general' ? '申请详情' : '活动详情' }} · {{ detail.activity.code }}</span>
        <h1>{{ detail.activity.name || '未命名活动' }}</h1>
      </div>
      <NTag size="large" round :bordered="false" :type="statusTone">{{ STATUSES[detail.activity.status] }}</NTag>
    </div>
    <dl class="overview-meta">
      <div class="applicant">
        <dt>发起人</dt>
        <dd>
          <span class="person-avatar" aria-hidden="true">{{ applicant.slice(0, 1) }}</span>
          {{ applicant }}
        </dd>
      </div>
      <div>
        <dt>发起时间</dt>
        <dd>{{ formatTime(detail.activity.createdAt) }}</dd>
      </div>
      <div>
        <dt>流程模板</dt>
        <dd>{{ templateLabel.replace('流程模板：', '') }}</dd>
      </div>
      <div>
        <dt>最近更新</dt>
        <dd>{{ formatTime(detail.activity.updatedAt) }}</dd>
      </div>
    </dl>
    <div v-if="nextHint" class="overview-next">
      <span class="next-label">当前进展</span>
      <strong>{{ nextHint.text }}</strong>
      <span v-if="nextHint.owner && nextHint.owner !== '—'" class="next-owner">负责人：{{ nextHint.owner }}</span>
    </div>
  </NCard>
</template>
<style scoped>
  .activity-overview {
    border: 1px solid #dfe7f5;
    border-radius: 14px;
    background: linear-gradient(115deg, #fff 65%, #f4f7ff);
  }
  .overview-heading {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
  }
  .overview-code {
    color: #73819a;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  h1 {
    font-size: 25px;
    line-height: 1.5;
    margin: 8px 0 0;
    overflow-wrap: anywhere;
  }
  .overview-meta {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 20px;
    margin: 26px 0 22px;
  }
  dt {
    font-size: 13px;
    color: #758299;
    margin-bottom: 8px;
  }
  dd {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    margin: 0;
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .applicant dd {
    font-weight: 600;
    color: #234377;
  }
  .person-avatar {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 50%;
    color: #315fd3;
    background: #e8efff;
  }
  .overview-next {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 16px;
    padding: 14px 16px;
    background: #edf3ff;
    border-radius: 9px;
    font-size: 14px;
  }
  .next-label {
    color: #4468b0;
    white-space: nowrap;
  }
  .overview-next strong {
    flex: 1;
    min-width: 160px;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }
  .next-owner {
    color: #657794;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }
  @media (max-width: 1200px) {
    .overview-meta {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 600px) {
    h1 {
      font-size: 21px;
    }
    .overview-heading {
      gap: 10px;
    }
    .overview-meta {
      gap: 16px 12px;
    }
    .overview-next {
      align-items: flex-start;
    }
    .next-owner {
      width: 100%;
    }
  }
</style>
