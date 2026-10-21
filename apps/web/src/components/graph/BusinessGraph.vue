<script setup lang="tsx">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NAlert, NButton, NEmpty, NSpin } from 'naive-ui';
import type { Graph, GraphOptions, IEvent, NodeData } from '@antv/g6';
import type { BusinessGraphProps, GraphDirection, GraphLocateOption, GraphSelection } from './types';
import { clone } from '../../composables/format';
import GraphToolbar from './GraphToolbar.vue';
import { useGraphExpansion } from './use-graph-expansion';
const props = withDefaults(defineProps<BusinessGraphProps>(), {
  selectedKey: '',
  height: 560,
  direction: 'TB',
  label: '业务关系图',
});
const emit = defineEmits<{ select: [value: GraphSelection]; clear: [] }>();
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
 * 串行刷新图数据，按实际容器宽高布局并适配完整路线，兼容全屏和快速配置变化。
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
          behaviors: ['drag-canvas', 'zoom-canvas'],
          node: {
            type: 'rect',
            style: {
              size: [240, 88],
              radius: 10,
              lineWidth: 1.4,
              labelPlacement: 'center',
              labelFill: '#263854',
              labelFontSize: 14,
              labelLineHeight: 22,
              labelWordWrap: true,
              labelMaxWidth: 216,
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
        graph.on('canvas:click', clearSelection);
        graph.on('aftertransform', syncZoom);
      }
      graph.resize(element.clientWidth, element.clientHeight);
      graph.setOptions({ layout: layoutOptions() });
      graph.setData(clone(props.model.data));
      await graph.render();
      if (disposed) return;
      graph.resize(element.clientWidth, element.clientHeight);
      await fitContent();
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
 * 手动重新适配完整路线，自动放大上限为100%。
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
 * 按实际容器宽高调整画布；隐藏区域首次变为可见时再初始化。
 */
function resize(): void {
  const element = container.value;
  if (!element || element.clientWidth < 1 || element.clientHeight < 1 || disposed) return;
  if (graph && !updating) graph.resize(element.clientWidth, element.clientHeight);
  else if (!graph) void refresh().catch(graphError);
}
/** 等待全屏或高度变化完成DOM更新，再调整画布并重新适配路线。 */
async function resizeViewport(): Promise<void> {
  await nextTick();
  if (disposed) return;
  resize();
  await fit();
}
/**
 * 将外部列表选择同步为画布选中。
 * @param value 图节点标识
 */
function externalSelection(value: string): void {
  selected.value = value;
  void syncSelection().catch(graphError);
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
watch(expanded, resizeViewport);
watch(() => props.selectedKey, externalSelection);
onMounted(mount);
onBeforeUnmount(dispose);
</script>
<style scoped>
.business-graph-host {
  min-width: 0;
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
.business-graph--expanded .graph-stage {
  flex: 1;
  overflow: hidden;
}
.business-graph--expanded .graph-stage :deep(.n-spin-content) {
  height: 100%;
}
.business-graph--expanded .graph-canvas {
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
    :style="expanded && placeholderHeight ? { height: placeholderHeight + 'px' } : undefined"
  >
    <Teleport to="body" :disabled="!expanded">
      <section
        ref="root"
        class="business-graph"
        :class="{ 'business-graph--expanded': expanded }"
        :aria-label="label"
      >
        <GraphToolbar
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
        />
        <NAlert v-if="model.issue || errorText" type="warning" :bordered="false" class="mb"
          >{{ model.issue || errorText }}
          <NButton v-if="errorText" text type="primary" @click="refresh">重新加载图形</NButton></NAlert
        ><NSpin :show="busy" class="graph-stage"
          ><div
            ref="container"
            class="graph-canvas"
            :style="{ height: expanded ? '100%' : height + 'px' }"
            role="img"
            tabindex="0"
            :aria-label="label" />
          <NEmpty
            v-if="!model.data.nodes?.length && !model.issue"
            description="暂无图形节点"
            class="graph-empty"
        /></NSpin>
        <div class="graph-legend">
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
