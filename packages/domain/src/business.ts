import type { Activity, Adjustment, CompanyConfig, Permission, WorkflowNode } from './types';
import type { z } from 'zod';
import type { actionSchema, decisionSchema, TransferCommand } from './schemas';
import { activeMember, canHandleTask, canReadActivity, findById, hasPermission } from './permissions';
import { amountFen, isHttps } from './forms';
import { advanceWorkflow, invalidatePending, resolveAssignees, settleNode, topological } from './workflow';
import { canDeleteActivity } from './activity-deletion';

export class RuleViolation extends Error {
  /**
   * 构造业务规则错误。
   * @param code 错误类别
   * @param message 中文说明
   */
  constructor(
    public code: 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION',
    message: string,
  ) {
    super(message);
  }
}

/**
 * 检查业务规则并抛出可映射的错误。
 * @param condition 条件
 * @param message 错误说明
 * @param code 错误类别
 */
export function requireRule(
  condition: unknown,
  message: string,
  code: RuleViolation['code'] = 'VALIDATION',
): asserts condition {
  if (!condition) throw new RuleViolation(code, message);
}

/**
 * 计算当前成员的业务按钮能力，服务端处理动作时再次计算。
 * @param config 当前配置
 * @param userId 成员
 * @param activity 活动
 * @returns 允许动作
 */
export function activityActions(config: CompanyConfig, userId: string, activity: Activity): string[] {
  if (!canReadActivity(config, userId, activity)) return [];
  const actions: string[] = [];
  if (canDeleteActivity(config, userId, activity)) actions.push('delete');
  const own = activity.applicant === userId;
  if (own && ['draft', 'needs_info', 'withdrawn'].includes(activity.status)) {
    if (hasPermission(config, userId, 'activity:create')) actions.push('edit');
    if (hasPermission(config, userId, 'activity:submit')) actions.push('submit');
  }
  if (own && activity.status === 'approving' && hasPermission(config, userId, 'activity:submit'))
    actions.push('withdraw');
  if (activity.status === 'approving' && hasPermission(config, userId, 'workflow:adjust'))
    actions.push('adjust');
  if (activity.status === 'ready_assign' && hasPermission(config, userId, 'activity:assign'))
    actions.push('assign');
  if (activity.executor === userId && hasPermission(config, userId, 'execution:report')) {
    if (activity.status === 'ready_execute') actions.push('start');
    if (activity.status === 'executing') actions.push('report');
  }
  if (own && activity.status === 'archive_draft' && hasPermission(config, userId, 'activity:submit'))
    actions.push('archive-submit');
  if (
    activity.status === 'archive_review' &&
    activity.archive?.reviewer === userId &&
    activity.archive.submittedBy !== userId &&
    hasPermission(config, userId, 'archive:review')
  )
    actions.push('archive-approve', 'archive-return');
  if (
    ['ready_assign', 'ready_execute', 'executing'].includes(activity.status) &&
    ((own && hasPermission(config, userId, 'activity:submit')) ||
      hasPermission(config, userId, 'activity:assign'))
  )
    actions.push('cancel-request');
  if (activity.status === 'cancel_review') {
    if (activity.cancellation?.reviewer === userId && hasPermission(config, userId, 'approval:decide'))
      actions.push('cancel-approve', 'cancel-reject');
    if (activity.cancellation?.requester === userId) actions.push('cancel-withdraw');
  }
  if (hasPermission(config, userId, 'activity:export')) actions.push('export');
  if (
    ['rejected', 'cancelled', 'archived'].includes(activity.status) &&
    hasPermission(config, userId, 'activity:create')
  )
    actions.push('copy');
  return actions;
}

/**
 * 追加可追溯的业务记录，调用者负责数据库事务。
 * @param config 当前配置
 * @param activity 活动
 * @param actor 操作者
 * @param action 动作名称
 * @param note 意见或原因
 * @param nodeId 可选内容归属节点，供审计内容授权
 */
export function auditActivity(
  config: CompanyConfig,
  activity: Activity,
  actor: string,
  action: string,
  note: string,
  nodeId?: string,
): void {
  activity.audit.push({
    id: crypto.randomUUID(),
    actor,
    actorName: findById(config.users, actor)?.name || actor,
    action,
    note,
    nodeId,
    createdAt: new Date().toISOString(),
  });
}

/**
 * 办理个人任务并推进并行汇合，使用个人任务版本避免整单并发冲突。
 * @param config 当前配置
 * @param actor 操作者
 * @param activity 活动实例
 * @param taskId 个人任务
 * @param command 决策参数
 */
export function decideTask(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  taskId: string,
  command: z.infer<typeof decisionSchema>,
): void {
  const task = findById(activity.tasks, taskId);
  requireRule(task, '任务不存在', 'CONFLICT');
  requireRule(task.version === command.expectedTaskVersion, '任务已变化，请刷新后办理', 'CONFLICT');
  requireRule(canHandleTask(config, actor, activity, task), '当前身份或节点状态不允许办理', 'FORBIDDEN');
  requireRule(
    findById(activity.nodes, task.nodeId)?.kind === 'approval' || command.decision === 'approve',
    '任务与知会节点只支持完成',
  );
  if (command.decision !== 'approve')
    requireRule(
      (command.publicComment || command.comment).trim().length >= 5,
      '退回或拒绝请填写至少5字公开补充要求或原因',
    );
  task.comment = command.comment.trim();
  task.publicComment =
    command.publicComment?.trim() ||
    (command.decision === 'return'
      ? '申请已退回，请联系审核人确认补充要求'
      : command.decision === 'reject'
        ? '申请未通过，请联系审核人确认原因'
        : '');
  task.version += 1;
  task.actedAt = new Date().toISOString();
  if (command.decision === 'approve') {
    task.status = findById(activity.nodes, task.nodeId)?.kind === 'approval' ? 'approved' : 'completed';
    settleNode(activity, task.nodeId);
    advanceWorkflow(activity);
  } else {
    task.status = command.decision === 'return' ? 'returned' : 'rejected';
    activity.status = command.decision === 'return' ? 'needs_info' : 'rejected';
    invalidatePending(activity);
  }
  auditActivity(
    config,
    activity,
    actor,
    `${findById(activity.nodes, task.nodeId)?.label}：${{ approve: '通过', return: '退回补充', reject: '拒绝' }[command.decision]}`,
    command.comment,
    task.nodeId,
  );
}

/**
 * 将待办转交给具备实时资格的成员，保留任务版本和完整转交审计。
 * @param config 当前配置
 * @param actor 流程管理员
 * @param activity 活动实例
 * @param taskId 个人待办
 * @param command 新受理人及原因
 */
export function transferTask(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  taskId: string,
  command: TransferCommand,
): void {
  requireRule(command.reason.trim().length >= 5, '转交原因至少5字');
  requireRule(activityActions(config, actor, activity).includes('adjust'), '无待办转交权限', 'FORBIDDEN');
  const task = findById(activity.tasks, taskId);
  const node = task && findById(activity.nodes, task.nodeId);
  requireRule(
    task &&
      node &&
      task.status === 'pending' &&
      node.status === 'active' &&
      node.generation === task.generation,
    '只能转交当前有效待办',
    'CONFLICT',
  );
  requireRule(task.version === command.expectedTaskVersion, '任务已更新，请刷新', 'CONFLICT');
  requireRule(
    command.assignee !== task.assignee && !node.assignees.includes(command.assignee),
    '新受理人不能与当前节点已有受理人重复',
  );
  const people = resolveAssignees(
    config,
    { type: 'user', value: command.assignee },
    activity.applicant,
    node.kind,
  );
  requireRule(!people.errors.length, people.errors.join('；'));
  const prospectiveTask = { ...task, assignee: command.assignee };
  const prospectiveNode = { ...node, assignees: [...node.assignees, command.assignee] };
  const prospective = {
    ...activity,
    nodes: [...activity.nodes, prospectiveNode],
    tasks: [...activity.tasks, prospectiveTask],
  };
  requireRule(canReadActivity(config, command.assignee, prospective), '新受理人数据范围不覆盖本活动');
  const previous = task.assignee;
  /**
   * 移除转交前的受理人标识。
   * @param id 成员标识
   * @returns 是否保留
   */
  function other(id: string): boolean {
    return id !== previous;
  }
  node.assignees = node.assignees.filter(other);
  node.assignees.push(command.assignee);
  task.assignee = command.assignee;
  task.delegated = true;
  task.createdAt = new Date().toISOString();
  task.version += 1;
  auditActivity(
    config,
    activity,
    actor,
    `转交待办：${node.label}`,
    `${findById(config.users, previous)?.name || previous} → ${findById(config.users, command.assignee)?.name || command.assignee}；${command.reason}`,
    node.id,
  );
}

/**
 * 选取具备资格且数据范围覆盖的归档审核人。
 * @param config 当前配置
 * @param activity 活动
 * @param applicant 档案提交人
 * @returns 审核人标识
 */
function archiveReviewer(config: CompanyConfig, activity: Activity, applicant: string): string {
  for (const user of config.users)
    if (
      user.id !== applicant &&
      hasPermission(config, user.id, 'archive:review') &&
      canReadActivity(config, user.id, activity)
    )
      return user.id;
  throw new RuleViolation('VALIDATION', '当前部门未配置有效归档审核人，请联系管理员');
}

/**
 * 从部门负责人向上寻找非自审取消审核人。
 * @param config 当前配置
 * @param activity 活动
 * @param requester 发起人
 * @returns 取消审核人
 */
function cancellationReviewer(config: CompanyConfig, activity: Activity, requester: string): string {
  const seen = new Set<string>();
  let id = activity.department;
  while (id && !seen.has(id)) {
    seen.add(id);
    const dept = findById(config.departments, id);
    const userId = dept?.manager || '';
    if (
      userId &&
      userId !== requester &&
      userId !== activity.applicant &&
      hasPermission(config, userId, 'approval:decide')
    ) {
      const prospective = {
        ...activity,
        cancellation: { previous: activity.status, requester, reviewer: userId, reason: '', disposal: '' },
      };
      if (canReadActivity(config, userId, prospective)) return userId;
    }
    id = dept?.parent || '';
  }
  throw new RuleViolation('VALIDATION', '未找到符合权限与自审规则的取消审核人');
}

/**
 * 执行批准后业务闭环，任何阶段变更均检查当前权限与版本。
 * @param config 当前配置
 * @param actor 操作者
 * @param activity 活动
 * @param command 业务动作
 * @param archiveFileExists 是否已上传成果文件
 */
export function applyActivityAction(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  command: z.infer<typeof actionSchema>,
  archiveFileExists: boolean,
): void {
  requireRule(activity.version === command.expectedVersion, '工单已更新，请刷新', 'CONFLICT');
  requireRule(
    activityActions(config, actor, activity).includes(command.action),
    '无此操作权限或当前状态不允许',
    'FORBIDDEN',
  );
  const note = command.comment.trim();
  let title = '';
  switch (command.action) {
    case 'withdraw':
      invalidatePending(activity);
      activity.status = 'withdrawn';
      title = '撤回申请';
      break;
    case 'assign':
      requireRule(
        command.executor &&
          activeMember(config, command.executor) &&
          hasPermission(config, command.executor, 'execution:report'),
        '请选择有效执行人',
      );
      requireRule(note.length >= 5, '执行安排至少5字');
      activity.executor = command.executor;
      requireRule(canReadActivity(config, command.executor, activity), '执行人数据范围不覆盖本活动');
      activity.assignment = note;
      activity.status = 'ready_execute';
      title = '指派执行人';
      break;
    case 'start':
      requireRule(Date.parse(activity.payload.start_at || '') <= Date.now(), '请到计划开始时间再开始');
      activity.actualStart = new Date().toISOString();
      activity.status = 'executing';
      title = '开始执行';
      break;
    case 'report': {
      const report = command.report;
      requireRule(report, '缺少执行汇报');
      const start = Date.parse(report.start);
      const end = Date.parse(report.end);
      requireRule(
        Number.isFinite(start) && Number.isFinite(end) && end >= start && end <= Date.now(),
        '实际时间无效或晚于当前时间',
      );
      requireRule(report.people > 0 || report.exception.trim().length >= 5, '实到人数为零时需说明原因');
      requireRule(!report.spend || Number.isFinite(amountFen(report.spend)), '实际支出格式无效');
      activity.report = report;
      activity.status = 'archive_draft';
      title = '提交执行汇报';
      break;
    }
    case 'archive-submit': {
      requireRule(activity.report, '请先完成执行汇报');
      requireRule(note.length >= 10, '成果摘要至少10字');
      requireRule(archiveFileExists || !!command.url, '请上传成果文件或填写成果链接');
      requireRule(!command.url || isHttps(command.url), '成果链接必须使用HTTPS');
      activity.archive = {
        version: (activity.archive?.version || 0) + 1,
        summary: note,
        url: command.url || '',
        submittedBy: actor,
        reviewer: archiveReviewer(config, activity, actor),
        comment: '',
      };
      activity.status = 'archive_review';
      title = '提交档案审核';
      break;
    }
    case 'archive-approve':
      requireRule(command.checks?.length === 3 && command.checks.every(allChecked), '请确认全部归档检查项');
      requireRule(activity.archive, '档案不存在');
      activity.archive.code = `DA-${activity.code.slice(3)}`;
      activity.archive.comment = note;
      activity.status = 'archived';
      title = '审核归档通过';
      break;
    case 'archive-return':
      requireRule(note.length >= 5 && activity.archive, '请填写至少5字的缺项原因');
      activity.archive.comment = note;
      activity.archives.push(structuredClone(activity.archive));
      activity.status = 'archive_draft';
      title = '退回活动档案';
      break;
    case 'cancel-request':
      requireRule(note.length >= 5, '取消原因至少5字');
      if (activity.status === 'executing')
        requireRule((command.disposal || '').trim().length >= 5, '请说明已发生费用的处置方式');
      activity.cancellation = {
        previous: activity.status,
        requester: actor,
        reviewer: cancellationReviewer(config, activity, actor),
        reason: note,
        disposal: command.disposal || '',
      };
      activity.status = 'cancel_review';
      title = '申请取消活动';
      break;
    case 'cancel-approve':
      activity.status = 'cancelled';
      invalidatePending(activity);
      title = '批准取消活动';
      break;
    case 'cancel-reject':
      requireRule(note.length >= 5 && activity.cancellation, '请填写至少5字拒绝原因');
      activity.status = activity.cancellation.previous;
      title = '拒绝取消并恢复流程';
      break;
    case 'cancel-withdraw':
      requireRule(activity.cancellation, '取消申请不存在');
      activity.status = activity.cancellation.previous;
      title = '撤销取消申请';
      break;
  }
  auditActivity(config, activity, actor, title, note || command.report?.summary || '');
}

/**
 * 判断归档检查项是否确认。
 * @param value 勾选值
 * @returns 是否已确认
 */
function allChecked(value: boolean): boolean {
  return value;
}

/**
 * 在事务中的实例副本插入本场新增节点，失效受影响的旧待办并开启新轮次，不修改公共模板。
 * @param config 当前配置
 * @param actor 操作者
 * @param activity 实例
 * @param input 插入规则
 */
export function adjustWorkflow(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  input: Adjustment,
): void {
  requireRule(activityActions(config, actor, activity).includes('adjust'), '无流程调整权限', 'FORBIDDEN');
  requireRule(
    activity.structureRevision === input.expectedStructureRevision,
    '流程结构已变化，请刷新',
    'CONFLICT',
  );
  const anchor = findById(activity.nodes, input.anchor);
  requireRule(anchor && !['invalidated', 'skipped'].includes(anchor.status), '请选择当前有效节点');
  if (input.position === 'before') requireRule(anchor.status !== 'completed', '已完成节点不能前加签');
  const children: WorkflowNode[] = [];
  for (const node of activity.nodes) if (node.deps.includes(anchor.id)) children.push(node);
  if (input.kind !== 'notice' && input.position !== 'before')
    for (const child of children)
      requireRule(child.status !== 'completed', '受影响后继已完成，请发起正式重审');
  const people = resolveAssignees(config, input.assignee, activity.applicant, input.kind);
  requireRule(!people.errors.length, people.errors.join('；'));
  const node: WorkflowNode = {
    access: structuredClone(
      anchor.access || { mode: 'restricted', roleIds: [], userIds: [], nodeAssignees: true },
    ),
    downloadAccess: anchor.downloadAccess ? structuredClone(anchor.downloadAccess) : undefined,
    origin: 'instance',
    id: crypto.randomUUID(),
    key: `extra-${crypto.randomUUID()}`,
    label: input.name,
    kind: input.kind,
    deps: input.position === 'after' && anchor.kind !== 'notice' ? [anchor.id] : [...anchor.deps],
    assigneeRule: input.assignee,
    assignees: people.ids,
    status: 'waiting',
    generation: 1,
    applicationRevision: activity.revision,
  };
  for (const userId of people.ids) {
    const prospective = { ...activity, nodes: [...activity.nodes, node] };
    requireRule(
      input.kind === 'notice' || canReadActivity(config, userId, prospective),
      '新受理人数据范围不覆盖本活动',
    );
  }
  const affected = new Set<string>();
  if (input.kind !== 'notice') {
    if (input.position === 'before') {
      anchor.deps = [node.id];
      affected.add(anchor.id);
    } else
      for (const child of children) {
        const deps: string[] = [];
        for (const dep of child.deps)
          deps.push(dep === anchor.id && input.position === 'after' ? node.id : dep);
        if (input.position === 'parallel') deps.push(node.id);
        child.deps = [...new Set(deps)];
        affected.add(child.id);
      }
  }
  for (const current of activity.nodes)
    if (affected.has(current.id) && current.status === 'active') {
      for (const task of activity.tasks)
        if (task.nodeId === current.id && task.generation === current.generation) {
          if (task.status === 'pending') task.status = 'cancelled';
          task.version += 1;
        }
      current.generation += 1;
      current.status = 'waiting';
    }
  activity.nodes.push(node);
  requireRule(!topological(activity.nodes).error, '调整会形成循环依赖');
  activity.structureRevision += 1;
  advanceWorkflow(activity);
  auditActivity(
    config,
    activity,
    actor,
    `新增${{ approval: '审核', task: '任务', notice: '知会' }[input.kind]}：${input.name}`,
    `${input.position} ${anchor.label}；${input.reason}；结构R${activity.structureRevision}`,
    node.id,
  );
}
