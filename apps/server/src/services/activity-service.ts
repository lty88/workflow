import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import type { Activity, ActivityDetail, CompanyConfig, WorkflowTask } from '@workflow/domain';
import {
  preserveFormAccess,
  projectActivityDetail,
  mergeWritablePayload,
  activeMember,
  activityActions,
  advanceWorkflow,
  applyActivityAction,
  auditActivity,
  canReadActivity,
  canHandleTask,
  configSchema,
  decideTask,
  findById,
  hasPermission,
  instantiateWorkflow,
  invalidatePending,
  validateConfig,
  validateForm,
  adjustWorkflow,
  transferTask,
  templateContext,
} from '@workflow/domain';
import type { z } from 'zod';
import type {
  actionSchema,
  adjustmentSchema,
  decisionSchema,
  draftSchema,
  transferSchema,
} from '@workflow/domain';
import {
  activityFiles,
  enqueue,
  jsonValue,
  loadActivity,
  loadConfig,
  query,
  saveActivity,
  transaction,
} from '../db/repository';
import { digest } from './auth';
import { ensure, HttpError } from '../errors';
import { selectTemplate } from './template-service';
import { recordDataAccess } from './data-access-service';

export interface MutationContext {
  connection: PoolConnection;
  config: CompanyConfig;
  activity: Activity | null;
}
interface MutationResult {
  id: string;
  version: number;
}

/**
 * 在配置共享锁与实例锁下执行幂等业务事务，失败整体回滚。
 * @param pool 连接池
 * @param actor 当前账号
 * @param key 幂等键
 * @param request 请求摘要原文
 * @param activityId 活动标识或新建
 * @param work 业务变更
 * @returns 实例标识与新版本
 */
export async function mutateActivity(
  pool: Pool,
  actor: string,
  key: string,
  request: string,
  activityId: string | null,
  work: (context: MutationContext) => Promise<Activity>,
): Promise<MutationResult> {
  /**
   * 保留幂等请求并锁定活动，在一笔事务中保存全部结果。
   * @param connection 事务连接
   * @returns 变更结果
   */
  async function apply(connection: PoolConnection): Promise<MutationResult> {
    const config = (await loadConfig(connection, 'share')).published;
    ensure(activeMember(config, actor), 403, 'ACCOUNT_DISABLED', '账号或部门已停用');
    const hash = digest(request);
    const [reserved] = await connection.execute<ResultSetHeader>(
      'INSERT IGNORE INTO idempotency_records(actor_id,request_key,request_hash) VALUES (?,?,?)',
      [actor, key, hash],
    );
    if (!reserved.affectedRows) {
      const rows = await query<{ request_hash: string; response: unknown }>(
        connection,
        'SELECT request_hash,response FROM idempotency_records WHERE actor_id=? AND request_key=? FOR UPDATE',
        [actor, key],
      );
      ensure(rows[0]?.request_hash === hash, 409, 'IDEMPOTENCY_CONFLICT', '同一个请求标识不能用于不同内容');
      ensure(rows[0]?.response, 409, 'REQUEST_PENDING', '请求正在处理中，请稍后重试');
      return jsonValue<MutationResult>(rows[0].response);
    }
    const activity = activityId ? await loadActivity(connection, activityId, true) : null;
    if (activityId)
      ensure(
        activity && canReadActivity(config, actor, activity),
        404,
        'NOT_FOUND',
        '活动不存在或无访问权限',
      );
    const previousTaskIds = new Set<string>();
    for (const task of activity?.tasks || []) previousTaskIds.add(task.id);
    const changed = await work({ connection, config, activity });
    if (activity) changed.version += 1;
    changed.updatedAt = new Date().toISOString();
    await saveActivity(connection, changed, !activity);
    for (const task of changed.tasks)
      if (!previousTaskIds.has(task.id)) {
        const node = findById(changed.nodes, task.nodeId);
        const notice = node?.kind === 'notice' && task.status === 'completed';
        if (task.status === 'pending' || notice)
          await enqueue(
            connection,
            changed,
            task.assignee,
            `${notice ? '活动知会' : '新的待办'}：${changed.name}`,
            `${notice ? 'notice' : 'task'}:${task.id}`,
          );
      }
    const recipients = new Set<string>([changed.applicant]);
    if (changed.status === 'ready_execute' && changed.executor) recipients.add(changed.executor);
    if (changed.status === 'archive_review' && changed.archive) recipients.add(changed.archive.reviewer);
    if (changed.status === 'cancel_review' && changed.cancellation)
      recipients.add(changed.cancellation.reviewer);
    if (changed.status === 'ready_assign')
      for (const user of config.users)
        if (hasPermission(config, user.id, 'activity:assign') && canReadActivity(config, user.id, changed))
          recipients.add(user.id);
    for (const userId of recipients)
      if (userId !== actor)
        await enqueue(
          connection,
          changed,
          userId,
          `活动进度更新：${changed.name}`,
          `activity:${changed.id}:${changed.version}:${userId}`,
        );
    const response = { id: changed.id, version: changed.version };
    await connection.execute('UPDATE idempotency_records SET response=? WHERE actor_id=? AND request_key=?', [
      JSON.stringify(response),
      actor,
      key,
    ]);
    return response;
  }
  return transaction(pool, apply);
}

/**
 * 创建真实草稿并冻结模板表单，记录当前会话发起者身份、姓名快照和部门。
 * @param pool 连接池
 * @param actor 当前成员
 * @param body 草稿输入
 * @param key 幂等键
 * @returns 新草稿标识
 */
export async function createDraft(
  pool: Pool,
  actor: string,
  body: z.infer<typeof draftSchema>,
  key: string,
): Promise<MutationResult> {
  /**
   * 在所选模板的发布表单下保存草稿，不生成审批任务。
   * @param context 事务上下文
   * @returns 草稿
   */
  async function create(context: MutationContext): Promise<Activity> {
    const { config, connection } = context;
    ensure(
      hasPermission(config, actor, 'activity:create') && hasPermission(config, actor, 'activity:read'),
      403,
      'FORBIDDEN',
      '无新建活动权限',
    );
    const release = await selectTemplate(connection, config, actor, body);
    const payload: Record<string, string> = {};
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const activity: Activity = {
      id,
      code: `HD-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`,
      applicant: actor,
      applicantName: findById(config.users, actor)!.name,
      department: findById(config.users, actor)!.department,
      name: '未命名活动',
      status: 'draft',
      version: 1,
      structureRevision: 1,
      revision: 0,
      configVersion: config.version,
      activityTypeId: release.activityTypeId,
      templateId: release.templateId,
      templateVersion: release.version,
      templateName: release.definition.name,
      schema: structuredClone(release.form),
      payload,
      snapshots: [],
      nodes: [],
      tasks: [],
      audit: [],
      executor: '',
      assignment: '',
      actualStart: '',
      report: null,
      archive: null,
      archives: [],
      cancellation: null,
      createdAt: now,
      updatedAt: now,
    };
    activity.payload = mergeWritablePayload(config, actor, activity, release.form, body.payload);
    activity.name = activity.payload.activity_name?.trim() || '未命名活动';
    auditActivity(config, activity, actor, '创建活动草稿', '资料可继续补充');
    return activity;
  }
  return mutateActivity(pool, actor, key, `create:${JSON.stringify(body)}`, null, create);
}

/**
 * 更新本人可编辑草稿，按明确选择的模板版本更新表单并记录切换。
 * @param pool 连接池
 * @param actor 当前成员
 * @param id 活动标识
 * @param body 草稿内容
 * @param key 幂等键
 * @returns 新版本
 */
export async function updateDraft(
  pool: Pool,
  actor: string,
  id: string,
  body: z.infer<typeof draftSchema>,
  key: string,
): Promise<MutationResult> {
  /**
   * 校验编辑资格和版本后保存输入。
   * @param context 事务上下文
   * @returns 草稿
   */
  async function update(context: MutationContext): Promise<Activity> {
    const { activity, config, connection } = context;
    ensure(
      activity && activityActions(config, actor, activity).includes('edit'),
      403,
      'FORBIDDEN',
      '当前不可编辑',
    );
    ensure(activity.version === body.expectedVersion, 409, 'VERSION_CONFLICT', '工单已变化，请刷新');
    const release = await selectTemplate(connection, config, actor, {
      activityTypeId: body.activityTypeId ?? activity.activityTypeId,
      templateId: body.templateId ?? activity.templateId,
      expectedTemplateVersion: body.expectedTemplateVersion ?? activity.templateVersion,
    });
    const form = preserveFormAccess(activity.schema, release.form);
    const payload = mergeWritablePayload(config, actor, activity, form, body.payload);
    if (activity.templateId !== release.templateId || activity.templateVersion !== release.version)
      auditActivity(
        config,
        activity,
        actor,
        '切换活动流程模板',
        `${activity.templateName || '历史流程'} → ${release.definition.name} V${release.version}`,
      );
    activity.activityTypeId = release.activityTypeId;
    activity.templateId = release.templateId;
    activity.templateVersion = release.version;
    activity.templateName = release.definition.name;
    activity.schema = form;
    activity.payload = payload;
    activity.name = payload.activity_name?.trim() || '未命名活动';
    auditActivity(config, activity, actor, '保存申请内容', '尚未提交新一轮审批');
    return activity;
  }
  return mutateActivity(pool, actor, key, `draft:${id}:${JSON.stringify(body)}`, id, update);
}

/**
 * 提交申请并冻结表单、流程与实际受理人快照。
 * @param pool 连接池
 * @param actor 当前成员
 * @param id 活动标识
 * @param version 主单版本
 * @param key 幂等键
 * @param expectedTemplateVersion 预览并保存的模板版本，旧草稿可省略以使用已记录版本
 * @returns 提交结果
 */
export async function submitActivity(
  pool: Pool,
  actor: string,
  id: string,
  version: number,
  key: string,
  expectedTemplateVersion?: number,
): Promise<MutationResult> {
  /**
   * 生成新的申请轮次，首批满足前置的节点同步激活。
   * @param context 事务上下文
   * @returns 已提交实例
   */
  async function submit(context: MutationContext): Promise<Activity> {
    const { activity, config, connection } = context;
    ensure(
      activity && activityActions(config, actor, activity).includes('submit'),
      403,
      'FORBIDDEN',
      '无提交权限或状态不允许',
    );
    ensure(activity.version === version, 409, 'VERSION_CONFLICT', '工单已变化，请刷新');
    if (expectedTemplateVersion && activity.templateVersion)
      ensure(
        expectedTemplateVersion === activity.templateVersion,
        409,
        'TEMPLATE_VERSION_CONFLICT',
        '模板选择尚未保存，请重新预览并保存申请',
      );
    const release = await selectTemplate(connection, config, actor, {
      activityTypeId: activity.activityTypeId,
      templateId: activity.templateId,
      expectedTemplateVersion: expectedTemplateVersion ?? activity.templateVersion,
    });
    const form = preserveFormAccess(activity.schema, release.form);
    const engineConfig = templateContext(config, release.definition, form);
    const checked = validateForm(form, activity.payload);
    const structuralErrors = validateConfig(engineConfig, { requireProtectedApproval: false });
    const workflow = instantiateWorkflow(engineConfig, checked.payload, actor, { requireApproval: false });
    const errors = [...structuralErrors, ...checked.errors, ...workflow.errors];
    if (checked.payload.start_at && Date.parse(checked.payload.start_at) < Date.now())
      errors.push('活动开始时间不能早于当前时间');
    if (errors.length) throw new HttpError(422, 'VALIDATION', '申请或审核配置需要修正', errors);
    invalidatePending(activity);
    activity.nodes.push(...workflow.nodes);
    activity.payload = checked.payload;
    activity.schema = structuredClone(form);
    activity.activityTypeId = release.activityTypeId;
    activity.templateId = release.templateId;
    activity.templateVersion = release.version;
    activity.templateName = release.definition.name;
    activity.name = checked.payload.activity_name!;
    activity.department = findById(config.users, actor)!.department;
    activity.revision += 1;
    for (const node of workflow.nodes) node.applicationRevision = activity.revision;
    activity.structureRevision += 1;
    activity.configVersion = config.version;
    activity.status = 'approving';
    activity.snapshots.push({
      revision: activity.revision,
      schema: structuredClone(form),
      payload: structuredClone(checked.payload),
      workflow: structuredClone(release.definition.nodes),
      activityTypeId: release.activityTypeId,
      templateId: release.templateId,
      templateVersion: release.version,
      templateName: release.definition.name,
      definitionHash: digest(JSON.stringify({ definition: release.definition, form: release.form })),
      configVersion: config.version,
      submittedAt: new Date().toISOString(),
    });
    advanceWorkflow(activity);
    auditActivity(
      config,
      activity,
      actor,
      `提交申请V${activity.revision}`,
      `${release.definition.name} V${release.version}，配置C${config.version}，流程结构R${activity.structureRevision}`,
    );
    return activity;
  }
  return mutateActivity(
    pool,
    actor,
    key,
    `submit:${id}:${version}:${expectedTemplateVersion ?? ''}`,
    id,
    submit,
  );
}

/**
 * 办理个人任务；请求只接受任务标识和版本，不接受前端指定下一节点。
 * @param pool 连接池
 * @param actor 当前成员
 * @param taskId 任务标识
 * @param command 审核决定
 * @returns 更新结果
 */
export async function handleDecision(
  pool: Pool,
  actor: string,
  taskId: string,
  command: z.infer<typeof decisionSchema>,
): Promise<MutationResult> {
  const rows = await query<{ activity_id: string }>(
    pool,
    'SELECT activity_id FROM workflow_tasks WHERE id=? AND assignee_id=?',
    [taskId, actor],
  );
  ensure(rows[0], 404, 'NOT_FOUND', '任务不存在或无办理权限');
  /**
   * 在实例锁内重新验证并处理当前任务。
   * @param context 事务上下文
   * @returns 更新实例
   */
  async function handle(context: MutationContext): Promise<Activity> {
    ensure(context.activity, 404, 'NOT_FOUND', '活动不存在');
    decideTask(context.config, actor, context.activity, taskId, command);
    return context.activity;
  }
  return mutateActivity(
    pool,
    actor,
    command.idempotencyKey,
    `decision:${taskId}:${JSON.stringify(command)}`,
    rows[0].activity_id,
    handle,
  );
}

/**
 * 执行指派、汇报、归档或取消业务事务。
 * @param pool 连接池
 * @param actor 当前成员
 * @param id 活动标识
 * @param command 业务命令
 * @returns 更新结果
 */
export async function handleAction(
  pool: Pool,
  actor: string,
  id: string,
  command: z.infer<typeof actionSchema>,
): Promise<MutationResult> {
  /**
   * 读取附件资格并执行状态机。
   * @param context 事务上下文
   * @returns 更新实例
   */
  async function handle(context: MutationContext): Promise<Activity> {
    ensure(context.activity, 404, 'NOT_FOUND', '活动不存在');
    const files = await activityFiles(context.connection, id);
    let archiveFile = false;
    for (const file of files) if (file.stage === 'archive') archiveFile = true;
    applyActivityAction(context.config, actor, context.activity, command, archiveFile);
    return context.activity;
  }
  return mutateActivity(
    pool,
    actor,
    command.idempotencyKey,
    `action:${id}:${JSON.stringify(command)}`,
    id,
    handle,
  );
}

/**
 * 执行在途流程结构调整并使旧轮次待办失效。
 * @param pool 连接池
 * @param actor 当前成员
 * @param id 实例标识
 * @param command 调整参数
 * @returns 更新结果
 */
export async function handleAdjustment(
  pool: Pool,
  actor: string,
  id: string,
  command: z.infer<typeof adjustmentSchema>,
): Promise<MutationResult> {
  /**
   * 在锁内应用前插、后插或并行，保留历史意见。
   * @param context 事务上下文
   * @returns 调整实例
   */
  async function handle(context: MutationContext): Promise<Activity> {
    ensure(context.activity, 404, 'NOT_FOUND', '活动不存在');
    adjustWorkflow(context.config, actor, context.activity, command);
    return context.activity;
  }
  return mutateActivity(
    pool,
    actor,
    command.idempotencyKey,
    `adjust:${id}:${JSON.stringify(command)}`,
    id,
    handle,
  );
}

/**
 * 转交待办并为新受理人产生站内通知。
 * @param pool 连接池
 * @param actor 流程负责人
 * @param taskId 待办标识
 * @param command 转交命令
 * @returns 新工单版本
 */
export async function handleTransfer(
  pool: Pool,
  actor: string,
  taskId: string,
  command: z.infer<typeof transferSchema>,
): Promise<MutationResult> {
  const rows = await query<{ activity_id: string }>(
    pool,
    'SELECT activity_id FROM workflow_tasks WHERE id=?',
    [taskId],
  );
  ensure(rows[0], 404, 'NOT_FOUND', '任务不存在');
  /**
   * 持有主单锁校验新受理资格并保存转交记录。
   * @param context 事务上下文
   * @returns 更新实例
   */
  async function handle(context: MutationContext): Promise<Activity> {
    ensure(context.activity, 404, 'NOT_FOUND', '活动不存在');
    transferTask(context.config, actor, context.activity, taskId, command);
    await enqueue(
      context.connection,
      context.activity,
      command.assignee,
      `转交给你的待办：${context.activity.name}`,
      `transfer:${taskId}:${command.expectedTaskVersion}`,
    );
    return context.activity;
  }
  return mutateActivity(
    pool,
    actor,
    command.idempotencyKey,
    `transfer:${taskId}:${JSON.stringify(command)}`,
    rows[0].activity_id,
    handle,
  );
}

/**
 * 读取活动后按实时内容权限投影，历史和附件一起过滤，并记录敏感访问。
 * @param pool 连接池
 * @param actor 当前成员
 * @param id 活动标识
 * @param exporting 是否用于服务端导出，额外校验敏感导出授权
 * @returns 已过滤的详情与可执行动作
 */
export async function getDetail(
  pool: Pool,
  actor: string,
  id: string,
  exporting = false,
): Promise<ActivityDetail> {
  /**
   * 使用同一事务快照读取主单、节点、任务与附件。
   * @param connection 事务连接
   * @returns 一致的工单详情
   */
  async function read(connection: PoolConnection): Promise<ActivityDetail> {
    const config = (await loadConfig(connection)).published;
    const activity = await loadActivity(connection, id);
    ensure(activity && canReadActivity(config, actor, activity), 404, 'NOT_FOUND', '活动不存在或无访问权限');
    if (exporting)
      ensure(activityActions(config, actor, activity).includes('export'), 403, 'FORBIDDEN', '无导出权限');
    const involved = new Set<string>([activity.applicant, activity.executor]);
    for (const node of activity.nodes) for (const userId of node.assignees) involved.add(userId);
    if (activity.archive) involved.add(activity.archive.reviewer);
    if (activity.cancellation) involved.add(activity.cancellation.reviewer);
    const participants: Array<{ id: string; name: string }> = [];
    for (const userId of involved)
      if (userId)
        participants.push({
          id: userId,
          name:
            (userId === activity.applicant ? activity.applicantName : '') ||
            findById(config.users, userId)?.name ||
            userId,
        });
    const taskWarnings: ActivityDetail['taskWarnings'] = [];
    if (activity.status === 'approving')
      for (const task of activity.tasks) {
        const node = findById(activity.nodes, task.nodeId);
        if (
          task.status === 'pending' &&
          node?.status === 'active' &&
          node.generation === task.generation &&
          !canHandleTask(config, task.assignee, activity, task)
        )
          taskWarnings.push({
            taskId: task.id,
            message: '受理人或所属部门已停用，或缺少当前节点权限，请流程负责人转交待办',
          });
      }
    const result = projectActivityDetail(
      config,
      actor,
      {
        activity,
        files: await activityFiles(connection, id),
        actions: activityActions(config, actor, activity),
        participants,
        taskWarnings,
      },
      exporting,
    );
    if (result.access?.containsSensitive)
      await recordDataAccess(
        connection,
        config,
        actor,
        id,
        exporting ? '导出授权敏感资料' : '查看授权敏感资料',
      );
    return result;
  }
  return transaction(pool, read);
}
