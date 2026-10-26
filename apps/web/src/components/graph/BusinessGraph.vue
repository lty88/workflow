<script setup lang="tsx">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { NAlert, NButton, NEmpty, NSpin } from 'naive-ui'
  import type { Graph, GraphOptions, IEvent, NodeData, EdgeData, IElementDragEvent } from '@antv/g6'
  import type { BusinessGraphProps, GraphConnection, GraphDirection, GraphLocateOption, GraphSelection, GraphToolbarControls, GraphToolbarSlot } from './types'
  import { clone } from '@/composables/format'
  import { workflowSelectionStyle } from './workflow-node-theme'
  import { templatePositionKey } from './positioning'
  import { graphEdgeOptions, refreshRoutedEdges } from './edge-routing'
  import GraphToolbar from './GraphToolbar.vue'
  import { useGraphExpansion } from './use-graph-expansion'
  const props = withDefaults(defineProps<BusinessGraphProps>(), {
    appearance: 'business',
    selectedKey: '',
    height: 560,
    direction: 'TB',
    label: '业务关系图',
    fit: 'overview',
    nodeWidth: 240,
  })
  const emit = defineEmits<{
    select: [value: GraphSelection]
    clear: []
    positions: [value: Record<string, { x: number; y: number }>]
    connect: [value: GraphConnection]
    'edge-select': [value: GraphConnection]
  }>()
  defineSlots<{ toolbar?(props: GraphToolbarSlot): unknown }>()
  const root = ref<HTMLElement | null>(null)
  const container = ref<HTMLDivElement | null>(null)
  const { expanded, placeholderHeight, toggleExpanded } = useGraphExpansion(root)
  const direction = ref<GraphDirection>(props.direction)
  const zoomPercent = ref(100)
  const busy = ref(false)
  const errorText = ref('')
  const selected = ref(props.selectedKey)
  let graph: Graph | null = null
  let organizationOverview = false
  let observer: ResizeObserver | null = null
  let disposed = false
  let updating = false
  let queued = false
  const options = computed(() => (props.model.data.nodes || []).map(nodeOption))
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
  }))
  /**
   * 系统起止锚点采用较矮的胶囊卡片，业务节点沿用现有尺寸。
   * @param node 图节点
   * @returns 节点宽高
   */
  function nodeSize(node: NodeData): [number, number] {
    if (props.appearance === 'organization') return [280, 132]
    return [props.nodeWidth, node.data?.boundary ? 64 : 88]
  }
  /**
   * 区分系统边界与可编辑业务节点的圆角。
   * @param node 图节点
   * @returns 圆角半径
   */
  function nodeRadius(node: NodeData): number {
    return node.data?.boundary ? 32 : 10
  }
  /**
   * 转换定位下拉项，键盘用户也能选择画布节点。
   * @param node 图节点
   * @returns 定位选项
   */
  function nodeOption(node: NodeData): GraphLocateOption {
    return { label: String(node.data?.label || node.id), value: node.id }
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
    }
  }
  /**
   * 应用唯一选择状态，业务颜色保持原样。
   */
  async function syncSelection(): Promise<void> {
    if (!graph || disposed || updating) return
    const states: Record<string, string[]> = {}
    for (const node of props.model.data.nodes || []) states[node.id] = node.id === (props.selectedKey || selected.value) ? ['selected'] : []
    await graph.setElementState(states, false)
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
        return item.id === key
      }
    )
    if (!node) return
    selected.value = key
    await syncSelection()
    if (focus && graph && !updating) await graph.focusElement(key, false)
    emit('select', selectionFor(node))
  }
  /**
   * 响应G6节点点击并将异常转换为可见提示。
   * @param event G6指针事件
   */
  function nodeClick(event: IEvent): void {
    if ('targetType' in event && event.targetType === 'node' && event.target && 'id' in event.target && typeof event.target.id === 'string')
      void selectNode(event.target.id).catch(graphError)
  }
  /**
   * 编辑模式允许拖动业务节点和系统起止标记；连线模式及只读图禁止移动。
   * @param event 图节点拖动事件
   * @returns 是否允许拖动
   */
  function canDrag(event: IElementDragEvent): boolean {
    if (!props.editable || props.connectMode || event.targetType !== 'node') return false
    const node = props.model.data.nodes?.find(
      /** 定位实际图节点，避免将其他业务阶段误作为模板边界拖动。
       * @param item 当前图节点
       * @returns 是否匹配拖动对象
       */ function matches(item) {
        return item.id === String(event.target?.id || '')
      }
    )
    return !!node && !!templatePositionKey(node)
  }
  /**
   * 拖动结束后更新所有连线，保存业务节点及系统起止标记位置，保持流程前置关系。
   * @param _ids G6已移动的节点标识
   */
  function positionsChanged(_ids: string[]): void {
    if (!graph || !props.editable) return
    const result: Record<string, { x: number; y: number }> = {}
    for (const node of props.model.data.nodes || []) {
      const key = templatePositionKey(node)
      if (!key) continue
      const point = graph.getElementPosition(node.id)
      result[key] = { x: point[0], y: point[1] }
    }
    void refreshRoutedEdges(graph).catch(graphError)
    emit('positions', result)
  }
  /**
   * 将自由连线转换为受控前置关系请求，实际增边由父组件校验后应用。
   * @param edge G6候选连接
   * @returns 不直接添加边，由受控图数据更新
   */
  function createConnection(edge: EdgeData): undefined {
    if (props.editable && edge.source.startsWith('workflow:') && edge.target.startsWith('workflow:'))
      emit('connect', { source: edge.source.slice(9), target: edge.target.slice(9) })
    return undefined
  }
  /**
   * 选择可编辑连接，供父组件提供删除按钮和键盘替代操作。
   * @param event 图连线点击事件
   */
  function selectEdge(event: IEvent): void {
    if (!graph || !props.editable || !('target' in event) || !event.target || !('id' in event.target)) return
    const edge = graph.getEdgeData(String(event.target.id))
    if (edge.source.startsWith('workflow:') && edge.target.startsWith('workflow:'))
      emit('edge-select', { source: edge.source.slice(9), target: edge.target.slice(9) })
  }
  /**
   * 根据设计器模式配置节点移动和自由连线；普通业务图沿用只读交互。
   * @returns G6交互配置
   */
  function graphBehaviors(): GraphOptions['behaviors'] {
    if (!props.editable) return ['drag-canvas', 'zoom-canvas']
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
    ]
  }
  /** 将切换的编辑模式同步到已创建画布，不重置审批依赖或节点坐标。 */
  function syncBehaviors(): void {
    if (graph && !disposed) graph.setBehaviors(graphBehaviors() || [])
  }
  /** 恢复业务节点与系统起止标记的布局坐标，重新寻路，坐标一致时跳过重复绘制。 */
  async function syncPositions(): Promise<void> {
    if (!graph || props.positions === undefined || disposed) return
    const positions: Record<string, [number, number]> = {}
    for (const node of props.model.data.nodes || []) {
      const key = templatePositionKey(node)
      const value = key ? props.positions[key] : undefined
      if (!value) continue
      const current = graph.getElementPosition(node.id)
      if (current[0] !== value.x || current[1] !== value.y) positions[node.id] = [value.x, value.y]
    }
    if (!Object.keys(positions).length) return
    const instance = graph
    await instance.translateElementTo(positions, false)
    if (!disposed && graph === instance) await refreshRoutedEdges(instance)
  }
  /** 以可见错误处理坐标恢复失败，避免异步监听抛出未处理异常。 */
  function restorePositions(): void {
    void syncPositions().catch(graphError)
  }
  /**
   * 响应定位下拉选择。
   * @param value 图节点标识
   */
  function locate(value: string | null): void {
    if (!value) {
      clearSelection()
      return
    }
    void selectNode(value, true).catch(graphError)
  }
  /**
   * 清除画布选中，并通知外部取消筛选。
   */
  function clearSelection(): void {
    selected.value = ''
    emit('clear')
    void syncSelection().catch(graphError)
  }
  /**
   * 显示图形加载或渲染错误，保留外围业务列表。
   * @param error 图引擎异常
   */
  function graphError(error: unknown): void {
    if (!disposed) errorText.value = error instanceof Error ? error.message : '图形加载失败，请重试'
  }
  /**
   * 销毁旧图实例，释放画布、事件与渲染资源。
   */
  function destroyGraph(): void {
    if (graph) {
      graph.destroy()
      graph = null
    }
  }
  /**
   * 构造统一的分层布局，节点依赖由业务数据提供。
   * @returns G6布局配置
   */
  function layoutOptions(): GraphOptions['layout'] {
    if (props.appearance === 'organization') return { type: 'dagre', rankdir: direction.value, nodesep: 40, ranksep: 88, edgesep: 20 }
    return { type: 'dagre', rankdir: direction.value, nodesep: 32, ranksep: 48, edgesep: 18 }
  }
  /**
   * 组织图使用随布局方向弯曲的三次曲线连接，流程图沿用现有路由。
   * @returns 当前业务场景的连线配置
   */
  function edgeOptions(): GraphOptions['edge'] {
    if (props.appearance === 'organization')
      return {
        type: direction.value === 'LR' ? 'cubic-horizontal' : 'cubic-vertical',
        style: { endArrow: false, lineWidth: 1.2, stroke: '#c3d0e2' },
      }
    return graphEdgeOptions(!!props.editable || props.positions !== undefined)
  }
  /** 将实际缩放同步到工具栏，在跨越阈值时重绘组织卡片细节。 */
  function syncZoom(): void {
    if (!graph || disposed) return
    zoomPercent.value = Math.round(graph.getZoom() * 100)
    const overview = graph.getZoom() < 0.65
    if (props.appearance === 'organization' && !updating && overview !== organizationOverview) {
      organizationOverview = overview
      graph.updateNodeData(graph.getNodeData().map(withOrganizationLevel))
      void graph.draw().catch(graphError)
    }
  }
  /** 写入组织节点的缩放展示级别，使G6能识别需要重绘的节点。
   * @param node 当前节点
   * @returns 带当前缩放级别的节点副本
   */
  function withOrganizationLevel(node: NodeData): NodeData {
    return { ...node, data: { ...node.data, overview: organizationOverview } }
  }
  /** 根据节点渲染边界将整图顶部对齐到画布内50px，仅平移视口，不修改节点保存坐标。 */
  async function alignContentTop(): Promise<void> {
    if (!graph || disposed) return
    let top = Number.POSITIVE_INFINITY
    for (const node of graph.getNodeData()) {
      const bounds = graph.getElementRenderBounds(node.id)
      const point = graph.getViewportByCanvas([bounds.min[0], bounds.min[1]])
      if (Number.isFinite(point[1])) top = Math.min(top, point[1])
    }
    if (Number.isFinite(top) && Math.abs(50 - top) > 0.5) await graph.translateBy([0, 50 - top], false)
  }
  /** 完整适配当前容器并在顶部留50px，限制自动放大到100%，保持少量节点尺寸清晰稳定。 */
  async function fitContent(): Promise<void> {
    if (!graph || disposed) return
    await graph.fitView({ when: 'always' }, false)
    if (disposed || !graph) return
    if (graph.getZoom() > 1) {
      await graph.zoomTo(1, false)
      await graph.fitCenter(false)
    }
    await alignContentTop()
    syncZoom()
  }
  /**
   * 选取初始聚焦节点：办理中节点优先，其次已选节点，最后回退到首个节点。
   * @returns 图节点标识
   */
  function focusKey(): string {
    if (selected.value) return selected.value
    const nodes = props.model.data.nodes || []
    const active = nodes.find((node) => node.data?.tone === 'active')
    return String(active?.id || nodes[0]?.id || '')
  }
  /** 窄容器聚焦模式：保持 100% 清晰缩放并定位办理中节点，路线全貌交给适配或全屏按钮。 */
  async function focusContent(): Promise<void> {
    if (!graph || disposed) return
    await graph.zoomTo(1, false)
    const key = props.selectedKey || selected.value || focusKey()
    if (key && !disposed) await graph.focusElement(key, false)
    else await graph.fitCenter(false)
    syncZoom()
  }
  /** 可读模式保持100%和横向居中，整条流程从画布顶部50px开始展示，长流程可向下拖动浏览。 */
  async function readableContent(): Promise<void> {
    if (!graph || disposed) return
    await graph.zoomTo(1, false)
    if (!graph || disposed) return
    await graph.fitCenter(false)
    await alignContentTop()
    syncZoom()
  }
  /** 按默认策略选择全图、单节点聚焦或100%可读布局。 */
  async function fitView(): Promise<void> {
    if (props.fit === 'readable') await readableContent()
    else if (props.fit === 'focus') await focusContent()
    else await fitContent()
  }
  /**
   * 串行刷新图数据，还原可选设计坐标并适配完整路线，兼容全屏和快速配置变化。
   */
  async function refresh(): Promise<void> {
    queued = true
    if (updating || disposed) return
    updating = true
    busy.value = true
    try {
      while (queued && !disposed) {
        queued = false
        await nextTick()
        const element = container.value
        if (!element || element.clientWidth < 1 || element.clientHeight < 1) continue
        if (props.model.issue || !props.model.data.nodes?.length) {
          destroyGraph()
          continue
        }
        if (!graph) {
          const { Graph: G6Graph } = await import('@antv/g6')
          if (disposed) return
          const nodeType = props.appearance === 'organization' ? (await import('./organization-card')).registerOrganizationCard() : 'rect'
          if (disposed) return
          graph = new G6Graph({
            container: element,
            width: element.clientWidth,
            height: element.clientHeight,
            padding: [50, 32, 32, 32],
            background: 'transparent',
            animation: false,
            zoomRange: [0.15, 2.5],
            data: { nodes: [], edges: [] },
            layout: layoutOptions(),
            behaviors: graphBehaviors(),
            node: {
              type: nodeType,
              style: {
                size: nodeSize,
                radius: nodeRadius,
                lineWidth: 1.4,
                labelPlacement: 'center',
                labelFill: '#263854',
                labelFontSize: 14,
                labelLineHeight: 22,
                labelWordWrap: true,
                labelMaxWidth: props.nodeWidth - 24,
                labelMaxLines: 3,
                cursor: 'pointer',
                ...(props.appearance === 'organization' ? { shadowBlur: 12, shadowColor: '#24456b12', shadowOffsetY: 3, lineWidth: 1 } : {}),
              },
              state: {
                selected: workflowSelectionStyle,
              },
            },
            edge: edgeOptions(),
          })
          graph.on('node:click', nodeClick)
          graph.on('edge:click', selectEdge)
          graph.on('canvas:click', clearSelection)
          graph.on('aftertransform', syncZoom)
        }
        graph.resize(element.clientWidth, element.clientHeight)
        graph.setOptions({
          layout: layoutOptions(),
          edge: edgeOptions(),
        })
        organizationOverview = false
        graph.setData(clone(props.model.data))
        await graph.render()
        await syncPositions()
        if (disposed) return
        graph.resize(element.clientWidth, element.clientHeight)
        await fitView()
        errorText.value = ''
      }
    } catch (error) {
      graphError(error)
      destroyGraph()
    } finally {
      updating = false
      if (!disposed) {
        busy.value = false
        syncZoom()
        try {
          await syncSelection()
        } catch (error) {
          graphError(error)
        }
      }
    }
  }
  /**
   * 按比例放大或缩小当前视图。
   * @param ratio 缩放倍率
   */
  async function zoom(ratio: number): Promise<void> {
    if (!graph || updating) return
    try {
      await graph.zoomBy(ratio, false)
      syncZoom()
    } catch (error) {
      graphError(error)
    }
  }
  /**
   * 用户主动查看全图时适配全部节点，自动适配仍按可读聚焦策略执行。
   */
  async function fit(): Promise<void> {
    if (!graph || updating) return
    try {
      await fitContent()
    } catch (error) {
      graphError(error)
    }
  }
  /** 恢复100%可读大小，定位所选节点或路线起点，避免停留在路线中部。 */
  async function resetZoom(): Promise<void> {
    if (!graph || updating) return
    try {
      await graph.zoomTo(1, false)
      const key = props.selectedKey || selected.value || props.model.data.nodes?.[0]?.id
      if (key) await graph.focusElement(key, false)
      syncZoom()
    } catch (error) {
      graphError(error)
    }
  }
  /**
   * 切换当前图的横向或纵向分层布局，业务依赖保持原样。
   * @param value 布局方向
   */
  function changeDirection(value: GraphDirection): void {
    direction.value = value
  }
  /**
   * 按容器尺寸调整画布，填充式设计器保持100%聚焦，隐藏区域显示时再初始化。
   */
  function resize(): void {
    const element = container.value
    if (!element || element.clientWidth < 1 || element.clientHeight < 1 || disposed) return
    if (graph && !updating) {
      graph.resize(element.clientWidth, element.clientHeight)
      if (props.fill && props.fit !== 'overview') void fitView().catch(graphError)
    } else if (!graph) void refresh().catch(graphError)
  }
  /** 全屏或高度变化后按默认策略恢复视图，避免设计器自动缩成不可读全图。 */
  async function resizeViewport(): Promise<void> {
    await nextTick()
    if (disposed) return
    resize()
    if (graph && !updating) await fitView()
  }
  /**
   * 将外部目录选择同步为画布选中，并按需定位到可读节点。
   * @param value 图节点标识
   */
  function externalSelection(value: string): void {
    selected.value = value
    void syncSelection().catch(graphError)
    if (value && props.focusOnSelect && graph && !updating) void graph.focusElement(value, false).catch(graphError)
  }
  /**
   * 初始化尺寸监听与G6懒加载。
   */
  function mount(): void {
    if (container.value) {
      observer = new ResizeObserver(resize)
      observer.observe(container.value)
    }
    void refresh().catch(graphError)
  }
  /**
   * 组件移除时停止回调并释放全部画布资源。
   */
  function dispose(): void {
    disposed = true
    queued = false
    observer?.disconnect()
    destroyGraph()
  }
  watch(() => props.model, refresh)
  watch(() => props.direction, changeDirection)
  watch(direction, refresh)
  watch(() => props.height, resizeViewport)
  watch(() => props.fill, resizeViewport)
  watch(expanded, resizeViewport)
  watch(() => props.selectedKey, externalSelection)
  watch(() => props.connectMode, syncBehaviors)
  watch(() => props.editable, syncBehaviors)
  watch(() => props.positions, restorePositions)
  onMounted(mount)
  onBeforeUnmount(dispose)
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
    background-color: #f8faff;
    background-image: radial-gradient(circle, #bfcde3 1px, transparent 1px);
    background-size: 20px 20px;
    background-position: 0 0;
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
  .error {
    background: #dc4c5b;
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
        :class="{ 'business-graph--expanded': expanded, 'business-graph--fill': fill, 'business-graph--organization': appearance === 'organization' }"
        :aria-label="label"
      >
        <slot name="toolbar" :controls="controls">
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
        </slot>
        <NAlert v-if="model.issue || errorText" type="warning" :bordered="false" class="mb">
          {{ model.issue || errorText }}
          <NButton v-if="errorText" text type="primary" @click="refresh">重新加载图形</NButton>
        </NAlert>
        <NSpin :show="busy" class="graph-stage">
          <div
            ref="container"
            class="graph-canvas"
            :style="{ height: expanded || fill ? '100%' : height + 'px' }"
            role="img"
            tabindex="0"
            :aria-label="label"
          />
          <NEmpty v-if="!model.data.nodes?.length && !model.issue" description="暂无图形节点" class="graph-empty" />
        </NSpin>
        <div v-if="!hideFooter && appearance === 'organization'" class="graph-legend org-legend">
          <span>
            <i class="success" />
            正常
          </span>
          <span>
            <i class="warning" />
            负责人待配置
          </span>
          <span>
            <i class="muted" />
            部门或上级停用
          </span>
          <small>相同颜色表示同一组织分支 · 缩小看层级，放大看负责人和直属人数 · 点击部门筛选成员</small>
        </div>
        <div v-else-if="!hideFooter" class="graph-legend">
          <span>
            <i class="normal" />
            待处理 / 配置节点
          </span>
          <span>
            <i class="active" />
            办理中
          </span>
          <span>
            <i class="success" />
            已完成
          </span>
          <span>
            <i class="error" />
            退回 / 拒绝
          </span>
          <span>
            <i class="warning" />
            条件 / 异常
          </span>
          <span>
            <i class="muted" />
            跳过 / 失效
          </span>
          <small>拖动平移 · 滚轮或按钮缩放 · 100% 查看清晰节点 · 全屏后按 Esc 退出；点击节点查看业务详情。</small>
        </div>
      </section>
    </Teleport>
  </div>
</template>
