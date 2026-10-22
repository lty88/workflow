<script setup lang="tsx">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NAlert, NButton, NEmpty, NSpin } from 'naive-ui';
import type { Graph, GraphOptions, IEvent, NodeData, EdgeData, IElementDragEvent } from '@antv/g6';
import type {
  BusinessGraphProps,
  GraphConnection,
  GraphDirection,
  GraphLocateOption,
  GraphSelection,
  GraphToolbarControls,
  GraphToolbarSlot,
} from './types';
import { clone } from '@/composables/format';
import GraphToolbar from './GraphToolbar.vue';
import { useGraphExpansion } from './use-graph-expansion';
const props = withDefaults(defineProps<BusinessGraphProps>(), {
  selectedKey: '',
  height: 560,
  direction: 'TB',
  label: '业务关系图',
  fit: 'overview',
  nodeWidth: 240,
});
const emit = defineEmits<{
  select: [value: GraphSelection];
  clear: [];
  positions: [value: Record<string, { x: number; y: number }>];
  connect: [value: GraphConnection];
  'edge-select': [value: GraphConnection];
}>();
defineSlots<{ toolbar?(props: GraphToolbarSlot): unknown }>();
const root = ref<HTMLElement | null>(null);
const container = ref<HTMLDivElement | null>(null);
const { expanded, placeholderHeight, toggleExpanded } = useGraphExpansion(root);
const direction = ref<GraphDirection>(props.direction);
const zoomPercent = ref(100);
const busy = ref(false);
const errorText = ref('');
const selected = ref(props.selectedKey);
let graph: Graph | null = null;
let observer: ResizeObserver | null = null;
let disposed = false;
let updating = false;
let queued = false;
const options = computed(() => (props.model.data.nodes || []).map(nodeOption));
const controls = computed<GraphToolbarControls>(() => ({
  label: props.label,
  nodeCount: props.model.data.nodes?.length || 0,
  options: options.value,
  selected: props.selectedKey || selected.value,
  busy: busy.value,
  issue: !!props.model.issue || !!errorText.value || !props.model.data.nodes?.length,
  zoom: zoomPercent.value,
  expanded: expanded.value,
  direction: direction.value,
  locate,
  zoomBy: zoom,
  fit,
  reset: resetZoom,
  changeDirection,
}));
/**
 * 转换定位下拉项，键盘用户也能选择画布节点。
 * @param node 图节点
 * @returns 定位选项
 */
function nodeOption(node: NodeData): GraphLocateOption {
  return { label: String(node.data?.label || node.id), value: node.id };
}
/**
 * 将G6节点还原成受控业务选择事件。
 * @param node G6节点
 * @returns 业务标识和图标识
 */
function selectionFor(node: NodeData): GraphSelection {
  return {
    id: String(node.data?.businessId || ''),
    graphId: node.id,
    kind: node.data?.kind as GraphSelection['kind'],
  };
}
/**
 * 应用唯一选择状态，业务颜色保持原样。
 */
async function syncSelection(): Promise<void> {
  if (!graph || disposed || updating) return;
  const states: Record<string, string[]> = {};
  for (const node of props.model.data.nodes || [])
    states[node.id] = node.id === (props.selectedKey || selected.value) ? ['selected'] : [];
  await graph.setElementState(states, false);
}
/**
 * 选择节点并联动外部业务面板，不直接执行审批或修改组织。
 * @param key G6节点标识
 * @param focus 是否定位画布
 */
async function selectNode(key: string, focus = false): Promise<void> {
  const node = props.model.data.nodes?.find(
    /**
     * 查找点击或键盘定位的节点。
     * @param item 节点
     * @returns 是否匹配
     */ function match(item) {
      return item.id === key;
    },
  );
  if (!node) return;
  selected.value = key;
  await syncSelection();
  if (focus && graph && !updating) await graph.focusElement(key, false);
  emit('select', selectionFor(node));
}
/**
 * 响应G6节点点击并将异常转换为可见提示。
 * @param event G6指针事件
 */
function nodeClick(event: IEvent): void {
  if (
    'targetType' in event &&
    event.targetType === 'node' &&
    event.target &&
    'id' in event.target &&
    typeof event.target.id === 'string'
  )
    void selectNode(event.target.id).catch(graphError);
}
/**
 * 仅允许编辑模式拖动真实流程节点，展示阶段与审批办理图保持只读。
 * @param event 图节点拖动事件
 * @returns 是否允许拖动
 */
function canDrag(event: IElementDragEvent): boolean {
  return (
    !!props.editable &&
    !props.connectMode &&
    event.targetType === 'node' &&
    String(event.target?.id || '').startsWith('workflow:')
  );
}
/**
 * 拖动结束后保存全部业务节点坐标，坐标不改变流程前置关系。
 * @param _ids G6已移动的节点标识
 */
function positionsChanged(_ids: string[]): void {
  if (!graph || !props.editable) return;
  const result: Record<string, { x: number; y: number }> = {};
  for (const node of props.model.data.nodes || [])
    if (node.data?.kind === 'workflow') {
      const point = graph.getElementPosition(node.id);
      result[String(node.data.businessId)] = { x: point[0], y: point[1] };
    }
  emit('positions', result);
}
/**
 * 将自由连线转换为受控前置关系请求，实际增边由父组件校验后应用。
 * @param edge G6候选连接
 * @returns 不直接添加边，由受控图数据更新
 */
function createConnection(edge: EdgeData): undefined {
  if (props.editable && edge.source.startsWith('workflow:') && edge.target.startsWith('workflow:'))
    emit('connect', { source: edge.source.slice(9), target: edge.target.slice(9) });
  return undefined;
}
/**
 * 选择可编辑连接，供父组件提供删除按钮和键盘替代操作。
 * @param event 图连线点击事件
 */
function selectEdge(event: IEvent): void {
  if (!graph || !props.editable || !('target' in event) || !event.target || !('id' in event.target)) return;
  const edge = graph.getEdgeData(String(event.target.id));
  if (edge.source.startsWith('workflow:') && edge.target.startsWith('workflow:'))
    emit('edge-select', { source: edge.source.slice(9), target: edge.target.slice(9) });
}
/**
 * 根据设计器模式配置节点移动和自由连线；普通业务图沿用只读交互。
 * @returns G6交互配置
 */
function graphBehaviors(): GraphOptions['behaviors'] {
  if (!props.editable) return ['drag-canvas', 'zoom-canvas'];
  return [
    'drag-canvas',
    'zoom-canvas',
    { key: 'template-move', type: 'drag-element', enable: canDrag, onFinish: positionsChanged },
    {
      key: 'template-connect',
      type: 'create-edge',
      enable: !!props.connectMode,
      trigger: 'click',
      onCreate: createConnection,
    },
  ];
}
/** 将切换的编辑模式同步到已创建画布，不重置审批依赖或节点坐标。 */
function syncBehaviors(): void {
  if (graph && !disposed) graph.setBehaviors(graphBehaviors() || []);
}
/** 将已保存的业务节点坐标还原到画布，不触发自动布局或改变连线依赖。 */
async function syncPositions(): Promise<void> {
  if (!graph || !props.editable || disposed) return;
  const positions: Record<string, [number, number]> = {};
  for (const node of props.model.data.nodes || []) {
    const value = props.positions?.[String(node.data?.businessId)];
    if (node.data?.kind === 'workflow' && value) positions[node.id] = [value.x, value.y];
  }
  if (Object.keys(positions).length) await graph.translateElementTo(positions, false);
}
/** 以可见错误处理坐标恢复失败，避免异步监听抛出未处理异常。 */
function restorePositions(): void {
  void syncPositions().catch(graphError);
}
/**
 * 响应定位下拉选择。
 * @param value 图节点标识
 */
function locate(value: string | null): void {
  if (!value) {
    clearSelection();
    return;
  }
  void selectNode(value, true).catch(graphError);
}
/**
 * 清除画布选中，并通知外部取消筛选。
 */
function clearSelection(): void {
  selected.value = '';
  emit('clear');
  void syncSelection().catch(graphError);
}
/**
 * 显示图形加载或渲染错误，保留外围业务列表。
 * @param error 图引擎异常
 */
function graphError(error: unknown): void {
  if (!disposed) errorText.value = error instanceof Error ? error.message : '图形加载失败，请重试';
}
/**
 * 销毁旧图实例，释放画布、事件与渲染资源。
 */
function destroyGraph(): void {
  if (graph) {
    graph.destroy();
    graph = null;
  }
}
/**
 * 构造统一的分层布局，节点依赖由业务数据提供。
 * @returns G6布局配置
 */
function layoutOptions(): GraphOptions['layout'] {
  return { type: 'dagre', rankdir: direction.value, nodesep: 32, ranksep: 48, edgesep: 18 };
}
/** 将滚轮、按钮和自动适配产生的实际缩放比例同步到工具栏。 */
function syncZoom(): void {
  if (graph && !disposed) zoomPercent.value = Math.round(graph.getZoom() * 100);
}
/** 完整适配当前容器，限制自动放大到100%，避免少量节点被放成巨型卡片。 */
async function fitContent(): Promise<void> {
  if (!graph || disposed) return;
  await graph.fitView({ when: 'always' }, false);
  if (disposed || !graph) return;
  if (graph.getZoom() > 1) {
    await graph.zoomTo(1, false);
    await graph.fitCenter(false);
  }
  syncZoom();
}
/**
 * 选取初始聚焦节点：办理中节点优先，其次已选节点，最后回退到首个节点。
 * @returns 图节点标识
 */
function focusKey(): string {
  if (selected.value) return selected.value;
  const nodes = props.model.data.nodes || [];
  const active = nodes.find((node) => node.data?.tone === 'active');
  return String(active?.id || nodes[0]?.id || '');
}
/** 窄容器聚焦模式：保持 100% 清晰缩放并定位办理中节点，路线全貌交给适配或全屏按钮。 */
async function focusContent(): Promise<void> {
  if (!graph || disposed) return;
  await graph.zoomTo(1, false);
  const key = props.selectedKey || selected.value || focusKey();
  if (key && !disposed) await graph.focusElement(key, false);
  else await graph.fitCenter(false);
  syncZoom();
}
/** 可读模式保持100%，完整路线放得下时居中，长流程聚焦选中节点。 */
async function readableContent(): Promise<void> {
  if (!graph || disposed) return;
  await graph.fitView({ when: 'always' }, false);
  if (!graph || disposed) return;
  const fits = graph.getZoom() >= 1;
  await graph.zoomTo(1, false);
  if (fits) await graph.fitCenter(false);
  else {
    const key = props.selectedKey || focusKey();
    if (key) await graph.focusElement(key, false);
  }
  syncZoom();
}
/** 按默认策略选择全图、单节点聚焦或100%可读布局。 */
async function fitView(): Promise<void> {
  if (props.fit === 'readable') await readableContent();
  else if (props.fit === 'focus') await focusContent();
  else await fitContent();
}
/**
 * 串行刷新图数据，还原可选设计坐标并适配完整路线，兼容全屏和快速配置变化。
 */
async function refresh(): Promise<void> {
  queued = true;
  if (updating || disposed) return;
  updating = true;
  busy.value = true;
  try {
    while (queued && !disposed) {
      queued = false;
      await nextTick();
      const element = container.value;
      if (!element || element.clientWidth < 1 || element.clientHeight < 1) continue;
      if (props.model.issue || !props.model.data.nodes?.length) {
        destroyGraph();
        continue;
      }
      if (!graph) {
        const { Graph: G6Graph } = await import('@antv/g6');
        if (disposed) return;
        graph = new G6Graph({
          container: element,
          width: element.clientWidth,
          height: element.clientHeight,
          padding: 32,
          animation: false,
          zoomRange: [0.15, 2.5],
          data: { nodes: [], edges: [] },
          layout: layoutOptions(),
          behaviors: graphBehaviors(),
          node: {
            type: 'rect',
            style: {
              size: [props.nodeWidth, 88],
              radius: 10,
              lineWidth: 1.4,
              labelPlacement: 'center',
              labelFill: '#263854',
              labelFontSize: 14,
              labelLineHeight: 22,
              labelWordWrap: true,
              labelMaxWidth: props.nodeWidth - 24,
              labelMaxLines: 3,
              cursor: 'pointer',
            },
            state: {
              selected: { stroke: '#235de9', lineWidth: 3, shadowColor: '#235de933', shadowBlur: 12 },
            },
          },
          edge: { type: 'polyline', style: { endArrow: true, endArrowSize: 7, lineWidth: 1.5, radius: 8 } },
        });
        graph.on('node:click', nodeClick);
        graph.on('edge:click', selectEdge);
        graph.on('canvas:click', clearSelection);
        graph.on('aftertransform', syncZoom);
      }
      graph.resize(element.clientWidth, element.clientHeight);
      graph.setOptions({ layout: layoutOptions() });
      graph.setData(clone(props.model.data));
      await graph.render();
      await syncPositions();
      if (disposed) return;
      graph.resize(element.clientWidth, element.clientHeight);
      await fitView();
      errorText.value = '';
    }
  } catch (error) {
    graphError(error);
    destroyGraph();
  } finally {
    updating = false;
    if (!disposed) {
      busy.value = false;
      try {
        await syncSelection();
      } catch (error) {
        graphError(error);
      }
    }
  }
}
/**
 * 按比例放大或缩小当前视图。
 * @param ratio 缩放倍率
 */
async function zoom(ratio: number): Promise<void> {
  if (!graph || updating) return;
  try {
    await graph.zoomBy(ratio, false);
    syncZoom();
  } catch (error) {
    graphError(error);
  }
}
/**
 * 用户主动查看全图时适配全部节点，自动适配仍按可读聚焦策略执行。
 */
async function fit(): Promise<void> {
  if (!graph || updating) return;
  try {
    await fitContent();
  } catch (error) {
    graphError(error);
  }
}
/** 恢复100%可读大小，定位所选节点或路线起点，避免停留在路线中部。 */
async function resetZoom(): Promise<void> {
  if (!graph || updating) return;
  try {
    await graph.zoomTo(1, false);
    const key = props.selectedKey || selected.value || props.model.data.nodes?.[0]?.id;
    if (key) await graph.focusElement(key, false);
    syncZoom();
  } catch (error) {
    graphError(error);
  }
}
/**
 * 切换当前图的横向或纵向分层布局，业务依赖保持原样。
 * @param value 布局方向
 */
function changeDirection(value: GraphDirection): void {
  direction.value = value;
}
/**
 * 按容器尺寸调整画布，填充式设计器保持100%聚焦，隐藏区域显示时再初始化。
 */
function resize(): void {
  const element = container.value;
  if (!element || element.clientWidth < 1 || element.clientHeight < 1 || disposed) return;
  if (graph && !updating) {
    graph.resize(element.clientWidth, element.clientHeight);
    if (props.fill && props.fit !== 'overview') void fitView().catch(graphError);
  } else if (!graph) void refresh().catch(graphError);
}
/** 全屏或高度变化后按默认策略恢复视图，避免设计器自动缩成不可读全图。 */
async function resizeViewport(): Promise<void> {
  await nextTick();
  if (disposed) return;
  resize();
  if (graph && !updating) await fitView();
}
/**
 * 将外部目录选择同步为画布选中，并按需定位到可读节点。
 * @param value 图节点标识
 */
function externalSelection(value: string): void {
  selected.value = value;
  void syncSelection().catch(graphError);
  if (value && props.focusOnSelect && graph && !updating)
    void graph.focusElement(value, false).catch(graphError);
}
/**
 * 初始化尺寸监听与G6懒加载。
 */
function mount(): void {
  if (container.value) {
    observer = new ResizeObserver(resize);
    observer.observe(container.value);
  }
  void refresh().catch(graphError);
}
/**
 * 组件移除时停止回调并释放全部画布资源。
 */
function dispose(): void {
  disposed = true;
  queued = false;
  observer?.disconnect();
  destroyGraph();
}
watch(() => props.model, refresh);
watch(() => props.direction, changeDirection);
watch(direction, refresh);
watch(() => props.height, resizeViewport);
watch(() => props.fill, resizeViewport);
watch(expanded, resizeViewport);
watch(() => props.selectedKey, externalSelection);
watch(() => props.connectMode, syncBehaviors);
watch(() => props.editable, syncBehaviors);
watch(() => props.positions, restorePositions);
onMounted(mount);
onBeforeUnmount(dispose);
</script>
<style scoped>
.business-graph-host {
  min-width: 0;
}
.business-graph-host--fill {
  height: 100%;
  min-height: 0;
}
.business-graph.business-graph--fill {
  height: 100%;
  border: none;
  border-radius: 0;
}
.business-graph {
  border: 1px solid #e2e8f2;
  border-radius: 10px;
  background: #fbfcff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.business-graph--expanded {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  border: none;
  border-radius: 0;
  z-index: 1200;
}
.graph-stage {
  position: relative;
  min-height: 0;
}
.business-graph--expanded .graph-stage,
.business-graph--fill .graph-stage {
  flex: 1;
  overflow: hidden;
}
.business-graph--expanded .graph-stage :deep(.n-spin-content),
.business-graph--fill .graph-stage :deep(.n-spin-content) {
  height: 100%;
}
.business-graph--expanded .graph-canvas,
.business-graph--fill .graph-canvas {
  min-height: 0;
}
.graph-canvas {
  width: 100%;
  min-height: 240px;
  background-image: radial-gradient(#cbd6e7 0.8px, transparent 0.8px);
  background-size: 16px 16px;
  touch-action: none;
}
.graph-empty {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;
}
.graph-legend {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  flex-shrink: 0;
  background: #fff;
  border-top: 1px solid #e7edf6;
  color: #62738d;
  font-size: 13px;
}
.graph-legend span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.graph-legend i {
  width: 8px;
  height: 8px;
  display: inline-block;
  border-radius: 50%;
}
.normal {
  background: #a8bad8;
}
.active {
  background: #3068e9;
}
.success {
  background: #36a87e;
}
.warning {
  background: #d9a02d;
}
.muted {
  background: #bdc5d3;
}
.graph-legend small {
  display: block;
  flex-basis: 100%;
  font-size: 13px;
  line-height: 1.7;
}
@media (max-width: 850px) {
  .graph-legend {
    gap: 10px;
  }
  .graph-canvas {
    min-height: 300px;
  }
}
@media (max-height: 600px) {
  .business-graph--expanded .graph-legend small {
    display: none;
  }
}
</style>
<template>
  <div
    class="business-graph-host"
    :class="{ 'business-graph-host--fill': fill }"
    :style="expanded && placeholderHeight ? { height: placeholderHeight + 'px' } : undefined"
  >
    <Teleport to="body" :disabled="!expanded">
      <section
        ref="root"
        class="business-graph"
        :class="{ 'business-graph--expanded': expanded, 'business-graph--fill': fill }"
        :aria-label="label"
      >
        <slot name="toolbar" :controls="controls"
          ><GraphToolbar
            :label="label"
            :node-count="model.data.nodes?.length || 0"
            :options="options"
            :selected="selected"
            :busy="busy"
            :issue="!!model.issue || !!errorText || !model.data.nodes?.length"
            :zoom="zoomPercent"
            :expanded="expanded"
            :direction="direction"
            @locate="locate"
            @zoom="zoom"
            @fit="fit"
            @reset="resetZoom"
            @expand="toggleExpanded"
            @direction="changeDirection"
        /></slot>
        <NAlert v-if="model.issue || errorText" type="warning" :bordered="false" class="mb"
          >{{ model.issue || errorText }}
          <NButton v-if="errorText" text type="primary" @click="refresh">重新加载图形</NButton></NAlert
        ><NSpin :show="busy" class="graph-stage"
          ><div
            ref="container"
            class="graph-canvas"
            :style="{ height: expanded || fill ? '100%' : height + 'px' }"
            role="img"
            tabindex="0"
            :aria-label="label" />
          <NEmpty
            v-if="!model.data.nodes?.length && !model.issue"
            description="暂无图形节点"
            class="graph-empty"
        /></NSpin>
        <div v-if="!hideFooter" class="graph-legend">
          <span><i class="normal" />待处理 / 配置节点</span><span><i class="active" />办理中</span
          ><span><i class="success" />已完成</span><span><i class="warning" />条件 / 异常</span
          ><span><i class="muted" />跳过 / 失效</span
          ><small
            >拖动平移 · 滚轮或按钮缩放 · 100% 查看清晰节点 · 全屏后按 Esc 退出；点击节点查看业务详情。</small
          >
        </div>
      </section>
    </Teleport>
  </div>
</template>
