import type { NodeData } from '@antv/g6'
import type { NodeDefinition } from '@workflow/domain'
import type { WorkflowNodeTheme } from './types'

export const WORKFLOW_NODE_THEMES: Record<NodeDefinition['kind'], WorkflowNodeTheme> = {
  approval: { label: '审批', fill: '#edf2ff', stroke: '#8ba7ec', accent: '#3e66d8', text: '#304d8e' },
  task: { label: '任务', fill: '#eaf7f1', stroke: '#79bda4', accent: '#228565', text: '#235f4c' },
  notice: { label: '知会', fill: '#fff5df', stroke: '#d5ad62', accent: '#a9761c', text: '#77551d' },
}

/** 选中节点时保留业务类型或退回拒绝的强调色，边框加粗后仍能辨识。
 * @param node 当前图节点
 * @returns G6选中态的边框及阴影，其他业务图保留通用选择色
 */
export function workflowSelectionStyle(node: NodeData): { stroke: string; lineWidth: number; shadowColor: string; shadowBlur: number } {
  const kind = node.data?.kind === 'workflow' ? node.data.workflowKind : undefined
  const accent =
    node.data?.tone === 'error' ? '#dc4c5b' : kind === 'approval' || kind === 'task' || kind === 'notice' ? WORKFLOW_NODE_THEMES[kind].accent : '#235de9'
  return { stroke: accent, lineWidth: 3, shadowColor: accent + '33', shadowBlur: 12 }
}
