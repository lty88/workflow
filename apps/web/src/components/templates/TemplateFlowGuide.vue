<script setup lang="tsx">
import { computed } from 'vue';
import type { TemplateFlowGuideProps } from './types';
import { templateExecutionSummary } from '@workflow/domain';
const props = defineProps<TemplateFlowGuideProps>();
const execution = computed(() => templateExecutionSummary(props.nodes));
</script>
<template>
  <div class="flow-guide" :class="{ attention: !execution.approvals }" role="note">
    <strong>沿箭头办理 · 拖动只改变布局</strong>
    <span>{{ execution.message }}</span>
    <small>开始与完成为系统标记；所有业务节点均可修改类型、受理人或删除。</small>
  </div>
</template>
<style scoped>
.flow-guide {
  padding: 10px 18px;
  background: #f1f6ff;
  border-bottom: 1px solid #dfe8f6;
  font-size: 13px;
  line-height: 1.7;
  flex-shrink: 0;
}
.flow-guide strong {
  color: #315a9b;
  margin-right: 14px;
}
.flow-guide small {
  display: block;
  font-size: 12px;
  color: #65758d;
}
.flow-guide.attention {
  background: #fff8e9;
  border-color: #f1dfb8;
}
</style>
