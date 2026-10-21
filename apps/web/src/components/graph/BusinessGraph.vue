<script setup lang="tsx">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NAlert, NButton, NEmpty, NSelect, NSpin } from 'naive-ui';
import type { Graph, GraphOptions, IEvent, NodeData } from '@antv/g6';
import type { BusinessGraphProps, GraphSelection } from './types';
import { clone } from '../../composables/format';
const props = withDefaults(defineProps<BusinessGraphProps>(), {
  selectedKey: '',
  height: 440,
  direction: 'TB',
  label: '业务关系图',
});
const emit = defineEmits<{ select: [value: GraphSelection]; clear: [] }>();
const container = ref<HTMLDivElement | null>(null);
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
function nodeOption(node: NodeData): { label: string; value: string } {
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
  return { type: 'dagre', rankdir: props.direction, nodesep: 30, ranksep: 58, edgesep: 18 };
}
/**
 * 串行刷新最新图数据，合并快速配置变化并按容器实际尺寸初始化。
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
      if (!element || element.clientWidth < 1) continue;
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
          height: props.height,
          padding: 32,
          animation: false,
          autoFit: { type: 'view', options: { when: 'overflow' }, animation: false },
          zoomRange: [0.15, 2.5],
          data: { nodes: [], edges: [] },
          layout: layoutOptions(),
          behaviors: ['drag-canvas', 'zoom-canvas'],
          node: {
            type: 'rect',
            style: {
              size: [204, 76],
              radius: 10,
              lineWidth: 1.4,
              labelPlacement: 'center',
              labelFill: '#263854',
              labelFontSize: 12,
              labelLineHeight: 21,
              labelWordWrap: true,
              labelMaxWidth: 180,
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
      }
      graph.resize(element.clientWidth, props.height);
      graph.setOptions({ layout: layoutOptions() });
      graph.setData(clone(props.model.data));
      await graph.render();
      if (disposed) return;
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
  } catch (error) {
    graphError(error);
  }
}
/**
 * 将全部节点重新放入画布可见区域。
 */
async function fit(): Promise<void> {
  if (!graph || updating) return;
  try {
    await graph.fitView({ when: 'always' }, false);
  } catch (error) {
    graphError(error);
  }
}
/**
 * 容器大小变化时调整画布；隐藏标签首次变为可见时再初始化。
 */
function resize(): void {
  const element = container.value;
  if (!element || element.clientWidth < 1 || disposed) return;
  if (graph && !updating) graph.resize(element.clientWidth, props.height);
  else if (!graph) void refresh().catch(graphError);
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
watch(() => props.direction, refresh);
watch(() => props.height, resize);
watch(() => props.selectedKey, externalSelection);
onMounted(mount);
onBeforeUnmount(dispose);
</script>
<style scoped>
.business-graph {
  border: 1px solid #e2e8f2;
  border-radius: 10px;
  background: #fbfcff;
  overflow: hidden;
}
.graph-toolbar {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e7edf6;
  background: #fff;
  flex-wrap: wrap;
}
.graph-search {
  width: 230px;
  max-width: 100%;
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
  background: #fff;
  border-top: 1px solid #e7edf6;
  color: #7e8ba2;
  font-size: 11px;
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
  font-size: 11px;
  line-height: 1.7;
}
@media (max-width: 850px) {
  .graph-toolbar {
    padding: 10px;
    gap: 10px;
  }
  .graph-search {
    width: 100%;
  }
  .graph-legend {
    gap: 10px;
  }
  .graph-canvas {
    min-height: 300px;
  }
}
</style>
<template>
  <section class="business-graph" :aria-label="label">
    <div class="graph-toolbar">
      <NSelect
        :value="selected || null"
        :options="options"
        filterable
        clearable
        placeholder="查找并定位节点"
        class="graph-search"
        :disabled="busy || !!model.issue"
        @update:value="locate"
      />
      <div class="gap">
        <NButton size="small" aria-label="放大图形" :disabled="busy" @click="zoom(1.2)">＋</NButton
        ><NButton size="small" aria-label="缩小图形" :disabled="busy" @click="zoom(0.8)">−</NButton
        ><NButton size="small" :disabled="busy" @click="fit">适应画布</NButton>
      </div>
    </div>
    <NAlert v-if="model.issue || errorText" type="warning" :bordered="false" class="mb"
      >{{ model.issue || errorText }}
      <NButton v-if="errorText" text type="primary" @click="refresh">重新加载图形</NButton></NAlert
    ><NSpin :show="busy"
      ><div
        ref="container"
        class="graph-canvas"
        :style="{ height: height + 'px' }"
        role="img"
        :aria-label="label" />
      <NEmpty v-if="!model.data.nodes?.length && !model.issue" description="暂无图形节点" class="graph-empty"
    /></NSpin>
    <div class="graph-legend">
      <span><i class="normal" />待处理 / 配置节点</span><span><i class="active" />办理中</span
      ><span><i class="success" />已完成</span><span><i class="warning" />条件 / 异常</span
      ><span><i class="muted" />跳过 / 失效</span
      ><small>拖动画布平移，滚轮或按钮缩放；点击节点查看业务详情。</small>
    </div>
  </section>
</template>
