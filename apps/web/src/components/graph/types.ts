import type { GraphData } from '@antv/g6'
import type { SelectOption } from 'naive-ui'
export type GraphNodeKind = 'department' | 'member' | 'workflow' | 'runtime' | 'stage'
export type GraphTone = 'normal' | 'active' | 'success' | 'warning' | 'muted' | 'error'
export type GraphDirection = 'TB' | 'LR'
export interface GraphLocateOption extends SelectOption {
  label: string
  value: string
}
export interface GraphToolbarProps {
  label: string
  nodeCount: number
  options: GraphLocateOption[]
  selected: string
  busy: boolean
  issue: boolean
  zoom: number
  expanded: boolean
  direction: GraphDirection
}
export interface BusinessGraphModel {
  data: GraphData
  issue?: string
}
export interface GraphSelection {
  id: string
  graphId: string
  kind: GraphNodeKind
}
export interface BusinessGraphProps {
  appearance?: 'business' | 'organization'
  fill?: boolean
  hideFooter?: boolean
  focusOnSelect?: boolean
  editable?: boolean
  connectMode?: boolean
  positions?: Record<string, { x: number; y: number }>
  model: BusinessGraphModel
  selectedKey?: string
  height?: number
  direction?: GraphDirection
  label?: string
  /** 初始视图：overview 适配全图，focus 聚焦单点，readable 在100%下横向居中并从顶部50px展示；overview全图同样顶部对齐，focus保留指定节点定位 */
  fit?: 'overview' | 'focus' | 'readable'
  /** 节点基准宽度，窄容器可调大以保证文字可读 */
  nodeWidth?: number
}
export interface GraphToolbarControls extends GraphToolbarProps {
  locate: (value: string | null) => void
  zoomBy: (ratio: number) => Promise<void>
  fit: () => Promise<void>
  reset: () => Promise<void>
  changeDirection: (value: GraphDirection) => void
}
export interface GraphToolbarSlot {
  controls: GraphToolbarControls
}
export interface GraphConnection {
  source: string
  target: string
}
export interface WorkflowNodeTheme {
  label: string
  fill: string
  stroke: string
  accent: string
  text: string
}
export interface GraphNodeMeta {
  workflowKind?: import('@workflow/domain').NodeDefinition['kind']
  businessId: string
  kind: GraphNodeKind
  label: string
  summary: string
  tone: GraphTone
}

export interface OrganizationCardMeta extends GraphNodeMeta {
  overview?: boolean
  accent: string
  root: boolean
  caption: string
  metrics: string
  levelLabel: string
  statusLabel: string
  statusColor: string
  statusBackground: string
}

export interface OrganizationChartProps {
  config: import('@workflow/domain').CompanyConfig
  selected: string
}
