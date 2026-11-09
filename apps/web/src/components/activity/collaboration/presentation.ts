import { topological } from '@workflow/domain'
import type { WorkflowNode } from '@workflow/domain'
import type { WorkflowViewDetail } from '@/components/activity/types'
import type { CollaborationProgressState } from './types'

/** 获取所属审批节点的协作子节点，默认按当前申请及父审批轮次展示。
 * @param detail 流程详情
 * @param parentNodeId 所属主审批节点
 * @param includeHistory 是否包含旧申请或旧审批轮次
 * @returns 按依赖顺序排列的协作节点
 */
export function collaborationNodes(detail: WorkflowViewDetail, parentNodeId: string, includeHistory = false): WorkflowNode[] {
  const parent = detail.activity.nodes.find(
    /** 查找所属主审批。
     * @param node 实例节点
     * @returns 是否父审批
     */ function belongs(node) {
      return node.id === parentNodeId
    }
  )
  if (!parent) return []
  const nodes: WorkflowNode[] = []
  for (const node of detail.activity.nodes) {
    const data = node.collaboration
    if (!data || data.parentNodeId !== parentNodeId) continue
    if (!includeHistory && ((node.applicationRevision || 1) !== (detail.activity.revision || 1) || data.parentGeneration !== parent.generation)) continue
    nodes.push(node)
  }
  const ordered = topological(nodes)
  return ordered.error ? nodes : ordered.order
}

/** 区分成果办理、待验收、返工与关闭，避免把提交成果误显示为已经验收。
 * @param node 协作节点
 * @returns 中文状态及标签色调
 */
export function collaborationProgressState(node: WorkflowNode): CollaborationProgressState {
  const data = node.collaboration
  if (!data || data.state === 'cancelled') return { label: '已关闭', tone: 'default' }
  if (data.state === 'accepted') return { label: '已验收', tone: 'success' }
  if (data.state === 'submitted') return { label: '待验收', tone: 'warning' }
  if (node.status === 'waiting') return { label: '等待前序验收', tone: 'default' }
  return { label: node.generation > 1 ? '补充中' : '办理中', tone: 'info' }
}
