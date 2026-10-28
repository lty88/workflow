import type { EdgeData, NodeData } from '@antv/g6'
import { ACTIVITY_SUBPROCESS, lifecycleOf, activitySubprocessPosition } from '@workflow/domain'
import type { ActivityStatus, LifecycleDefinition } from '@workflow/domain'

/** 从已注册的接续方案生成完整生命周期尾部，普通申请只追加真正的结束节点。
 * @param nodes 已有画布节点
 * @param edges 已有连线
 * @param from 审批段出口
 * @param lifecycle 模板冻结的生命周期配置
 * @param status 可选的运行状态，旧活动由存储兼容层状态映射
 * @param owners 可选的阶段责任人说明
 */
export function appendLifecycleGraph(
  nodes: NodeData[],
  edges: EdgeData[],
  from: string,
  lifecycle?: LifecycleDefinition,
  status?: ActivityStatus,
  owners: Record<string, string> = {}
): void {
  const profile = lifecycleOf({ lifecycle })
  let previous = from
  const finished = status === 'completed' || status === 'archived'
  const phase = activitySubprocessPosition(status)
  if (profile.afterApproval === 'activity_standard')
    for (let index = 0; index < ACTIVITY_SUBPROCESS.length; index++) {
      const stage = ACTIVITY_SUBPROCESS[index]!
      const done = finished || (phase >= 0 && index < phase)
      const active = phase === index
      const id = 'stage:business:' + stage.key
      const summary = owners[stage.key] || (stage.key === 'assign' || stage.key === 'archive_review' ? '最后审批人' : '执行人')
      const label = `${stage.label}\n${active ? '当前业务阶段 · ' : done ? '已完成 · ' : ''}${summary}`
      nodes.push({
        id,
        data: { kind: 'stage', boundary: true, businessId: id, label: stage.label, summary, tone: done ? 'success' : active ? 'active' : 'normal' },
        style: { labelText: label, fill: done ? '#effaf5' : active ? '#edf4ff' : '#fff', stroke: done ? '#36a87e' : active ? '#3068e9' : '#b6c8e9' },
      })
      edges.push({ id: `${previous}:${id}`, source: previous, target: id, style: { stroke: '#9aadc9' } })
      previous = id
    }
  appendCaseEnd(nodes, edges, previous, finished)
}

/** 追加真正的整单结束标记，审批完成与业务完成在图上明确分开。
 * @param nodes 已有节点
 * @param edges 已有连线
 * @param from 最后业务节点或审批出口
 * @param finished 是否整单办结
 */
export function appendCaseEnd(nodes: NodeData[], edges: EdgeData[], from: string, finished: boolean): void {
  const id = 'stage:case-end'
  nodes.push({
    id,
    data: {
      kind: 'stage',
      boundary: true,
      businessId: id,
      label: '结束 · 整单办结',
      summary: finished ? '全部办理完成，记录已留存' : '等待全部办理完成',
      tone: finished ? 'success' : 'normal',
    },
    style: { labelText: '结束 · 整单办结', fill: finished ? '#effaf5' : '#eef4fb', stroke: finished ? '#36a87e' : '#c2d2e7' },
  })
  edges.push({ id: `${from}:${id}`, source: from, target: id, style: { stroke: '#9aadc9' } })
}
