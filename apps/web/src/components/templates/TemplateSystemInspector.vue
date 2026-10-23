<script setup lang="tsx">
import { NAlert, NButton, NTag } from 'naive-ui';
import type { NodeDefinition } from '@workflow/domain';
import type { TemplateSystemInspectorProps } from './types';
defineProps<TemplateSystemInspectorProps>();
const emit = defineEmits<{ add: [kind: NodeDefinition['kind']] }>();
</script>
<template>
  <aside class="system-inspector">
    <header>
      <h3>{{ start ? '开始 · 提交申请' : '流程办理完成' }}</h3>
      <NTag :bordered="false">系统标记</NTag>
    </header>
    <p>
      {{
        start
          ? '申请人提交活动后，系统启动所有没有前置的业务节点。第一个业务节点可以是审批、任务或知会。'
          : '全部生效的审批与任务完成后，活动进入待指派。知会自动通知，不增加人工关卡。'
      }}
    </p>
    <NAlert type="info" :bordered="false">{{
      start
        ? '该标记无需受理人。选择一种业务节点，在开始之后添加并配置办理规则。'
        : '这是模板流程结束，后续还有指派执行、执行汇报和成果归档。归档后才代表活动完成。'
    }}</NAlert>
    <div v-if="start" class="first-node-actions">
      <NButton :disabled="disabled" @click="emit('add', 'approval')">＋ 审批节点</NButton>
      <NButton :disabled="disabled" @click="emit('add', 'task')">＋ 任务节点</NButton>
      <NButton :disabled="disabled" @click="emit('add', 'notice')">＋ 知会节点</NButton>
    </div>
    <small>系统标记由流程引擎维护，无需编辑或删除。</small>
  </aside>
</template>
<style scoped>
.system-inspector {
  height: 100%;
  overflow: auto;
  padding: 20px;
  border-left: 1px solid #e2e8f2;
  background: #fff;
  min-width: 0;
  font-size: 14px;
  line-height: 1.8;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h3 {
  margin: 0;
  font-size: 15px;
}
p {
  color: #52637c;
  margin: 18px 0;
}
small {
  display: block;
  font-size: 12px;
  color: #76849a;
  margin-top: 18px;
}
.first-node-actions {
  display: grid;
  gap: 12px;
  margin-top: 20px;
}
</style>
