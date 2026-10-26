<script setup lang="tsx">
  import { NUploadDragger } from 'naive-ui'
  import type { AttachmentUploadPromptProps } from './types'
  defineProps<AttachmentUploadPromptProps>()
</script>
<template>
  <NUploadDragger class="attachment-upload-prompt" :class="{ 'is-disabled': disabled, 'is-busy': busy }" :aria-busy="busy">
    <span class="upload-symbol" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 16V4m0 0L7 9m5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
    <strong>{{ busy ? '正在上传，请稍候…' : disabled ? '暂不可继续上传附件' : '点击选择文件，或拖拽文件到这里' }}</strong>
    <span class="upload-description">{{ description }}</span>
    <span class="upload-limits">{{ limitLabel }}</span>
  </NUploadDragger>
</template>
<style scoped>
  .attachment-upload-prompt {
    width: 100%;
    min-height: 168px;
    padding: 26px 20px;
    border: 1px dashed #9fb8ed;
    border-radius: 12px;
    background: linear-gradient(135deg, #f6f9ff, #fcfdff);
    transition:
      border-color 0.2s,
      background 0.2s;
  }
  .attachment-upload-prompt:hover {
    border-color: #356ae0;
    background: #eff5ff;
  }
  .upload-symbol {
    display: grid;
    place-items: center;
    color: #396bd9;
    background: #e8efff;
    width: 48px;
    height: 48px;
    border-radius: 12px;
    margin: 0 auto 12px;
  }
  strong {
    display: block;
    font-size: 16px;
    line-height: 1.6;
    color: #2b4778;
    font-weight: 600;
  }
  .upload-description,
  .upload-limits {
    display: block;
    line-height: 1.7;
    margin-top: 6px;
    font-size: 13px;
    color: #74849d;
  }
  .upload-limits {
    font-size: 12px;
    color: #8190a6;
  }
  .is-disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .is-busy {
    border-style: solid;
    background: #f2f6ff;
  }
  @media (max-width: 600px) {
    .attachment-upload-prompt {
      min-height: 154px;
      padding: 22px 14px;
    }
    strong {
      font-size: 15px;
    }
  }
</style>
