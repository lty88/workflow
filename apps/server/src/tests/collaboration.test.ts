import { expect, test } from 'vitest';
import {
  seedConfig,
  instantiateWorkflow,
  advanceWorkflow,
  defaultApprovalPolicy,
  dispatchCollaboration,
  actOnCollaboration,
  collaborationCapabilities,
  collaborationActionSchema,
  collaborationDispatchSchema,
  decideTask,
  decisionSchema,
  projectActivityDetail,
  canReadActivity,
  transferTask,
} from '@workflow/domain';
import type { Activity, ActivityDetail, CollaborationActionCommand } from '@workflow/domain';

/** 构造多人领导会签实例及具备任务权限的员工，使用真实引擎和实时角色。
 * @returns 公司配置、会签申请和操作辅助函数
 */
function fixture() {
  const config = seedConfig();
  config.users
    .find(
      /** 为教研审核人赋予领导会签资格。
       * @param user 成员
       * @returns 是否目标成员
       */ function reviewer(user) {
        return user.id === 'u-zhou';
      },
    )!
    .roles.push('director');
  config.workflow = {
    name: '协作会签',
    nodes: [
      {
        id: 'leader',
        label: '领导会签',
        kind: 'approval',
        deps: [],
        assignee: { type: 'role', value: 'director' },
        approvalPolicy: { ...defaultApprovalPolicy(), collaboration: { enabled: true, scope: 'all' } },
      },
      {
        id: 'next',
        label: '下一级审批',
        kind: 'approval',
        deps: ['leader'],
        assignee: { type: 'user', value: 'u-zhao' },
        approvalPolicy: defaultApprovalPolicy(),
      },
    ],
  };
  const plan = instantiateWorkflow(config, {}, 'u-lin');
  expect(plan.errors).toEqual([]);
  const activity: Activity = {
    id: 'a-collab',
    code: 'HD-COLLAB',
    applicant: 'u-lin',
    department: 'd1',
    name: '协作申请',
    status: 'approving',
    version: 1,
    revision: 1,
    structureRevision: 1,
    configVersion: 1,
    schema: config.form,
    payload: {},
    snapshots: [],
    nodes: plan.nodes,
    tasks: [],
    audit: [],
    executor: '',
    assignment: '',
    actualStart: '',
    report: null,
    archive: null,
    archives: [],
    cancellation: null,
    createdAt: '',
    updatedAt: '',
  };
  advanceWorkflow(activity);
  const parent = activity.tasks.find(
    /** 取得刘文的个人领导待办。
     * @param task 实例任务
     * @returns 是否当前审批人
     */ function mine(task) {
      return task.assignee === 'u-liu';
    },
  )!;
  return { config, activity, parent };
}

/** 在指定个人待办下派发标准交付任务。
 * @param data 测试上下文
 * @param serial 是否顺序办理
 * @param count 任务数
 * @returns 新建的协作节点
 */
function dispatch(data: ReturnType<typeof fixture>, serial = false, count = 1) {
  const tasks = [];
  for (let index = 0; index < count; index++)
    tasks.push({
      label: `方案${index}`,
      assignee: index ? 'u-su' : 'u-wang',
      instructions: '补充方案并上传材料',
      attachmentRequired: true,
    });
  dispatchCollaboration(
    data.config,
    'u-liu',
    data.activity,
    data.parent.id,
    collaborationDispatchSchema.parse({
      idempotencyKey: crypto.randomUUID(),
      expectedTaskVersion: data.parent.version,
      mode: serial ? 'serial' : 'parallel',
      tasks,
    }),
  );
  return data.activity.nodes.filter(
    /** 筛选本次派发节点。
     * @param node 流程节点
     * @returns 是否协作
     */ function child(node) {
      return !!node.collaboration;
    },
  );
}

/** 使用实际输入模式校验执行协作动作，模拟服务端已核验附件归属。
 * @param data 测试上下文
 * @param nodeId 协作节点
 * @param action 交付或验收动作
 * @param actor 操作者
 * @param summary 成果或意见
 * @param hasAttachment 是否存在本次附件
 */
function act(
  data: ReturnType<typeof fixture>,
  nodeId: string,
  action: CollaborationActionCommand['action'],
  actor: string,
  summary = '成果或补充要求',
  hasAttachment = true,
): void {
  const node = data.activity.nodes.find(
    /** 取得目标协作。
     * @param item 节点
     * @returns 是否目标
     */ function target(item) {
      return item.id === nodeId;
    },
  )!;
  actOnCollaboration(
    data.config,
    actor,
    data.activity,
    nodeId,
    collaborationActionSchema.parse({
      idempotencyKey: crypto.randomUUID(),
      generation: node.generation,
      expectedCollaborationVersion: node.collaboration?.version || 1,
      action,
      summary,
    }),
    hasAttachment,
  );
}

/** 按当前待办版本作出正式审批决定。
 * @param data 测试上下文
 * @param actor 当前会签人
 * @param decision 决策
 */
function approve(
  data: ReturnType<typeof fixture>,
  actor: string,
  decision: 'approve' | 'return' = 'approve',
): void {
  const task = data.activity.tasks.find(
    /** 定位当前个人未办审批。
     * @param item 任务
     * @returns 是否符合条件
     */ function mine(item) {
      return item.assignee === actor && item.status === 'pending';
    },
  )!;
  decideTask(
    data.config,
    actor,
    data.activity,
    task.id,
    decisionSchema.parse({
      decision,
      expectedTaskVersion: task.version,
      idempotencyKey: crypto.randomUUID(),
      publicComment: '审核意见',
    }),
  );
}

/** 多人会签只阻塞派发者，成果提交与验收分离，普通任务接口不能绕过验收。 */
function lifecycleCase(): void {
  const data = fixture();
  const [child] = dispatch(data);
  expect(child!.status).toBe('active');
  expect(canReadActivity(data.config, 'u-wang', data.activity)).toBe(true);
  approve(data, 'u-zhou');
  expect(data.parent.status).toBe('pending');
  expect(() => approve(data, 'u-liu')).toThrow('协作任务验收');
  const work = data.activity.tasks.find((task) => task.nodeId === child!.id)!;
  expect(() =>
    decideTask(
      data.config,
      'u-wang',
      data.activity,
      work.id,
      decisionSchema.parse({
        decision: 'approve',
        expectedTaskVersion: work.version,
        idempotencyKey: crypto.randomUUID(),
      }),
    ),
  ).toThrow('协作任务入口');
  expect(() => act(data, child!.id, 'submit', 'u-wang', '提交', false)).toThrow('必须上传');
  act(data, child!.id, 'submit', 'u-wang');
  expect(child!.collaboration!.state).toBe('submitted');
  expect(() => approve(data, 'u-liu')).toThrow('协作任务验收');
  expect(() => act(data, child!.id, 'accept', 'u-zhou')).toThrow('不能验收');
  act(data, child!.id, 'accept', 'u-liu');
  approve(data, 'u-liu');
  expect(data.activity.status).toBe('approving');
  expect(data.activity.nodes.find((node) => node.key === 'next')!.status).toBe('active');
}
test('派发、交付、验收与会签继续审批完整闭环，常规接口不能绕过', lifecycleCase);

/** 顺序协作在前项验收后激活后项，退回保留成果轮次与验收意见。 */
function serialCase(): void {
  const data = fixture();
  const [first, second] = dispatch(data, true, 2);
  expect(second!.status).toBe('waiting');
  act(data, first!.id, 'submit', 'u-wang');
  expect(second!.status).toBe('waiting');
  act(data, first!.id, 'return', 'u-liu');
  expect(first!.generation).toBe(2);
  expect(first!.collaboration!.submissions[0]!.review!.decision).toBe('return');
  act(data, first!.id, 'submit', 'u-wang');
  act(data, first!.id, 'accept', 'u-liu');
  expect(first!.collaboration!.submissions).toHaveLength(2);
  expect(second!.status).toBe('active');
  expect(collaborationCapabilities(data.config, 'u-su', data.activity).submitNodeIds).toContain(second!.id);
}
test('顺序任务验收后推进，返工轮次和历次交付保持可追溯', serialCase);

/** 旧审批版本不能穿过新派发的阻塞条件，主申请退回后子任务关闭。 */
function cancellationCase(): void {
  const data = fixture();
  const oldVersion = data.parent.version;
  const [child] = dispatch(data);
  expect(() =>
    decideTask(
      data.config,
      'u-liu',
      data.activity,
      data.parent.id,
      decisionSchema.parse({
        decision: 'approve',
        expectedTaskVersion: oldVersion,
        idempotencyKey: crypto.randomUUID(),
      }),
    ),
  ).toThrow('任务已变化');
  approve(data, 'u-zhou', 'return');
  expect(data.activity.status).toBe('needs_info');
  expect(child!.collaboration!.state).toBe('cancelled');
  expect(() => act(data, child!.id, 'submit', 'u-wang')).toThrow('父审批已变化');
}
test('派发与审批并发使用待办版本保护，主申请退回同步关闭协作', cancellationCase);

/** 部门范围、模板关闭、他人待办和非办理人操作均由领域层拒绝。 */
function permissionCase(): void {
  const data = fixture();
  const leader = data.activity.nodes[0]!;
  leader.approvalPolicy!.collaboration = { enabled: false, scope: 'all' };
  expect(() => dispatch(data)).toThrow('无派发');
  leader.approvalPolicy!.collaboration = { enabled: true, scope: 'department_tree' };
  data.config.users.find((user) => user.id === 'u-liu')!.department = 'd2';
  expect(() => dispatch(data)).toThrow('部门范围');
  leader.approvalPolicy!.collaboration.scope = 'all';
  const [child] = dispatch(data);
  expect(() => act(data, child!.id, 'submit', 'u-su')).toThrow('不能提交');
  expect(() => act(data, child!.id, 'cancel', 'u-zhou')).toThrow('不能验收');
}
test('模板开关、部门指派范围及协作个人权限在服务端强制执行', permissionCase);

/** 保存进展不提前公开本人草稿，正式提交后移除草稿并开放交付记录。 */
function draftCase(): void {
  const data = fixture();
  const [child] = dispatch(data);
  act(data, child!.id, 'save', 'u-wang', 'PRIVATE-DRAFT', false);
  const detail: ActivityDetail = {
    activity: data.activity,
    files: [],
    participants: [],
    actions: [],
    taskWarnings: [],
  };
  expect(JSON.stringify(projectActivityDetail(data.config, 'u-liu', detail))).not.toContain('PRIVATE-DRAFT');
  expect(JSON.stringify(projectActivityDetail(data.config, 'u-wang', detail))).toContain('PRIVATE-DRAFT');
  act(data, child!.id, 'submit', 'u-wang');
  expect(child!.collaboration!.draft).toBeUndefined();
  expect(child!.collaboration!.submissions).toHaveLength(1);
}
test('进展草稿只对办理人开放，成果提交与进展保存独立', draftCase);

/** 父审批转交后由实际新审批人验收，原审批人失去操作资格。 */
function transferCase(): void {
  const data = fixture();
  const [child] = dispatch(data);
  act(data, child!.id, 'submit', 'u-wang');
  transferTask(data.config, 'u-wang', data.activity, data.parent.id, {
    assignee: 'u-chen',
    reason: '领导调整',
    expectedTaskVersion: data.parent.version,
  });
  expect(() => act(data, child!.id, 'accept', 'u-liu')).toThrow('不能验收');
  act(data, child!.id, 'accept', 'u-chen');
  expect(child!.collaboration!.state).toBe('accepted');
}
test('父审批转交后协作验收权实时跟随当前待办持有人', transferCase);

/** 提前撤销顺序链中间任务时，后续任务仍等待未完成的前序验收。 */
function cancelMiddleCase(): void {
  const data = fixture();
  const [first, middle, last] = dispatch(data, true, 3);
  act(data, middle!.id, 'cancel', 'u-liu', '免除中间任务');
  expect(last!.status).toBe('waiting');
  expect(last!.deps).toContain(first!.id);
  act(data, first!.id, 'submit', 'u-wang');
  act(data, first!.id, 'accept', 'u-liu');
  expect(last!.status).toBe('active');
}
test('提前撤销中间任务保留原顺序链的前置约束', cancelMiddleCase);

/** 不同协作按独立版本提交，同一任务的旧版本保存不能覆盖新成果。 */
function independentVersionCase(): void {
  const data = fixture();
  const [first, second] = dispatch(data, false, 2);
  const old = collaborationActionSchema.parse({
    idempotencyKey: crypto.randomUUID(),
    generation: first!.generation,
    expectedCollaborationVersion: 1,
    action: 'save',
    summary: '旧页面',
  });
  act(data, first!.id, 'save', 'u-wang');
  data.activity.version += 3;
  act(data, second!.id, 'submit', 'u-su');
  expect(second!.collaboration!.state).toBe('submitted');
  expect(() => actOnCollaboration(data.config, 'u-wang', data.activity, first!.id, old, false)).toThrow(
    '协作任务已更新',
  );
}
test('并行协作使用独立版本避免整单冲突，旧任务版本仍被拒绝', independentVersionCase);
