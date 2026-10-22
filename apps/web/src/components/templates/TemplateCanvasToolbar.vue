<script setup lang="tsx">
import { computed } from 'vue';
import { NButton, NButtonGroup, NDropdown, NPopconfirm, NSelect, NTag, NTooltip } from 'naive-ui';
import type { NodeDefinition } from '@workflow/domain';
import type { GraphDirection } from '@/components/graph/types';
import type { EditorCanvasToolbarProps, InsertPosition } from './types';
const props = defineProps<EditorCanvasToolbarProps>();
const emit = defineEmits<{
  mode: [connect: boolean];
  insert: [kind: NodeDefinition['kind'], position: InsertPosition];
  arrange: [];
  disconnect: [];
  direction: [value: GraphDirection];
}>();
const unavailable = computed(() => props.disabled || props.controls.busy || props.controls.issue);
const viewUnavailable = computed(() => props.controls.busy || props.controls.issue);
const placements = [
  { value: 'before', label: '前插' },
  { value: 'after', label: '后插' },
  { value: 'parallel', label: '并行' },
] as const;
const choices = [
  { label: '审批节点', key: 'approval' },
  { label: '办理任务', key: 'task' },
  { label: '知会节点', key: 'notice' },
];
/**
 * 根据明确的接入方向新增所选节点类型。
 * @param kind 节点类型
 * @param position 插入方向
 */
function insert(kind: string | number, position: InsertPosition): void {
  if (kind === 'approval' || kind === 'task' || kind === 'notice') emit('insert', kind, position);
}
</script>
<template>
  <div class="canvas-toolbar">
    <div class="canvas-tools">
      <NButtonGroup
        ><NButton
          size="small"
          :type="!connectMode ? 'primary' : 'default'"
          :disabled="unavailable"
          @click="emit('mode', false)"
          >移动节点</NButton
        ><NButton
          size="small"
          :type="connectMode ? 'primary' : 'default'"
          :disabled="unavailable"
          @click="emit('mode', true)"
          >连接依赖</NButton
        ></NButtonGroup
      ><NSelect
        :value="controls.selected || null"
        :options="controls.options"
        filterable
        placeholder="搜索并定位节点"
        :disabled="controls.busy"
        class="node-search"
        @update:value="controls.locate"
      /><NTooltip
        ><template #trigger
          ><NButton size="small" quaternary :disabled="unavailable" @click="emit('arrange')"
            >自动排列</NButton
          ></template
        >按依赖重新排列，保持流程顺序不变</NTooltip
      >
    </div>
    <div class="viewport-tools">
      <NButtonGroup
        ><NButton
          size="small"
          :type="controls.direction === 'TB' ? 'primary' : 'default'"
          :disabled="unavailable"
          @click="emit('direction', 'TB')"
          >纵向</NButton
        ><NButton
          size="small"
          :type="controls.direction === 'LR' ? 'primary' : 'default'"
          :disabled="unavailable"
          @click="emit('direction', 'LR')"
          >横向</NButton
        ></NButtonGroup
      >
      <div class="zoom-tools">
        <NButton
          size="small"
          quaternary
          aria-label="缩小画布"
          :disabled="viewUnavailable"
          @click="controls.zoomBy(1 / 1.2)"
          >−</NButton
        ><output>{{ controls.zoom }}%</output
        ><NButton
          size="small"
          quaternary
          aria-label="放大画布"
          :disabled="viewUnavailable"
          @click="controls.zoomBy(1.2)"
          >＋</NButton
        >
      </div>
      <NButton size="small" :disabled="viewUnavailable" @click="controls.reset">100%阅读</NButton
      ><NButton size="small" quaternary :disabled="viewUnavailable" @click="controls.fit">查看全图</NButton>
    </div>
  </div>
  <div class="node-context">
    <div class="current-node">
      <span class="selection-dot" /><strong :title="selectedName">{{
        selectedName || '请选择参考节点'
      }}</strong>
    </div>
    <div class="node-insert-actions">
      <NDropdown
        v-for="item in placements"
        :key="item.value"
        trigger="click"
        :options="choices"
        :disabled="unavailable || !selectedName"
        @select="insert($event, item.value)"
        ><NButton
          size="small"
          :disabled="unavailable || !selectedName"
          :type="position === item.value ? 'primary' : 'default'"
          quaternary
          >＋ {{ item.label }}</NButton
        ></NDropdown
      ><NPopconfirm v-if="hasEdge" @positive-click="emit('disconnect')"
        ><template #trigger
          ><NButton size="small" type="error" quaternary :disabled="unavailable"
            >删除选中连线</NButton
          ></template
        >删除依赖后节点可能提前激活，请确认。</NPopconfirm
      >
    </div>
    <NTag v-if="controls.zoom < 85" size="small" type="warning" :bordered="false">全图浏览，点100%阅读</NTag>
  </div>
</template>
<style scoped>
.canvas-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #e6ecf4;
}
.canvas-tools,
.viewport-tools,
.zoom-tools,
.node-insert-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.node-search {
  width: 180px;
}
.viewport-tools {
  margin-left: auto;
}
.zoom-tools {
  gap: 2px;
  border-left: 1px solid #e5eaf2;
  padding-left: 6px;
}
.zoom-tools output {
  min-width: 42px;
  font-size: 13px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: #52637f;
}
.node-context {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 16px;
  min-height: 46px;
  background: #f9fbff;
  border-bottom: 1px solid #e8edf6;
}
.current-node {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 240px;
}
.current-node strong {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selection-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3269e3;
  flex-shrink: 0;
}
.node-insert-actions {
  gap: 2px;
}
.node-context > .n-tag {
  margin-left: auto;
}
@media (max-width: 1100px) {
  .canvas-toolbar {
    padding: 10px 12px;
    gap: 8px;
  }
  .node-search {
    width: 160px;
  }
  .viewport-tools {
    gap: 4px;
  }
}
@media (max-width: 700px) {
  .node-search {
    width: 150px;
  }
  .node-context {
    padding: 8px 12px;
  }
  .current-node {
    max-width: 160px;
  }
}
</style>
