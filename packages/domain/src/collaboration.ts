import type { Activity, CompanyConfig, WorkflowNode, WorkflowTask, CollaborationCapabilities } from './types';
import type { CollaborationDispatchCommand, CollaborationActionCommand } from './schemas';
import { activeMember, canHandleTask, findById, hasPermission, withinDepartment } from './permissions';
import { createUuid } from './ids';
import { SHARED_ACCESS } from './data-access';
import { RuleViolation, auditActivity } from './business';

/** 校验协作操作的业务前置，在任何变更前拒绝无效请求。
 * @param condition 必须成立的条件
 * @param message 可直接展示的原因
 * @param code 授权、并发或输入校验错误类型
 */
function ensureCollaboration(
  condition: unknown,
  message: string,
  code: 'VALIDATION' | 'FORBIDDEN' | 'CONFLICT' = 'VALIDATION',
): asserts condition {
  if (!condition) throw new RuleViolation(code, message);
}

/** 判断当前审批待办是否允许派发协作，旧节点兼容本部门树范围。
 * @param config 当前组织及权限
 * @param actor 操作人
 * @param activity 申请实例
 * @param task 父审批个人待办
 * @returns 是否可派发任务
 */
export function canDispatchCollaboration(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  task: WorkflowTask,
): boolean {
  const node = findById(activity.nodes, task.nodeId);
  return (
    !!node &&
    node.kind === 'approval' &&
    !node.collaboration &&
    node.approvalPolicy?.collaboration?.enabled !== false &&
    canHandleTask(config, actor, activity, task)
  );
}

/** 判断协作目标是否处于父审批当前有效轮次，关闭的主申请不可继续提交或验收。
 * @param activity 当前申请
 * @param node 协作节点
 * @returns 有效父审批待办或空
 */
export function collaborationParent(activity: Activity, node: WorkflowNode): WorkflowTask | undefined {
  const data = node.collaboration;
  if (!data || activity.status !== 'approving') return;
  const parent = findById(activity.tasks, data.parentTaskId);
  const parentNode = findById(activity.nodes, data.parentNodeId);
  if (
    parent?.status === 'pending' &&
    parentNode?.status === 'active' &&
    parent.generation === data.parentGeneration &&
    parentNode.generation === data.parentGeneration &&
    (parentNode.applicationRevision || 1) === (activity.revision || 1)
  )
    return parent;
}

/** 汇总仍需验收的协作数量，仅约束其所属个人审批待办。
 * @param activity 申请实例
 * @param taskId 父个人待办标识
 * @returns 未完成且未撤销的任务数
 */
export function openCollaborations(activity: Activity, taskId: string): number {
  let count = 0;
  for (const node of activity.nodes)
    if (
      node.collaboration?.parentTaskId === taskId &&
      !['accepted', 'cancelled'].includes(node.collaboration.state)
    )
      count++;
  return count;
}

/** 同步父审批失效与串行任务激活，使用现有节点和个人任务表持久化。
 * @param activity 事务内申请实例
 */
export function synchronizeCollaborations(activity: Activity): void {
  for (const node of activity.nodes) {
    const data = node.collaboration;
    if (!data || ['accepted', 'cancelled'].includes(data.state)) continue;
    if (!collaborationParent(activity, node)) {
      data.state = 'cancelled';
      node.status = 'invalidated';
      for (const task of activity.tasks)
        if (task.nodeId === node.id && task.status === 'pending') {
          task.status = 'cancelled';
          task.version++;
        }
      continue;
    }
    if (node.status !== 'waiting') continue;
    let ready = true;
    for (const dep of node.deps) if (findById(activity.nodes, dep)?.status !== 'completed') ready = false;
    if (!ready) continue;
    node.status = 'active';
    activity.tasks.push({
      id: createUuid(),
      activityId: activity.id,
      nodeId: node.id,
      assignee: node.assignees[0]!,
      generation: node.generation,
      status: 'pending',
      version: 1,
      comment: '',
      createdAt: new Date().toISOString(),
    });
  }
}

/** 校验人员与部门范围后创建一组串行或并行协作任务，不改公共模板。
 * @param config 当前组织
 * @param actor 当前审批人
 * @param activity 事务内申请
 * @param taskId 发起协作的个人待办
 * @param command 人员、要求及交付规则
 */
export function dispatchCollaboration(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  taskId: string,
  command: CollaborationDispatchCommand,
): void {
  const parent = findById(activity.tasks, taskId);
  ensureCollaboration(
    parent && canDispatchCollaboration(config, actor, activity, parent),
    '当前待办无派发任务权限',
    'FORBIDDEN',
  );
  ensureCollaboration(
    parent.version === command.expectedTaskVersion,
    '审批待办已变化，请刷新后派发',
    'CONFLICT',
  );
  const parentNode = findById(activity.nodes, parent.nodeId)!;
  const scope = parentNode.approvalPolicy?.collaboration?.scope || 'department_tree';
  const actorDepartment = findById(config.users, actor)!.department;
  for (const input of command.tasks) {
    const user = findById(config.users, input.assignee);
    ensureCollaboration(
      user &&
        activeMember(config, user.id) &&
        hasPermission(config, user.id, 'activity:read') &&
        hasPermission(config, user.id, 'task:complete'),
      '办理人须启用并具有申请查看及节点任务办理权限',
    );
    ensureCollaboration(user.id !== actor, '请选择其他人员办理，派发人负责验收');
    ensureCollaboration(
      scope === 'all' || withinDepartment(config, user.department, actorDepartment),
      '办理人超出本节点允许的部门范围',
    );
    ensureCollaboration(!input.dueAt || Date.parse(input.dueAt) > Date.now(), '截止时间应晚于当前时间');
  }
  const groupId = createUuid();
  let previous = '';
  for (const input of command.tasks) {
    const id = createUuid();
    activity.nodes.push({
      id,
      key: `collab-${id}`,
      origin: 'instance',
      kind: 'task',
      label: input.label,
      deps: command.mode === 'serial' && previous ? [previous] : [],
      assigneeRule: { type: 'user', value: input.assignee },
      assignees: [input.assignee],
      status: 'waiting',
      generation: 1,
      applicationRevision: activity.revision,
      access: structuredClone(SHARED_ACCESS),
      collaboration: {
        parentTaskId: parent.id,
        parentNodeId: parent.nodeId,
        parentGeneration: parent.generation,
        groupId,
        instructions: input.instructions,
        dueAt: input.dueAt,
        attachmentRequired: input.attachmentRequired,
        state: 'working',
        submissions: [],
      },
    });
    previous = id;
  }
  parent.version++;
  activity.structureRevision++;
  synchronizeCollaborations(activity);
  auditActivity(
    config,
    activity,
    actor,
    `派发协作任务（${command.mode === 'serial' ? '顺序' : '并行'}）`,
    '',
    parent.nodeId,
  );
  activity.audit.at(-1)!.publicNote = command.tasks
    .map(
      /** 保存派发名称供公开办理记录追溯。
       * @param input 派发任务
       * @returns 任务名称
       */ function label(input) {
        return input.label;
      },
    )
    .join('、');
}

/** 计算服务端当前会话可见的派发、提交与验收入口，前端与接口共用实时资格。
 * @param config 当前组织
 * @param actor 当前成员
 * @param activity 申请实例
 * @returns 三类可操作标识列表
 */
export function collaborationCapabilities(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
): CollaborationCapabilities {
  const result: CollaborationCapabilities = { dispatchTaskIds: [], submitNodeIds: [], reviewNodeIds: [] };
  for (const task of activity.tasks)
    if (canDispatchCollaboration(config, actor, activity, task)) result.dispatchTaskIds.push(task.id);
  for (const node of activity.nodes) {
    const parent = collaborationParent(activity, node);
    if (!node.collaboration || !parent || ['accepted', 'cancelled'].includes(node.collaboration.state))
      continue;
    if (canHandleTask(config, actor, activity, parent)) result.reviewNodeIds.push(node.id);
    if (node.collaboration.state === 'working')
      for (const task of activity.tasks)
        if (task.nodeId === node.id && canHandleTask(config, actor, activity, task))
          result.submitNodeIds.push(node.id);
  }
  return result;
}

/** 提交协作成果或由父审批人验收、退回、撤销，历史提交和意见只追加。
 * @param config 当前组织
 * @param actor 当前操作者
 * @param activity 已锁定申请
 * @param nodeId 协作节点
 * @param command 动作、协作版本及轮次
 * @param hasAttachment 本次提交是否有经过服务端校验的附件
 */
export function actOnCollaboration(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  nodeId: string,
  command: CollaborationActionCommand,
  hasAttachment: boolean,
): void {
  const node = findById(activity.nodes, nodeId);
  ensureCollaboration(
    node?.collaboration && collaborationParent(activity, node),
    '协作任务已结束或父审批已变化',
    'CONFLICT',
  );
  const data = node.collaboration;
  if ((data.version || 1) !== command.expectedCollaborationVersion)
    throw new RuleViolation('CONFLICT', '协作任务已更新，请刷新后办理');
  ensureCollaboration(node.generation === command.generation, '任务轮次已变化，请刷新', 'CONFLICT');
  const capabilities = collaborationCapabilities(config, actor, activity);
  if (command.action === 'save') {
    ensureCollaboration(
      capabilities.submitNodeIds.includes(nodeId),
      '当前身份或状态不能保存进展',
      'FORBIDDEN',
    );
    data.draft = { summary: command.summary, attachmentContextId: command.attachmentContextId };
  } else if (command.action === 'submit') {
    ensureCollaboration(
      capabilities.submitNodeIds.includes(nodeId),
      '当前身份或状态不能提交成果',
      'FORBIDDEN',
    );
    ensureCollaboration(command.summary.trim(), '请填写成果说明');
    ensureCollaboration(!data.attachmentRequired || hasAttachment, '此任务必须上传本次成果附件');
    data.submissions.push({
      id: createUuid(),
      generation: node.generation,
      summary: command.summary,
      submittedAt: new Date().toISOString(),
      submittedBy: actor,
      attachmentContextId: command.attachmentContextId,
    });
    data.state = 'submitted';
    delete data.draft;
    for (const task of activity.tasks)
      if (task.nodeId === node.id && task.generation === node.generation && task.status === 'pending') {
        task.status = 'completed';
        task.publicComment = command.summary;
        task.actedAt = new Date().toISOString();
        task.version++;
      }
  } else {
    ensureCollaboration(capabilities.reviewNodeIds.includes(nodeId), '当前身份不能验收此任务', 'FORBIDDEN');
    if (command.action === 'cancel') {
      ensureCollaboration(command.summary.trim(), '请填写撤销原因');
      // 顺序任务中撤销该项视为免除办理，后续任务仍按既有顺序推进。
      data.state = 'cancelled';
      node.status = 'completed';
      for (const child of activity.nodes) {
        if (child.collaboration?.groupId !== data.groupId || !child.deps.includes(node.id)) continue;
        const deps: string[] = [];
        for (const dep of child.deps) deps.push(...(dep === node.id ? node.deps : [dep]));
        child.deps = [...new Set(deps)];
      }
      activity.structureRevision++;
      for (const task of activity.tasks)
        if (task.nodeId === node.id && task.status === 'pending') {
          task.status = 'cancelled';
          task.version++;
        }
    } else {
      ensureCollaboration(data.state === 'submitted', '请等待办理人提交成果');
      if (command.action === 'return') ensureCollaboration(command.summary.trim(), '请填写退回补充要求');
      if (command.action === 'accept')
        ensureCollaboration(
          data.submissions.at(-1)!.submittedBy !== actor,
          '成果提交人不能验收本人提交，请转交父审批待办',
        );
      data.submissions.at(-1)!.review = {
        decision: command.action,
        comment: command.summary,
        actor,
        at: new Date().toISOString(),
      };
      if (command.action === 'accept') {
        data.state = 'accepted';
        node.status = 'completed';
      } else {
        data.state = 'working';
        node.status = 'waiting';
        node.generation++;
      }
    }
  }
  data.version = (data.version || 1) + 1;
  synchronizeCollaborations(activity);
  auditActivity(
    config,
    activity,
    actor,
    `${node.label}：${{ save: '保存进展', submit: '提交成果', accept: '验收通过', return: '退回补充', cancel: '撤销任务' }[command.action]}`,
    '',
    node.id,
  );
  if (command.action !== 'save') activity.audit.at(-1)!.publicNote = command.summary;
}
