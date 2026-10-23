import type { NodeData } from '@antv/g6'
import { TEMPLATE_BOUNDARY_IDS } from '@workflow/domain'

/** 获取模板画布可拖动节点的稳定坐标键，系统起止标记仅允许移动布局。
 * @param node 图中的节点
 * @returns 业务节点ID或系统边界ID；其他展示节点返回空字符串
 */
export function templatePositionKey(node: NodeData): string {
  if (node.data?.kind === 'workflow') return String(node.data.businessId || '')
  if (node.data?.kind === 'stage' && node.data.boundary === true && TEMPLATE_BOUNDARY_IDS.includes(node.id)) return node.id
  return ''
}
