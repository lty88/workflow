import { createUuid } from './ids';
import { lifecycleOf } from './lifecycle';
import { synchronizeBusinessSubprocess } from './business-subprocess';
import {
  canCoordinateExecution,
  finalApproval,
  hasEffectiveApproval,
  synchronizeWorkflowOwner,
} from './post-workflow';
import { appendExecutionRecord, executionReportErrors } from './execution-records';
import type { Activity, Adjustment, CompanyConfig, Permission, WorkflowNode } from './types';
import type { z } from 'zod';
import type { actionSchema, decisionSchema, TransferCommand } from './schemas';
import { activeMember, canHandleTask, canReadActivity, findById, hasPermission } from './permissions';
import { amountFen, isHttps } from './forms';
import {
  advanceWorkflow,
  invalidatePending,
  reopenWorkflow,
  resolveAssignees,
  settleNode,
  topological,
} from './workflow';
import { canDeleteActivity } from './activity-deletion';
import { decisionCapabilities, defaultApprovalPolicy } from './approval-rules';

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
 * 按实际终审人分配执行指派和归档审核，执行人持续记录并在完成后提交归档。
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
  if (lifecycleOf(activity).afterApproval !== 'complete' && activity.status === 'ready_assign' && canCoordinateExecution(config, userId, activity))
    actions.push('assign');
  if (activity.executor === userId && hasPermission(config, userId, 'execution:report')) {
    if (activity.status === 'ready_execute') actions.push('start');
    if (activity.status === 'executing') {
      actions.push('report');
      if (activity.executionRecords?.length || activity.report) actions.push('execution-complete');
    }
  }
  if (
    activity.executor === userId &&
    activity.status === 'archive_draft' &&
    hasPermission(config, userId, 'execution:report')
  )
    actions.push('archive-submit');
  if (
    activity.status === 'archive_review' &&
    activity.archive &&
    activity.archive.submittedBy !== userId &&
    activity.executor !== userId &&
    (finalApproval(activity)
      ? canCoordinateExecution(config, userId, activity)
      : !hasEffectiveApproval(activity) &&
        activity.archive.reviewer === userId &&
        hasPermission(config, userId, 'archive:review'))
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
    ['rejected', 'cancelled', 'archived', 'completed'].includes(activity.status) &&
    hasPermission(config, userId, 'activity:create')
  )
    actions.push('copy');
  return lifecycleOf(activity).afterApproval === 'complete' ? actions.filter(
    /** 通用申请仅保留审批和基础申请动作。
     * @param action 候选动作
     * @returns 是否属于通用能力
     */ function common(action) { return !['assign', 'start', 'report', 'execution-complete', 'archive-submit', 'archive-approve', 'archive-return', 'cancel-request'].includes(action); },
  ) : actions;
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
    id: createUuid(),
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
  const node = findById(activity.nodes, task.nodeId)!;
  const capabilities = decisionCapabilities(config, actor, activity, task);
  requireRule(!command.comment?.trim(), '节点内部说明已移除，请填写审批意见');
  const opinion = command.publicComment?.trim() || '';
  if (command.decision !== 'approve') requireRule(!!opinion, '退回或终止申请请填写审批意见');
  requireRule(
    command.decision === 'return' ||
      (!command.returnTargetId && command.expectedTargetGeneration === undefined),
    '只有退回修改可以指定目标',
  );
  let target;
  if (command.decision === 'return') {
    if (command.returnTargetId === 'applicant' || !command.returnTargetId) {
      requireRule(capabilities.canReturnToApplicant, '本节点未允许退回发起人', 'FORBIDDEN');
    } else {
      target = capabilities.returnTargets.find(
        /** 核验目标属于实时可退回范围。
         * @param item 服务端目标
         * @returns 是否对应请求目标
         */ function same(item) {
          return item.nodeId === command.returnTargetId;
        },
      );
      requireRule(target, '本节点未允许退回该节点，或目标已失效', 'FORBIDDEN');
      requireRule(
        target.generation === command.expectedTargetGeneration,
        '退回目标轮次已变化，请刷新后办理',
        'CONFLICT',
      );
    }
  }
  if (command.decision === 'reject')
    requireRule(capabilities.canTerminate, '本节点未允许终止申请', 'FORBIDDEN');
  const ratingIds = new Set<string>();
  for (const rating of command.ratings || []) {
    requireRule(
      Number.isInteger(rating.score) && rating.score >= 0 && rating.score <= 100,
      '评分需为0至100的整数',
    );
    const expected = capabilities.ratingTargets.find(
      /** 匹配当前可评分的直接上游审批或任务成果。
       * @param item 服务端评分对象
       * @returns 是否为请求对象
       */ function same(item) {
        return item.nodeId === rating.nodeId;
      },
    );
    requireRule(expected, '存在未授权的评分对象', 'FORBIDDEN');
    requireRule(expected.generation === rating.generation, '评分对象轮次已变化，请刷新后办理', 'CONFLICT');
    requireRule(!ratingIds.has(rating.nodeId), '同一节点不能重复评分');
    ratingIds.add(rating.nodeId);
  }
  if (command.decision === 'approve' && capabilities.ratingRequirement === 'required')
    requireRule(ratingIds.size === capabilities.ratingTargets.length, '请完成全部直接前置节点的评分');
  task.comment = '';
  task.publicComment = opinion;
  task.ratings = structuredClone(command.ratings || []);
  task.version += 1;
  task.actedAt = new Date().toISOString();
  if (command.decision === 'approve') {
    task.status = node.kind === 'approval' ? 'approved' : 'completed';
    if (task.status === 'approved') activity.lastApprovalTaskId = task.id;
    settleNode(activity, task.nodeId);
    advanceWorkflow(activity);
  } else if (command.decision === 'return' && target) {
    task.status = 'returned';
    reopenWorkflow(activity, task, target.nodeId, target.affectedNodeIds);
  } else {
    task.status = command.decision === 'return' ? 'returned' : 'rejected';
    if (command.decision === 'return') task.returnTargetId = 'applicant';
    activity.status = command.decision === 'return' ? 'needs_info' : 'rejected';
    invalidatePending(activity);
  }
  auditActivity(
    config,
    activity,
    actor,
    `${node.label}：${command.decision === 'return' ? '退回至' + (target?.label || '发起人') : command.decision === 'reject' ? '终止申请' : '通过'}`,
    '',
    task.nodeId,
  );
  activity.audit.at(-1)!.publicNote = opinion;
  if (activity.status === 'ready_assign' && findById(activity.nodes, task.nodeId)?.kind === 'approval') {
    activity.workflowOwnerId = actor;
    activity.workflowOwnerNodeId = task.nodeId;
  }
  synchronizeWorkflowOwner(activity);
  synchronizeBusinessSubprocess(config, activity, actor);
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
  requireRule(!!command.reason.trim(), '请填写转交原因');
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
 * 由实际终审办理人审核归档；无审批节点的模板才沿用独立归档审核岗位。
 * @param config 当前配置
 * @param activity 活动
 * @param applicant 档案提交人
 * @returns 审核人标识
 */
function archiveReviewer(config: CompanyConfig, activity: Activity, applicant: string): string {
  const final = finalApproval(activity);
  if (final) {
    requireRule(
      final.task.assignee !== applicant && final.task.assignee !== activity.executor,
      '归档审核人与执行人、提交人不能为同一人',
    );
    requireRule(
      canCoordinateExecution(config, final.task.assignee, activity),
      '最后审批人已停用或失去办理资格，请先调整终审负责人',
    );
    return final.task.assignee;
  }
  requireRule(!hasEffectiveApproval(activity), '未找到有效终审办理记录，请核查审批流程');
  for (const user of config.users)
    if (
      user.id !== applicant &&
      user.id !== activity.executor &&
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
 * 执行终审人指派、执行人汇报归档及终审人复核的闭环，任何阶段变更均检查权限与版本。
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
        !finalApproval(activity) || command.executor !== finalApproval(activity)!.task.assignee,
        '终审人负责归档审核，请选择其他人员执行活动',
      );
      requireRule(
        command.executor &&
          activeMember(config, command.executor) &&
          hasPermission(config, command.executor, 'execution:report'),
        '请选择有效执行人',
      );
      requireRule(!!note, '请填写执行安排');
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
      requireRule(command.report, '缺少执行记录');
      const errors = executionReportErrors(command.report);
      requireRule(!errors.length, errors.join('；'));
      requireRule(
        !activity.executionRecords?.some((record) => record.id === command.attachmentContextId),
        '该执行记录已提交',
        'CONFLICT',
      );
      appendExecutionRecord(config, actor, activity, command.report, command.attachmentContextId);
      title = '新增执行记录';
      break;
    }
    case 'execution-complete': {
      requireRule(activity.executionRecords?.length || activity.report, '请至少提交一条执行记录');
      requireRule(command.report, '请确认执行完成汇总');
      const errors = executionReportErrors(command.report, true);
      requireRule(!errors.length, errors.join('；'));
      const actualStart = Date.parse(activity.actualStart);
      requireRule(
        !Number.isFinite(actualStart) || Date.parse(command.report.end) >= actualStart,
        '完成时间不能早于活动实际开始时间',
      );
      activity.report = command.report;
      activity.executionCompletedAt = new Date().toISOString();
      activity.status = 'archive_draft';
      title = '完成执行并提交归档';
      break;
    }
    case 'archive-submit': {
      requireRule(activity.report, '请先完成执行汇报');
      requireRule(!!note, '请填写成果摘要');
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
      synchronizeWorkflowOwner(activity);
      requireRule(command.checks?.length === 3 && command.checks.every(allChecked), '请确认全部归档检查项');
      requireRule(activity.archive, '档案不存在');
      activity.archive.code = `DA-${activity.code.slice(3)}`;
      activity.archive.comment = note;
      activity.status = 'archived';
      title = '审核归档通过';
      break;
    case 'archive-return':
      synchronizeWorkflowOwner(activity);
      requireRule(!!note && activity.archive, '请填写缺项原因');
      activity.archive.comment = note;
      activity.archives.push(structuredClone(activity.archive));
      activity.status = 'archive_draft';
      title = '退回活动档案';
      break;
    case 'cancel-request':
      requireRule(!!note, '请填写取消原因');
      if (activity.status === 'executing')
        requireRule(!!(command.disposal || '').trim(), '请说明已发生费用的处置方式');
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
      requireRule(!!note && activity.cancellation, '请填写拒绝原因');
      activity.status = activity.cancellation.previous;
      title = '拒绝取消并恢复流程';
      break;
    case 'cancel-withdraw':
      requireRule(activity.cancellation, '取消申请不存在');
      activity.status = activity.cancellation.previous;
      title = '撤销取消申请';
      break;
  }
  synchronizeWorkflowOwner(activity);
  synchronizeBusinessSubprocess(config, activity, actor);
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
 * 在事务中插入本场节点，审批采用保守操作策略，失效受影响待办并开启新轮次，不修改公共模板。
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
  requireRule(!!input.name.trim(), '请填写节点名称');
  requireRule(!!input.reason.trim(), '请填写调整原因');
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
    approvalPolicy: input.kind === 'approval' ? defaultApprovalPolicy() : undefined,
    origin: 'instance',
    id: createUuid(),
    key: `extra-${createUuid()}`,
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
