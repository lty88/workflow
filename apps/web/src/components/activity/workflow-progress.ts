import type { WorkflowNode, WorkflowTask } from '@workflow/domain'
import type { NodeProgressStatus } from './types'

/** 从本节点本轮的实际审批结果还原展示状态，区分驳回源头与因终止而失效的其他节点。
 * @param node 流程实例节点
 * @param tasks 已授权的个人任务及历史结果
 * @returns 用于步骤条和流程图的状态，不修改服务端业务状态
 */
export function nodeProgressStatus(node: WorkflowNode, tasks: WorkflowTask[]): NodeProgressStatus {
  if (node.status !== 'invalidated') return node.status
  let result: NodeProgressStatus = node.status
  let latest = ''
  for (const task of tasks) {
    if (task.nodeId !== node.id || task.generation !== node.generation) continue
    if ((task.status === 'returned' || task.status === 'rejected') && (task.actedAt || '') >= latest) {
      result = task.status
      latest = task.actedAt || ''
    }
  }
  return result
}
