<script setup lang="tsx">
  import { ref } from 'vue'
  import { NTooltip } from 'naive-ui'
  import type { PermissionHintProps } from './types'
  defineProps<PermissionHintProps>()
  const visible = ref(false)
</script>
<template>
  <NTooltip v-model:show="visible" trigger="hover" placement="top-start" :delay="150" :style="{ maxWidth: 'min(340px, calc(100vw - 40px))' }">
    <template #trigger>
      <button
        type="button"
        class="permission-hint-trigger"
        :aria-label="label"
        @focus="visible = true"
        @blur="visible = false"
        @click.stop.prevent="visible = true"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4" />
          <path d="M10 9v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="10" cy="6.4" r=".9" fill="currentColor" />
        </svg>
      </button>
    </template>
    <div class="permission-tooltip-content"><slot /></div>
  </NTooltip>
</template>
<style scoped>
  .permission-hint-trigger {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    color: #8491a6;
    background: transparent;
    cursor: help;
    vertical-align: middle;
  }
  .permission-hint-trigger:hover,
  .permission-hint-trigger:focus-visible {
    color: #2864e8;
    background: #edf3ff;
  }
  .permission-hint-trigger:focus-visible {
    outline: 2px solid #a8c3ff;
    outline-offset: 1px;
  }
  .permission-tooltip-content {
    font-size: 12px;
    line-height: 1.7;
    font-weight: 400;
    overflow-wrap: anywhere;
  }
  .permission-tooltip-content :deep(p) {
    margin: 0;
  }
  .permission-tooltip-content :deep(p + p) {
    margin-top: 6px;
  }
</style>
