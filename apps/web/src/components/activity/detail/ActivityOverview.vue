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
  <NCard class="activity-overview" :class="'tone-' + statusTone" :bordered="false">
    <div class="overview-heading">
      <span class="overview-symbol" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M8 11h8M8 15h8M8 19h4" />
        </svg>
      </span>
      <div class="overview-title">
        <span class="overview-code">
          {{ lifecycleOf(detail.activity).businessType === 'general' ? '通用申请' : '活动申请' }}
          <i />
          {{ detail.activity.code }}
        </span>
        <h1>{{ detail.activity.name || '未命名申请' }}</h1>
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
    <div v-if="nextHint" class="overview-next" role="status">
      <span class="next-indicator" aria-hidden="true" />
      <span class="next-label">当前进展</span>
      <strong>{{ nextHint.text }}</strong>
      <span v-if="nextHint.owner && nextHint.owner !== '—'" class="next-owner">
        负责人
        <b>{{ nextHint.owner }}</b>
      </span>
    </div>
  </NCard>
</template>
<style scoped>
  .activity-overview {
    --status-color: #3d6ad0;
    --status-bg: #f2f6ff;
    border: 1px solid #e3e9f2;
    border-radius: 16px;
    background: #fff;
    overflow: hidden;
    box-shadow: 0 4px 24px #243c6504;
  }
  .tone-success {
    --status-color: #219472;
    --status-bg: #f0f9f5;
  }
  .tone-warning {
    --status-color: #b17a20;
    --status-bg: #fff9ed;
  }
  .tone-error {
    --status-color: #ca4a5d;
    --status-bg: #fff3f5;
  }
  .tone-default {
    --status-color: #7c8ba2;
    --status-bg: #f5f7fa;
  }
  :deep(.n-card__content) {
    padding: 24px 28px 0;
  }
  .overview-heading {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .overview-symbol {
    display: grid;
    place-items: center;
    width: 52px;
    height: 56px;
    flex: none;
    border-radius: 13px;
    color: #5279ce;
    background: linear-gradient(145deg, #edf3ff, #f6f8fd);
    border: 1px solid #e6edfa;
  }
  .overview-symbol svg {
    width: 25px;
    height: 25px;
  }
  .overview-title {
    min-width: 0;
    flex: 1;
  }
  .overview-code {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: #8691a3;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .overview-code i {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: #bdc7d6;
  }
  h1 {
    color: #23324b;
    font-size: 24px;
    font-weight: 650;
    line-height: 1.5;
    margin: 4px 0 0;
    overflow-wrap: anywhere;
  }
  .overview-meta {
    display: grid;
    grid-template-columns: 1.15fr 1fr 1.15fr 1fr;
    gap: 24px;
    margin: 24px 0 20px;
  }
  .overview-meta > div {
    min-width: 0;
  }
  .overview-meta > div + div {
    border-left: 1px solid #edf0f5;
    padding-left: 24px;
  }
  dt {
    font-size: 12px;
    color: #8b96a7;
    margin-bottom: 7px;
  }
  dd {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
    margin: 0;
    color: #46556d;
    font-size: 13px;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }
  .applicant dd {
    font-weight: 500;
  }
  .person-avatar {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 50%;
    color: #5472ab;
    background: #edf2fc;
    font-size: 12px;
  }
  .overview-next {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    margin-inline: -28px;
    padding: 13px 28px;
    border-top: 1px solid #edf1f6;
    background: var(--status-bg);
    font-size: 13px;
  }
  .next-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--status-color);
    flex: none;
  }
  .next-label {
    color: var(--status-color);
    white-space: nowrap;
  }
  .overview-next strong {
    flex: 1;
    min-width: 160px;
    font-weight: 500;
    line-height: 1.7;
    color: #46556b;
    overflow-wrap: anywhere;
  }
  .next-owner {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    color: #7a879a;
    line-height: 1.7;
  }
  .next-owner b {
    color: #53647d;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  @media (max-width: 1100px) {
    .overview-meta {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px 24px;
    }
    .overview-meta > div:nth-child(3) {
      border-left: 0;
      padding-left: 0;
    }
  }
  @media (max-width: 600px) {
    :deep(.n-card__content) {
      padding: 20px 16px 0;
    }
    .overview-symbol {
      display: none;
    }
    h1 {
      font-size: 21px;
    }
    .overview-heading {
      gap: 10px;
      align-items: flex-start;
    }
    .overview-meta {
      gap: 18px 16px;
    }
    .overview-meta > div + div {
      padding-left: 16px;
    }
    .overview-meta > div:nth-child(3) {
      padding-left: 0;
    }
    .overview-next {
      margin-inline: -16px;
      padding: 12px 16px;
    }
    .next-owner {
      width: 100%;
      padding-left: 18px;
    }
  }
</style>
