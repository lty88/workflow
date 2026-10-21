<script setup lang="tsx">
import { NButton, NButtonGroup, NSelect } from 'naive-ui';
import type { GraphDirection, GraphToolbarProps } from './types';
defineProps<GraphToolbarProps>();
const emit = defineEmits<{
  locate: [value: string | null];
  zoom: [ratio: number];
  fit: [];
  reset: [];
  expand: [];
  direction: [value: GraphDirection];
}>();
</script>
<template>
  <div class="graph-toolbar">
    <div class="graph-heading">
      <div class="graph-heading-text">
        <strong>{{ label }}</strong
        ><span>{{ nodeCount }} 个节点</span>
      </div>
      <NButton type="primary" data-graph-expand :aria-expanded="expanded" @click="emit('expand')">{{
        expanded ? '收起全屏 · Esc' : '⛶ 全屏查看'
      }}</NButton>
    </div>
    <div class="graph-controls">
      <NSelect
        :value="selected || null"
        :options="options"
        filterable
        clearable
        placeholder="搜索节点并定位"
        class="graph-search"
        :disabled="busy || issue"
        @update:value="emit('locate', $event)"
      />
      <div class="graph-actions">
        <NButtonGroup aria-label="流程布局方向">
          <NButton
            size="small"
            :type="direction === 'TB' ? 'primary' : 'default'"
            :disabled="busy"
            :aria-pressed="direction === 'TB'"
            @click="emit('direction', 'TB')"
            >纵向</NButton
          >
          <NButton
            size="small"
            :type="direction === 'LR' ? 'primary' : 'default'"
            :disabled="busy"
            :aria-pressed="direction === 'LR'"
            @click="emit('direction', 'LR')"
            >横向</NButton
          >
        </NButtonGroup>
        <div class="graph-zoom-controls" role="group" aria-label="画布缩放">
          <NButton size="small" :disabled="busy || issue" aria-label="缩小图形" @click="emit('zoom', 1 / 1.2)"
            >−</NButton
          >
          <output class="graph-zoom" aria-label="当前缩放比例">{{ zoom }}%</output>
          <NButton size="small" :disabled="busy || issue" aria-label="放大图形" @click="emit('zoom', 1.2)"
            >＋</NButton
          >
        </div>
        <NButton size="small" :disabled="busy || issue" @click="emit('reset')">100% 原始大小</NButton>
        <NButton size="small" :disabled="busy || issue" @click="emit('fit')">适应画布</NButton>
      </div>
    </div>
  </div>
</template>
<style scoped>
.graph-toolbar {
  padding: 16px;
  border-bottom: 1px solid #e2e8f2;
  background: #fff;
  flex-shrink: 0;
}
.graph-heading,
.graph-controls,
.graph-actions,
.graph-heading-text,
.graph-zoom-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.graph-heading,
.graph-controls {
  justify-content: space-between;
}
.graph-heading {
  margin-bottom: 12px;
}
.graph-heading-text {
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px 12px;
}
.graph-heading-text strong {
  font-size: 16px;
  color: #263854;
}
.graph-heading-text span {
  font-size: 13px;
  color: #687993;
  white-space: nowrap;
}
.graph-controls,
.graph-actions {
  flex-wrap: wrap;
}
.graph-search {
  width: 260px;
  max-width: 100%;
}
.graph-actions {
  gap: 10px;
}
.graph-zoom-controls {
  gap: 6px;
}
.graph-zoom {
  min-width: 52px;
  text-align: center;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: #354a6d;
}
@media (max-width: 850px) {
  .graph-toolbar {
    padding: 12px;
  }
  .graph-search {
    width: 100%;
  }
  .graph-heading {
    align-items: flex-start;
  }
  .graph-heading-text strong {
    font-size: 14px;
  }
  .graph-heading :deep(.n-button) {
    flex-shrink: 0;
  }
  .graph-actions {
    gap: 8px;
  }
}
</style>
