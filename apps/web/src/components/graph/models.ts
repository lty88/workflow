import { WORKFLOW_NODE_THEMES } from './workflow-node-theme'
import type { EdgeData, NodeData } from '@antv/g6'
import { activeMember, findById, topological, STATUSES } from '@workflow/domain'
import type { ActivityStatus, CompanyConfig } from '@workflow/domain'
import type { WorkflowViewDetail } from '@/components/activity/types'
import { nodeProgressStatus } from '@/components/activity/workflow-progress'
import { NODE_STATUSES } from '@/components/activity/types'
import type { BusinessGraphModel, GraphNodeMeta, GraphTone, OrganizationCardMeta } from './types'

const colors: Record<GraphTone, { fill: string; stroke: string }> = {
  normal: { fill: '#ffffff', stroke: '#b6c8e9' },
  active: { fill: '#edf4ff', stroke: '#3068e9' },
  success: { fill: '#effaf5', stroke: '#36a87e' },
  warning: { fill: '#fff8e9', stroke: '#d9a02d' },
  muted: { fill: '#f1f3f7', stroke: '#bdc5d3' },
  error: { fill: '#fff1f2', stroke: '#dc4c5b' },
}
const stages = [
  { id: 'assign', name: '指派执行人', statuses: ['ready_assign'] },
  { id: 'execute', name: '活动执行与汇报', statuses: ['ready_execute', 'executing'] },
  { id: 'archive', name: '成果提交与归档', statuses: ['archive_draft', 'archive_review'] },
  { id: 'finish', name: '已归档', statuses: ['archived'] },
]

/**
 * 判断部门与所有上级是否启用，用于和服务端权限一致的组织图展示。
 * @param config 公司配置
 * @param id 部门标识
 * @returns 部门是否有效
 */
function departmentEnabled(config: CompanyConfig, id: string): boolean {
  const seen = new Set<string>()
  let current = id
  while (current) {
    if (seen.has(current)) return false
    seen.add(current)
    const dept = findById(config.departments, current)
    if (!dept?.active) return false
    current = dept.parent
  }
  return true
}
/**
 * 把条件字段键转换成业务名称，避免在流程图中暴露配置键。
 * @param config 公司配置
 * @param key 字段键
 * @returns 字段显示名
 */
function fieldLabel(config: CompanyConfig, key: string): string {
  for (const field of config.form.fields) if (field.key === key) return field.label
  return '待配置字段'
}

/**
 * 生成G6业务节点，模板按审批、任务、知会配色，办理进度图继续按状态配色。
 * @param id 图节点唯一标识
 * @param meta 业务元数据
 * @returns 带节点类型或办理状态样式的G6节点
 */
function visualNode(id: string, meta: GraphNodeMeta): NodeData {
  const theme = meta.kind === 'workflow' && meta.workflowKind ? WORKFLOW_NODE_THEMES[meta.workflowKind] : undefined
  return {
    id,
    data: { ...meta },
    style: {
      ...colors[meta.tone],
      ...(theme ? { fill: theme.fill, stroke: theme.stroke, labelFill: theme.text } : {}),
      labelText: `${meta.label}\n${meta.summary}`,
      lineDash: meta.tone === 'muted' || (theme && meta.tone === 'warning') ? [5, 3] : undefined,
    },
  }
}

/**
 * 生成有向连接，唯一边标识不依赖数组位置。
 * @param source 起点
 * @param target 终点
 * @param dashed 是否弱依赖
 * @returns G6边
 */
function edge(source: string, target: string, dashed = false): EdgeData {
  return {
    id: 'edge:' + JSON.stringify([source, target]),
    source,
    target,
    style: { lineDash: dashed ? [5, 4] : undefined, stroke: dashed ? '#b8c0cf' : '#9aadc9' },
  }
}

/**
 * 把公司部门和可选成员转换为G6组织层级图，发现组织循环时阻止错误布局。
 * @param config 当前组织主数据
 * @param includeMembers 是否展示在职成员节点
 * @param maxDepth 展示的最大部门层级，0表示全部
 * @returns 组织架构图数据
 */
export function organizationGraph(config: CompanyConfig, includeMembers = false, maxDepth = 0): BusinessGraphModel {
  const checked = topological(
    config.departments.map(
      /**
       * 将部门父子关系转换为可校验依赖。
       * @param dept 部门
       * @returns 校验节点
       */ function dependency(dept) {
        return { id: dept.id, deps: dept.parent ? [dept.parent] : [] }
      }
    )
  )
  if (checked.error) return { data: { nodes: [], edges: [] }, issue: '组织层级存在循环或缺失上级，请先修正部门配置。' }
  const nodes: NodeData[] = []
  const edges: EdgeData[] = []
  const palette = ['#3568d4', '#118b88', '#8760c9', '#c6812e', '#408b63', '#b45d82', '#3e80ac']
  const branches = config.departments.filter(
    /** 找出公司根节点下的直接分支，用稳定标识统一子树颜色。
     * @param dept 部门
     * @returns 是否直属根部门
     */ function branch(dept) {
      return !!dept.parent && !findById(config.departments, dept.parent)?.parent
    }
  )
  for (const dept of config.departments) {
    let current = dept
    let depth = 1
    let branch = dept
    while (current.parent) {
      const parent = findById(config.departments, current.parent)!
      if (!parent.parent) branch = current
      current = parent
      depth++
    }
    if (maxDepth && depth > maxDepth) continue
    const branchIndex = branches.findIndex(
      /** 定位当前部门所属分支。
       * @param item 一级分支
       * @returns 是否匹配
       */ function match(item) {
        return item.id === branch.id
      }
    )
    const accent = !dept.parent ? '#3158a4' : palette[Math.max(0, branchIndex) % palette.length]!
    let count = 0
    for (const user of config.users) if (user.department === dept.id && activeMember(config, user.id)) count += 1
    const manager = findById(config.users, dept.manager)?.name || '待设置'
    const enabled = departmentEnabled(config, dept.id)
    const card = visualNode('dept:' + dept.id, {
      businessId: dept.id,
      kind: 'department',
      label: dept.name,
      summary: `${enabled ? '负责人：' + manager : dept.active ? '上级部门已停用' : '部门已停用'} · ${count}人`,
      tone: enabled ? 'normal' : 'muted',
    })
    let children = 0
    for (const child of config.departments) if (child.parent === dept.id) children++
    const configured = !!dept.manager && activeMember(config, dept.manager)
    card.data = {
      ...card.data,
      accent: enabled ? accent : '#8995a7',
      root: !dept.parent,
      caption: enabled ? `负责人  ${manager}` : dept.active ? '上级部门已停用' : '部门已停用',
      metrics: `直属 ${count} 人  ·  下级 ${children} 个`,
      levelLabel: `${depth}级部门`,
      statusLabel: !enabled ? '停用' : configured ? '正常' : '待配置',
      statusColor: !enabled ? '#718096' : configured ? '#218567' : '#a77218',
      statusBackground: !enabled ? '#eef1f5' : configured ? '#eaf7f0' : '#fff5df',
    } satisfies Partial<OrganizationCardMeta>
    card.style = { stroke: enabled ? '#d8e2ef' : '#cbd3df', lineDash: enabled ? undefined : [5, 3] }
    nodes.push(card)
    if (dept.parent) {
      const link = edge('dept:' + dept.parent, 'dept:' + dept.id)
      link.style = { ...link.style, stroke: '#c3d0e2', lineWidth: 1.2 }
      edges.push(link)
    }
  }
  if (includeMembers)
    for (const user of config.users) {
      if (
        !nodes.some(
          /** 仅为当前可见部门连接成员节点。
           * @param node 可见部门节点
           * @returns 是否为成员所属部门
           */ function containsDepartment(node) {
            return node.id === 'dept:' + user.department
          }
        )
      )
        continue
      const card = visualNode('member:' + user.id, {
        businessId: user.id,
        kind: 'member',
        label: user.name,
        summary: activeMember(config, user.id)
          ? user.id === findById(config.departments, user.department)?.manager
            ? '部门负责人'
            : '成员'
          : '成员或所属部门已停用',
        tone: activeMember(config, user.id) ? 'normal' : 'muted',
      })
      const department = findById(config.departments, user.department)
      const enabled = activeMember(config, user.id)
      card.data = {
        ...card.data,
        accent: enabled ? '#647fa7' : '#8995a7',
        root: false,
        caption: `账号  ${user.username}`,
        metrics: user.id === department?.manager ? '部门负责人' : '在职成员',
        levelLabel: '成员',
        statusLabel: enabled ? '启用' : '停用',
        statusColor: enabled ? '#218567' : '#718096',
        statusBackground: enabled ? '#eaf7f0' : '#eef1f5',
      } satisfies Partial<OrganizationCardMeta>
      card.style = { stroke: '#d8e2ef' }
      nodes.push(card)
      edges.push(edge('dept:' + user.department, 'member:' + user.id, true))
    }
  return { data: { nodes, edges } }
}

/**
 * 将活动模板转换为有向依赖图，明确并行、条件、知会非阻断和后续阶段。
 * @param config 当前流程草案
 * @returns G6流程设计数据
 */
export function templateGraph(config: CompanyConfig): BusinessGraphModel {
  const checked = topological(config.workflow.nodes)
  if (checked.error) return { data: { nodes: [], edges: [] }, issue: checked.error }
  const nodes: NodeData[] = [
    visualNode('stage:apply', {
      businessId: 'apply',
      kind: 'stage',
      label: '提交活动申请',
      summary: '冻结表单和实际办理路线',
      tone: 'normal',
    }),
  ]
  const edges: EdgeData[] = []
  const parentCache = new Map<string, string[]>()
  /**
   * 透过知会节点找到阻断前置，用于识别真正需要汇合的叶子。
   * @param id 模板节点标识
   * @returns 必办前置节点标识
   */
  function blockingParents(id: string): string[] {
    const cached = parentCache.get(id)
    if (cached) return cached
    const node = findById(config.workflow.nodes, id)!
    const result = node.kind === 'notice' ? [...new Set(node.deps.flatMap(blockingParents))] : [id]
    parentCache.set(id, result)
    return result
  }
  for (const node of checked.order) {
    const assignee =
      node.assignee.type === 'manager'
        ? '部门负责人'
        : node.assignee.type === 'department_manager'
          ? `${findById(config.departments, node.assignee.value)?.name || '待设置部门'}负责人`
          : findById<{ id: string; name: string }>(node.assignee.type === 'role' ? config.roles : config.users, node.assignee.value)?.name || '待设置受理人'
    const condition = node.condition
      ? ` · ${fieldLabel(config, node.condition.field)}${{ eq: '=', neq: '≠', gte: '≥' }[node.condition.operator]}${node.condition.value}`
      : ''
    nodes.push(
      visualNode('workflow:' + node.id, {
        businessId: node.id,
        kind: 'workflow',
        workflowKind: node.kind,
        label: node.label,
        summary: `${node.kind === 'notice' ? '知会' : node.kind === 'task' ? '任务' : '审批'} · ${assignee}${condition}`,
        tone: node.condition ? 'warning' : 'normal',
      })
    )
    if (!node.deps.length) edges.push(edge('stage:apply', 'workflow:' + node.id))
    for (const dep of node.deps)
      edges.push(edge('workflow:' + dep, 'workflow:' + node.id, node.kind === 'notice' || findById(config.workflow.nodes, dep)?.kind === 'notice'))
  }
  nodes.push(
    visualNode('stage:approved', {
      businessId: 'approved',
      kind: 'stage',
      label: '流程办理完成',
      summary: '全部必办分支完成后汇合',
      tone: 'normal',
    })
  )
  for (const node of checked.order) {
    if (node.kind === 'notice') continue
    let hasChild = false
    for (const candidate of checked.order) if (candidate.kind !== 'notice' && candidate.deps.flatMap(blockingParents).includes(node.id)) hasChild = true
    if (!hasChild) edges.push(edge('workflow:' + node.id, 'stage:approved'))
  }
  if (!checked.order.some((node) => node.kind !== 'notice')) edges.push(edge('stage:apply', 'stage:approved'))
  addStages(nodes, edges, 'stage:approved')
  return { data: { nodes, edges } }
}

/**
 * 追加指派、执行及归档阶段并标明对应负责人，不把业务阶段当成审批节点。
 * @param nodes 图节点
 * @param edges 图边
 * @param from 审批汇合节点
 * @param status 当前业务状态
 * @param owners 各阶段的负责人姓名或职责说明
 */
function addStages(nodes: NodeData[], edges: EdgeData[], from: string, status?: ActivityStatus, owners: Record<string, string> = {}): void {
  let current = -1
  for (let index = 0; index < stages.length; index += 1) if (stages[index]!.statuses.includes(status || '')) current = index
  let previous = from
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index]!
    const tone: GraphTone = current > index || status === 'archived' ? 'success' : current === index ? 'active' : 'normal'
    const id = 'stage:' + stage.id
    nodes.push(
      visualNode(id, {
        businessId: stage.id,
        kind: 'stage',
        label: stage.name,
        summary: [current === index ? '当前业务阶段' : current > index || status === 'archived' ? '已完成' : '后续业务阶段', owners[stage.id]]
          .filter(Boolean)
          .join(' · '),
        tone,
      })
    )
    edges.push(edge(previous, id))
    previous = id
  }
}

/**
 * 将实际节点轮次、受理人和当前状态转换为G6审批进度图，默认显示本次申请。
 * @param detail 服务端流程详情
 * @param showHistory 是否叠加历史申请节点；纯知会通过虚线连接自动完成阶段
 * @returns 实际流程图
 */
export function runtimeGraph(detail: WorkflowViewDetail, showHistory = false): BusinessGraphModel {
  const all = detail.activity.nodes
  const revision = detail.activity.revision || 1
  const current = all.filter(
    /**
     * 按申请轮次选择当前或历史节点。
     * @param node 节点
     * @returns 是否展示
     */ function included(node) {
      return showHistory || (node.applicationRevision || 1) === revision
    }
  )
  const checked = topological(current)
  if (checked.error) return { data: { nodes: [], edges: [] }, issue: checked.error }
  const nodes: NodeData[] = []
  const edges: EdgeData[] = []
  const hasRealStatus = !!detail.activity.status
  for (const node of checked.order) {
    const progress = nodeProgressStatus(node, detail.activity.tasks, detail.activity.status)
    let tone: GraphTone =
      progress === 'rejected'
        ? 'error'
        : progress === 'returned' || progress === 'reworking'
          ? 'warning'
          : node.status === 'active'
            ? 'active'
            : node.status === 'completed'
              ? 'success'
              : ['invalidated', 'skipped'].includes(node.status)
                ? 'muted'
                : 'normal'
    for (const warning of detail.taskWarnings || []) {
      const task = findById(detail.activity.tasks, warning.taskId)
      if (task?.nodeId === node.id && tone !== 'error') tone = 'warning'
    }
    const names: string[] = []
    for (const id of node.assignees) names.push(findById(detail.participants, id)?.name || id)
    nodes.push(
      visualNode('runtime:' + node.id, {
        businessId: node.id,
        kind: 'runtime',
        label: node.label,
        summary: `${NODE_STATUSES[progress]} · ${names.join('、') || '无受理人'} · V${node.applicationRevision || revision}`,
        tone,
      })
    )
    for (const dep of node.deps) edges.push(edge('runtime:' + dep, 'runtime:' + node.id, node.kind === 'notice' || node.status === 'skipped'))
  }
  if (nodes.length && hasRealStatus) {
    const approved = !['draft', 'approving', 'needs_info', 'withdrawn', 'rejected'].includes(detail.activity.status!)
    nodes.push(
      visualNode('stage:approved', {
        businessId: 'approved',
        kind: 'stage',
        label: '流程办理完成',
        summary: approved ? '必办节点已结束' : '等待全部必办分支',
        tone: approved ? 'success' : 'normal',
      })
    )
    for (const node of current) {
      if (node.kind === 'notice' || node.status === 'invalidated' || (!showHistory && (node.applicationRevision || 1) !== revision)) continue
      let hasChild = false
      for (const child of current) if (child.kind !== 'notice' && child.deps.includes(node.id)) hasChild = true
      if (!hasChild) edges.push(edge('runtime:' + node.id, 'stage:approved', node.status === 'skipped' || (node.applicationRevision || 1) !== revision))
    }
    if (current.length && current.every((node) => node.kind === 'notice'))
      for (const node of current) edges.push(edge('runtime:' + node.id, 'stage:approved', true))
    const owner = findById(detail.participants, detail.activity.workflowOwnerId || '')?.name || '流程协调人'
    const executor = findById(detail.participants, detail.activity.executor || '')?.name || '执行负责人'
    const archiveReviewer = findById(detail.participants, detail.activity.archive?.reviewer || detail.activity.workflowOwnerId || '')?.name || '归档审核人'
    addStages(nodes, edges, 'stage:approved', detail.activity.status, {
      assign: owner,
      execute: executor,
      archive: detail.activity.status === 'archive_review' || detail.activity.status === 'archived' ? `审核：${archiveReviewer}` : `提交：${executor}`,
    })
    addException(nodes, edges, detail)
  }
  return { data: { nodes, edges } }
}

/**
 * 在实际流程图上显示退回、拒绝、撤回及取消分支，保持业务状态可见。
 * @param nodes 图节点
 * @param edges 图边
 * @param detail 当前工单详情
 */
function addException(nodes: NodeData[], edges: EdgeData[], detail: WorkflowViewDetail): void {
  const status = detail.activity.status
  if (!status || !['needs_info', 'withdrawn', 'rejected', 'cancel_review', 'cancelled'].includes(status)) return
  let from = ''
  let latest = ''
  for (const task of detail.activity.tasks)
    if (['returned', 'rejected'].includes(task.status) && (task.actedAt || '') >= latest) {
      const nodeId = 'runtime:' + task.nodeId
      if (findById(nodes, nodeId)) {
        from = nodeId
        latest = task.actedAt || ''
      }
    }
  const cancelling = status === 'cancel_review' || status === 'cancelled'
  if (cancelling) {
    from = 'stage:approved'
    for (const stage of stages) if (stage.statuses.includes(detail.activity.cancellation?.previous || '')) from = 'stage:' + stage.id
  }
  if (!from)
    for (const node of nodes)
      if (node.data?.kind === 'runtime') {
        from = node.id
        break
      }
  nodes.push(
    visualNode('stage:exception', {
      businessId: status,
      kind: 'stage',
      label: STATUSES[status],
      summary: cancelling ? '取消流程分支 · 按审核结果恢复或终止' : '本轮审批已结束 · 历史意见保留',
      tone: ['needs_info', 'rejected'].includes(status) ? 'error' : ['withdrawn', 'cancelled'].includes(status) ? 'muted' : 'warning',
    })
  )
  if (from) edges.push(edge(from, 'stage:exception', true))
}
