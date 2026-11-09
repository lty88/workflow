<script setup lang="tsx">
  import { computed } from 'vue'
  import { ACTIVITY_SUBPROCESS, activitySubprocessPosition } from '@workflow/domain'
  import type { ActivityDetailSectionProps } from './types'
  const props = defineProps<ActivityDetailSectionProps>()
  const position = computed(() =>
    activitySubprocessPosition(props.detail.activity.status === 'cancel_review' ? props.detail.activity.cancellation?.previous : props.detail.activity.status)
  )
</script>
<template>
  <ol class="lifecycle-strip" aria-label="执行与归档阶段">
    <li
      v-for="(stage, index) in ACTIVITY_SUBPROCESS"
      :key="stage.key"
      :class="{ complete: index < position, current: index === position }"
      :aria-current="index === position ? 'step' : undefined"
    >
      <span class="stage-number" aria-hidden="true">{{ index < position ? '✓' : '0' + (index + 1) }}</span>
      <div>
        <strong>{{ stage.label }}</strong>
        <small>{{ index < position ? '已完成' : index === position ? '当前阶段' : '待进入' }}</small>
      </div>
    </li>
  </ol>
</template>
<style scoped>
  .lifecycle-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin: 0 0 22px;
    padding: 18px 20px;
    list-style: none;
    background: #f7f9fc;
    border: 1px solid #eaf0f6;
    border-radius: 12px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    color: #98a3b3;
    position: relative;
  }
  li + li::before {
    content: '';
    width: 16px;
    height: 1px;
    position: absolute;
    left: -20px;
    background: #dce4f0;
  }
  .stage-number {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #eaf0f6;
    color: #96a5b9;
    font-size: 11px;
    flex: none;
  }
  strong {
    display: block;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    color: #9aa6b6;
  }
  .complete .stage-number {
    color: #258b6b;
    background: #e8f4ee;
  }
  .complete strong {
    color: #4c6e61;
  }
  .current .stage-number {
    color: #fff;
    background: #4874dc;
    box-shadow: 0 0 0 4px #e9effc;
  }
  .current strong,
  .current small {
    color: #4874dc;
  }
  @media (max-width: 650px) {
    .lifecycle-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      padding: 16px;
    }
    li + li::before {
      display: none;
    }
  }
</style>
