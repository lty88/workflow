<script setup lang="tsx">
import { computed, shallowRef, ref, watch } from 'vue';
import type { NodeDefinition, TemplateLayout } from '@workflow/domain';
import type { TemplateCanvasProps, GraphConnection, InsertPosition } from './types';
import type { BusinessGraphModel, GraphSelection, GraphDirection } from '@/components/graph/types';
import BusinessGraph from '@/components/graph/BusinessGraph.vue';
import TemplateCanvasToolbar from './TemplateCanvasToolbar.vue';
import { templateEditorGraph } from './editor-model';
const props = defineProps<TemplateCanvasProps>();
const emit = defineEmits<{
  select: [id: string];
  insert: [kind: NodeDefinition['kind'], position: InsertPosition];
  positions: [value: TemplateLayout['positions']];
  connect: [value: GraphConnection];
  disconnect: [value: GraphConnection];
  arrange: [];
  direction: [value: GraphDirection];
}>();
const connectMode = ref(false);
const dragging = ref(false);
const edge = ref<GraphConnection | null>(null);
const model = shallowRef<BusinessGraphModel>({ data: { nodes: [], edges: [] } });
const key = computed(() =>
  JSON.stringify({
    name: props.definition.name,
    nodes: props.definition.nodes,
    config: props.config.version,
  }),
);
const selectedName = computed(() => {
  for (const node of props.definition.nodes) if (node.id === props.selected) return node.label;
  return '';
});
const positionLabel = computed(
  () => ({ before: '之前', after: '之后', parallel: '并行位置' })[props.position],
);
/** 重建仅含可编辑节点的G6模型，纯布局移动不触发自动缩放。 */
function rebuild(): void {
  model.value = templateEditorGraph({
    ...props.config,
    workflow: { name: props.definition.name, nodes: props.definition.nodes },
  });
  edge.value = null;
}
/**
 * 将图节点选择交给父组件，切换前统一应用未保存属性。
 * @param value 图节点选择
 */
function select(value: GraphSelection): void {
  if (value.kind === 'workflow') {
    edge.value = null;
    emit('select', value.id);
  }
}
/**
 * 转发工具栏选择的类型和相对位置，保留多参数事件的完整语义。
 * @param kind 新增节点类型
 * @param position 接入方向
 */
function insert(kind: NodeDefinition['kind'], position: InsertPosition): void {
  emit('insert', kind, position);
}
/**
 * 记录业务连线，用于工具栏显式删除。
 * @param value 连线两端
 */
function selectEdge(value: GraphConnection): void {
  edge.value = value;
}
/**
 * 接受来自节点库的拖动，在整个画布显示明确插入提示。
 * @param event 原生拖过事件
 */
function dragOver(event: DragEvent): void {
  if (props.disabled || !props.selected || !event.dataTransfer?.types.includes('application/workflow-node'))
    return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  dragging.value = true;
}
/**
 * 拖动离开整个画布时移除插入提示，经过子元素时保持提示。
 * @param event 原生离开事件
 */
function dragLeave(event: DragEvent): void {
  if (
    event.currentTarget instanceof Node &&
    event.relatedTarget instanceof Node &&
    event.currentTarget.contains(event.relatedTarget)
  )
    return;
  dragging.value = false;
}
/**
 * 将节点放入选中节点的明确相对位置，不要求寻找画布外的狭小接入区。
 * @param event 原生放置事件
 */
function drop(event: DragEvent): void {
  dragging.value = false;
  const kind = event.dataTransfer?.getData('application/workflow-node');
  if (!['approval', 'task', 'notice'].includes(kind || '')) return;
  event.preventDefault();
  if (!props.disabled && props.selected && (kind === 'approval' || kind === 'task' || kind === 'notice'))
    emit('insert', kind, props.position);
}
/** 删除工具栏选中的业务依赖，父组件负责结构校验和撤销记录。 */
function disconnect(): void {
  if (edge.value) emit('disconnect', edge.value);
}
/**
 * 保存坐标清空时恢复依赖布局，兼容自动排列和撤销。
 * @param count 保存坐标数量
 */
function positionsCountChanged(count: number): void {
  if (!count) rebuild();
}
/** 切换到只读或保存状态时取消拖放提示。 */
function disabledChanged(): void {
  dragging.value = false;
}
watch(key, rebuild, { immediate: true });
watch(() => Object.keys(props.definition.layout.positions).length, positionsCountChanged);
watch(() => props.disabled, disabledChanged);
</script>
<template>
  <section
    class="template-canvas"
    :class="{ 'is-dragging': dragging }"
    aria-label="审批流程编辑画布"
    @dragover="dragOver"
    @dragleave="dragLeave"
    @drop="drop"
    @dragend="dragging = false"
  >
    <BusinessGraph
      :model="model"
      :selected-key="selected ? 'workflow:' + selected : ''"
      fill
      hide-footer
      focus-on-select
      fit="readable"
      :node-width="280"
      :direction="definition.layout.direction"
      label="审批流程设计画布"
      :editable="!disabled"
      :connect-mode="connectMode"
      :positions="definition.layout.positions"
      @select="select"
      @positions="emit('positions', $event)"
      @connect="emit('connect', $event)"
      @edge-select="selectEdge"
    >
      <template #toolbar="{ controls }"
        ><TemplateCanvasToolbar
          :controls="controls"
          :connect-mode="connectMode"
          :disabled="disabled"
          :selected-name="selectedName"
          :position="position"
          :has-edge="!!edge"
          @mode="connectMode = $event"
          @insert="insert"
          @arrange="emit('arrange')"
          @disconnect="disconnect"
          @direction="emit('direction', $event)"
      /></template>
    </BusinessGraph>
    <div v-if="dragging" class="drop-preview" role="status">
      <div>
        <span>＋</span><strong>松开添加到「{{ selectedName }}」{{ positionLabel }}</strong>
        <p>新节点将接入依赖，添加后可在右侧设置受理人。</p>
      </div>
    </div>
    <footer class="canvas-status">
      <span v-if="connectMode">连线模式：依次点击前置节点、后续节点</span
      ><span v-else>100%清晰编辑 · 拖动空白平移 · 节点目录可快速定位</span
      ><span>审批完成后 → 指派执行 → 执行汇报 → 成果归档</span>
    </footer>
  </section>
</template>
<style scoped>
.template-canvas {
  height: 100%;
  min-height: 0;
  min-width: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  background: #fafcff;
  overflow: hidden;
}
.template-canvas :deep(.business-graph-host) {
  flex: 1;
  min-height: 0;
  height: 0;
}
.template-canvas :deep(.graph-canvas) {
  background-image: radial-gradient(#d9e2f0 0.7px, transparent 0.7px);
  background-size: 20px 20px;
}
.canvas-status {
  display: flex;
  justify-content: space-between;
  gap: 8px 16px;
  flex-wrap: wrap;
  padding: 10px 16px;
  background: #fff;
  border-top: 1px solid #e5ebf4;
  color: #7a879b;
  font-size: 12px;
  line-height: 1.5;
  flex-shrink: 0;
}
.drop-preview {
  position: absolute;
  inset: 104px 14px 44px;
  z-index: 5;
  border: 2px dashed #5685e8;
  border-radius: 12px;
  background: #edf4ffe8;
  display: grid;
  place-items: center;
  pointer-events: none;
  text-align: center;
  padding: 20px;
}
.drop-preview span {
  display: block;
  font-size: 32px;
  line-height: 1;
  color: #3268d7;
  margin-bottom: 14px;
}
.drop-preview strong {
  font-size: 16px;
  font-weight: 600;
  color: #2a4f97;
}
.drop-preview p {
  font-size: 13px;
  color: #6b80a4;
  margin: 10px 0 0;
}
@media (max-width: 1100px) {
  .canvas-status > span:last-child {
    display: none;
  }
  .canvas-status {
    padding: 9px 12px;
  }
}
</style>
