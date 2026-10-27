import { expect, test } from 'vitest';
import {
  advanceWorkflow,
  approvalPolicyErrors,
  canHandleTask,
  decideTask,
  decisionCapabilities,
  decisionSchema,
  defaultApprovalPolicy,
  editableTemplateDefinition,
  instantiateWorkflow,
  projectActivityDetail,
  seedConfig,
  templateContext,
  transferTask,
  adjustWorkflow,
} from '@workflow/domain';
import type {
  Activity,
  CompanyConfig,
  DecisionCommand,
  NodeDefinition,
  WorkflowTask,
} from '@workflow/domain';

/** 创建采用独立人员和默认操作策略的审批定义。
 * @param id 稳定节点键
 * @param actor 受理人员
 * @param deps 前置键集合
 * @returns 审批节点定义
 */
function definition(id: string, actor: string, deps: string[] = []): NodeDefinition {
  return {
    id,
    label: id,
    deps,
    kind: 'approval',
    assignee: { type: 'user', value: actor },
    approvalPolicy: defaultApprovalPolicy(),
  };
}
/** 构造四级串行实例，复用真实成员权限，不连接数据库。
 * @param definitions 可覆盖的依赖图
 * @param ratingEnabled 模板评分总开关
 * @returns 真实引擎生成的实例与组织配置
 */
function fixture(
  definitions = [
    definition('A', 'u-chen'),
    definition('B', 'u-zhou', ['A']),
    definition('C', 'u-zhao', ['B']),
    definition('D', 'u-liu', ['C']),
  ],
  ratingEnabled = true,
) {
  const config = seedConfig();
  config.workflow = { name: '节点操作测试', nodes: definitions, ratingEnabled };
  const plan = instantiateWorkflow(config, {}, 'u-lin', { requireApproval: false });
  expect(plan.errors).toEqual([]);
  const now = new Date().toISOString();
  const activity: Activity = {
    id: 'activity',
    code: 'HD-TEST',
    applicant: 'u-lin',
    department: 'd1',
    name: '跨部门审批',
    status: 'approving',
    version: 1,
    structureRevision: 1,
    revision: 1,
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
    createdAt: now,
    updatedAt: now,
  };
  for (const node of activity.nodes) node.applicationRevision = 1;
  advanceWorkflow(activity);
  return { config, activity };
}
/** 按稳定节点键取得运行节点。
 * @param activity 当前实例
 * @param key 模板节点键
 * @returns 对应运行节点
 */
function node(activity: Activity, key: string) {
  return activity.nodes.find(
    /** 匹配模板键。
     * @param item 运行节点
     * @returns 是否匹配
     */ function same(item) {
      return item.key === key;
    },
  )!;
}
/** 取得指定节点的当前未办任务，支持多人会签选择人员。
 * @param activity 当前实例
 * @param key 模板键
 * @param actor 可选受理人员
 * @returns 有效待办
 */
function pending(activity: Activity, key: string, actor?: string): WorkflowTask {
  const found = activity.tasks.find(
    /** 匹配未办任务和指定受理人。
     * @param task 任务
     * @returns 是否匹配
     */ function same(task) {
      return (
        task.nodeId === node(activity, key).id &&
        task.status === 'pending' &&
        (!actor || task.assignee === actor)
      );
    },
  );
  expect(found).toBeDefined();
  return found!;
}
/** 使用真实业务命令办理任务，缺省为通过，接口模式负责补齐默认字段。
 * @param config 实时组织
 * @param activity 流程实例
 * @param key 节点键
 * @param input 本次决定
 * @param actor 可选办理人
 */
function perform(
  config: CompanyConfig,
  activity: Activity,
  key: string,
  input: Partial<DecisionCommand> = {},
  actor?: string,
): void {
  const task = pending(activity, key, actor);
  decideTask(
    config,
    task.assignee,
    activity,
    task.id,
    decisionSchema.parse({
      decision: 'approve',
      expectedTaskVersion: task.version,
      idempotencyKey: crypto.randomUUID(),
      ...input,
    }),
  );
}
/** 串行回退重开依赖后续，申请版本不变，历史意见与原任务保持可追溯。 */
function rewindCase(): void {
  const { config, activity } = fixture();
  perform(config, activity, 'A', { publicComment: 'A原成果' });
  perform(config, activity, 'B');
  const c = node(activity, 'C');
  c.approvalPolicy!.returnScope = 'selected';
  c.approvalPolicy!.returnNodeIds = ['A'];
  const old = pending(activity, 'C');
  perform(config, activity, 'C', {
    decision: 'return',
    publicComment: '请A补充测算依据',
    returnTargetId: node(activity, 'A').id,
    expectedTargetGeneration: 1,
  });
  expect(activity.status).toBe('approving');
  expect(activity.revision).toBe(1);
  expect(old.status).toBe('returned');
  expect(old.returnAffectedNodeIds).toHaveLength(4);
  expect(node(activity, 'A').generation).toBe(2);
  expect(node(activity, 'A').status).toBe('active');
  expect(node(activity, 'C').status).toBe('waiting');
  expect(
    activity.tasks.find(
      /** 读取历史通过意见。
       * @param task 历史任务
       * @returns 是否原A任务
       */ function original(task) {
        return task.nodeId === node(activity, 'A').id && task.generation === 1;
      },
    )?.publicComment,
  ).toBe('A原成果');
  expect(canHandleTask(config, old.assignee, activity, old)).toBe(false);
  for (const key of ['A', 'B', 'C', 'D']) perform(config, activity, key);
  expect(activity.status).toBe('ready_assign');
  expect(activity.workflowOwnerId).toBe('u-liu');
  expect(
    activity.audit.some(
      /** 保留明确退回目标的审计事件。
       * @param event 审计事件
       * @returns 是否退回事件
       */ function returned(event) {
        return event.action === 'C：退回至A' && event.publicNote === '请A补充测算依据';
      },
    ),
  ).toBe(true);
}
test('指定上游退回重新依次办理，保留历史且终审职责随新一轮确定', rewindCase);

/** 默认只允许直接上一步，拒绝任意、未来与无关分支，错误命令不改变实例。 */
function scopeCase(): void {
  const { config, activity } = fixture();
  perform(config, activity, 'A');
  perform(config, activity, 'B');
  const task = pending(activity, 'C');
  const caps = decisionCapabilities(config, task.assignee, activity, task);
  expect(
    caps.returnTargets.map(
      /** 提取可退回名称。
       * @param item 目标
       * @returns 名称
       */ function name(item) {
        return item.label;
      },
    ),
  ).toEqual(['B']);
  for (const key of ['A', 'C', 'D', 'missing']) {
    const before = JSON.stringify(activity);
    expect(
      /** 尝试越权退回并核验实例没有部分更新。 */
      function forbidden() {
        perform(config, activity, 'C', {
          decision: 'return',
          publicComment: '修改',
          returnTargetId: node(activity, key)?.id || key,
          expectedTargetGeneration: 1,
        });
      },
    ).toThrow('未允许退回该节点');
    expect(JSON.stringify(activity)).toBe(before);
  }
  expect(
    /** 目标轮次必须与选择时一致。 */
    function stale() {
      perform(config, activity, 'C', {
        decision: 'return',
        publicComment: '修改',
        returnTargetId: node(activity, 'B').id,
        expectedTargetGeneration: 99,
      });
    },
  ).toThrow('轮次已变化');
}
test('服务端限制退回范围并拒绝过期目标，失败无部分修改', scopeCase);

/** 回退只影响依赖后续，独立分支的结果与待办继续有效。 */
function parallelCase(): void {
  for (const completeBranch of [true, false]) {
    const { config, activity } = fixture([
      definition('A', 'u-chen'),
      definition('B', 'u-zhou', ['A']),
      definition('X', 'u-liu', ['A']),
      definition('C', 'u-zhao', ['B']),
      definition('Join', 'u-liu', ['C', 'X']),
    ]);
    perform(config, activity, 'A');
    perform(config, activity, 'B');
    const xTask = pending(activity, 'X');
    if (completeBranch) perform(config, activity, 'X');
    perform(config, activity, 'C', {
      decision: 'return',
      publicComment: 'B需要补充',
      returnTargetId: node(activity, 'B').id,
      expectedTargetGeneration: 1,
    });
    expect(node(activity, 'X').generation).toBe(1);
    expect(node(activity, 'X').status).toBe(completeBranch ? 'completed' : 'active');
    expect(node(activity, 'Join').generation).toBe(2);
    expect(node(activity, 'Join').status).toBe('waiting');
    if (!completeBranch) expect(canHandleTask(config, xTask.assignee, activity, xTask)).toBe(true);
    perform(config, activity, 'B');
    perform(config, activity, 'C');
    if (!completeBranch) {
      expect(node(activity, 'Join').status).toBe('waiting');
      perform(config, activity, 'X');
    }
    expect(node(activity, 'Join').status).toBe('active');
  }
}
test('退回保留独立并行分支，汇合必须重新等待受影响前置', parallelCase);

/** 退回共同上游时取消所有受影响的在办任务，旧页面不能继续提交。 */
function staleTaskCase(): void {
  const { config, activity } = fixture([
    definition('A', 'u-chen'),
    definition('B', 'u-zhou', ['A']),
    definition('C', 'u-zhao', ['A']),
  ]);
  perform(config, activity, 'A');
  const oldB = structuredClone(pending(activity, 'B'));
  perform(config, activity, 'C', {
    decision: 'return',
    publicComment: '重做',
    returnTargetId: node(activity, 'A').id,
    expectedTargetGeneration: 1,
  });
  expect(
    activity.tasks.find(
      /** 匹配取消任务。
       * @param task 任务
       * @returns 是否原B
       */ function original(task) {
        return task.id === oldB.id;
      },
    )?.status,
  ).toBe('cancelled');
  expect(
    /** 旧任务版本在事务中再次核验。 */
    function stale() {
      decideTask(
        config,
        oldB.assignee,
        activity,
        oldB.id,
        decisionSchema.parse({
          decision: 'approve',
          expectedTaskVersion: oldB.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    },
  ).toThrow('任务已变化');
}
test('受影响并行待办作废，过期页面提交被拒绝', staleTaskCase);

/** 评分支持零分与会签个人评价，缺填、重复、越权与过期全部在修改前拒绝。 */
function ratingCase(): void {
  const defs = [definition('A', 'u-chen'), definition('B', 'u-zhou', ['A'])];
  defs[1]!.approvalPolicy!.rating = 'required';
  const { config, activity } = fixture(defs);
  perform(config, activity, 'A');
  const a = node(activity, 'A');
  const b = node(activity, 'B');
  b.assignees.push('u-liu');
  // 为第二位会签人建立真实个人待办，不改变首位任务版本。
  activity.tasks.push({
    ...pending(activity, 'B'),
    id: crypto.randomUUID(),
    assignee: 'u-liu',
    delegated: true,
  });
  const before = JSON.stringify(activity);
  expect(
    /** 通过时必须完成评分。 */
    function missing() {
      perform(config, activity, 'B');
    },
  ).toThrow('请完成全部');
  expect(JSON.stringify(activity)).toBe(before);
  for (const ratings of [
    [{ nodeId: a.id, generation: 2, score: 80 }],
    [{ nodeId: 'future', generation: 1, score: 80 }],
    [
      { nodeId: a.id, generation: 1, score: 80 },
      { nodeId: a.id, generation: 1, score: 90 },
    ],
  ])
    expect(
      /** 评分必须对应唯一且有效的上游轮次。 */
      function invalid() {
        perform(config, activity, 'B', { ratings });
      },
    ).toThrow();
  perform(config, activity, 'B', { ratings: [{ nodeId: a.id, generation: 1, score: 0 }] }, 'u-zhou');
  expect(b.status).toBe('active');
  perform(config, activity, 'B', { ratings: [{ nodeId: a.id, generation: 1, score: 95 }] }, 'u-liu');
  expect(b.status).toBe('completed');
  const rated = activity.tasks.filter(
    /** 获取每个人的独立评分。
     * @param task 任务
     * @returns 是否评分记录
     */ function scored(task) {
      return !!task.ratings?.length;
    },
  );
  expect(rated).toHaveLength(2);
  expect(rated[0]!.ratings![0]!.score).toBe(0);
  expect(rated[1]!.ratings![0]!.score).toBe(95);
}
test('会签独立评分且零分有效，缺填重复越权过期均被拒绝', ratingCase);

/** 汇合处按直接上游逐一评价，不允许漏评其中一个分支。 */
function joinRatingCase(): void {
  const defs = [
    definition('A', 'u-chen'),
    definition('B', 'u-zhou', ['A']),
    definition('C', 'u-zhao', ['A']),
    definition('D', 'u-liu', ['B', 'C']),
  ];
  defs[3]!.approvalPolicy!.rating = 'required';
  const { config, activity } = fixture(defs);
  perform(config, activity, 'A');
  perform(config, activity, 'B');
  perform(config, activity, 'C');
  const ratings = [{ nodeId: node(activity, 'B').id, generation: 1, score: 80 }];
  expect(
    /** 漏评一个前置分支不能通过。 */
    function missing() {
      perform(config, activity, 'D', { ratings });
    },
  ).toThrow('请完成全部');
  ratings.push({ nodeId: node(activity, 'C').id, generation: 1, score: 90 });
  perform(config, activity, 'D', { ratings });
  expect(activity.status).toBe('ready_assign');
}
test('并行汇合要求分别评价两个直接前置审批', joinRatingCase);

/** 评分总开关关闭后实例不接受评分，冻结副本不会被模板后续修改影响。 */
function frozenCase(): void {
  const defs = [definition('A', 'u-chen'), definition('B', 'u-zhou', ['A'])];
  defs[1]!.approvalPolicy!.rating = 'required';
  const { config, activity } = fixture(defs, false);
  config.workflow.nodes[1]!.approvalPolicy!.allowTerminate = true;
  expect(node(activity, 'B').approvalPolicy!.allowTerminate).toBe(false);
  expect(node(activity, 'B').approvalPolicy!.rating).toBe('off');
  perform(config, activity, 'A');
  expect(
    /** 禁用评分时不能通过接口偷偷新增评分。 */
    function hidden() {
      perform(config, activity, 'B', {
        ratings: [{ nodeId: node(activity, 'A').id, generation: 1, score: 100 }],
      });
    },
  ).toThrow('未授权的评分');
  perform(config, activity, 'B');
}
test('模板总开关及节点策略冻结，修改模板不改变正在运行的活动', frozenCase);

/** 终止需节点允许与当前待办，任何一位会签拒绝都会取消剩余待办。 */
function terminationCase(): void {
  const { config, activity } = fixture();
  expect(
    /** 默认关闭终止。 */
    function forbidden() {
      perform(config, activity, 'A', { decision: 'reject', publicComment: '不予开展' });
    },
  ).toThrow('未允许终止');
  const a = node(activity, 'A');
  a.approvalPolicy!.allowTerminate = true;
  a.assignees.push('u-liu');
  const task = pending(activity, 'A');
  activity.tasks.push({ ...task, id: crypto.randomUUID(), assignee: 'u-liu', delegated: true });
  expect(decisionCapabilities(config, 'u-admin', activity, task).canTerminate).toBe(false);
  perform(
    config,
    activity,
    'A',
    { decision: 'reject', publicComment: '项目已经停止', returnTargetId: undefined },
    'u-chen',
  );
  expect(activity.status).toBe('rejected');
  expect(
    activity.tasks.some(
      /** 终止后没有残留待办。
       * @param item 任务
       * @returns 是否还在办理
       */ function pending(item) {
        return item.status === 'pending';
      },
    ),
  ).toBe(false);
  expect(task.status).toBe('rejected');
}
test('终止默认关闭且管理员不绕过待办，授权会签人可终止整个申请', terminationCase);

/** 退给发起人仍走申请版本重提流程，退回时评分不强制。 */
function applicantCase(): void {
  const { config, activity } = fixture();
  perform(config, activity, 'A');
  const b = node(activity, 'B');
  b.approvalPolicy!.rating = 'required';
  b.approvalPolicy!.returnToApplicant = false;
  expect(
    /** 明确禁用退给申请人时不能省略目标绕过。 */
    function forbidden() {
      perform(config, activity, 'B', { decision: 'return', publicComment: '补充申请' });
    },
  ).toThrow('未允许退回发起人');
  b.approvalPolicy!.returnToApplicant = true;
  perform(config, activity, 'B', {
    decision: 'return',
    publicComment: '补充申请',
    returnTargetId: 'applicant',
  });
  expect(activity.status).toBe('needs_info');
  expect(activity.revision).toBe(1);
  expect(activity.audit.at(-1)?.publicNote).toBe('补充申请');
}
test('退回申请人受独立配置控制，退回原因必填但评分选填', applicantCase);

/** 旧活动保留原操作策略，编辑草稿才补默认规则，发布快照不被改写。 */
function legacyCase(): void {
  const defs = [definition('A', 'u-chen')];
  delete defs[0]!.approvalPolicy;
  const { config, activity } = fixture(defs);
  const task = pending(activity, 'A');
  expect(decisionCapabilities(config, task.assignee, activity, task).canTerminate).toBe(true);
  const old = {
    name: '旧发布版',
    activityTypeIds: ['teaching'],
    defaultForTypeIds: [],
    departmentIds: [],
    roleIds: [],
    nodes: defs,
    layout: { direction: 'TB' as const, positions: {} },
  };
  const edited = editableTemplateDefinition(old);
  expect(edited.nodes[0]!.approvalPolicy!.allowTerminate).toBe(false);
  expect(old.nodes[0]!.approvalPolicy).toBeUndefined();
  expect(templateContext(config, old, config.form).workflow.nodes[0]!.approvalPolicy).toBeUndefined();
  perform(config, activity, 'A', { decision: 'return', publicComment: '补充申请' });
  expect(activity.status).toBe('needs_info');
}
test('旧实例策略兼容与新编辑默认规则分离，历史发布快照不变', legacyCase);

/** 前后端都移除私密说明，接口拒绝继续写入，公开意见在详情与记录中可见。 */
function opinionCase(): void {
  const { config, activity } = fixture();
  expect(
    /** 阻止旧客户端继续录入私密说明。 */
    function privateNote() {
      perform(config, activity, 'A', { comment: '新内部说明' });
    },
  ).toThrow('内部说明已移除');
  expect(
    /** 退回缺少原因不能提交。 */
    function noReason() {
      perform(config, activity, 'A', { decision: 'return', publicComment: ' ' });
    },
  ).toThrow('填写审批意见');
  perform(config, activity, 'A', { publicComment: '请按已确认方案继续' });
  const safe = projectActivityDetail(config, 'u-lin', {
    activity,
    files: [],
    actions: [],
    participants: [],
    taskWarnings: [],
  });
  expect(safe.activity.tasks[0]!.comment).toBe('');
  expect(safe.activity.tasks[0]!.publicComment).toBe('请按已确认方案继续');
  expect(safe.activity.audit.at(-1)?.publicNote).toBe('请按已确认方案继续');
  const b = pending(activity, 'B');
  expect(
    projectActivityDetail(config, 'u-zhou', {
      activity,
      files: [],
      actions: [],
      participants: [],
      taskWarnings: [],
    }).decisionCapabilities?.[b.id]?.returnTargets[0]?.label,
  ).toBe('A');
  expect(safe.decisionCapabilities).toEqual({});
}
test('移除内部说明写入，公开意见和操作能力由服务端投影', opinionCase);

/** 模板启用前检查无效退回范围与无评分对象的配置。 */
function policyValidationCase(): void {
  const defs = [definition('A', 'u-chen'), definition('B', 'u-zhou', ['A']), definition('C', 'u-zhao')];
  defs[0]!.approvalPolicy!.rating = 'required';
  defs[1]!.approvalPolicy!.returnScope = 'selected';
  defs[1]!.approvalPolicy!.returnNodeIds = ['C'];
  expect(approvalPolicyErrors(defs, true).join()).toContain('没有直接前置审批');
  expect(approvalPolicyErrors(defs, true).join()).toContain('上游审批或任务');
  defs[1]!.approvalPolicy!.returnNodeIds = [];
  expect(approvalPolicyErrors(defs, false).join()).toContain('请选择可退回');
  const input = { expectedTaskVersion: 1, decision: 'approve', idempotencyKey: crypto.randomUUID() };
  for (const score of [-1, 101, 10.5])
    expect(
      decisionSchema.safeParse({ ...input, ratings: [{ nodeId: 'a', generation: 1, score }] }).success,
    ).toBe(false);
}
test('模板规则启用校验与评分格式校验', policyValidationCase);

/** 明确转交的受理人在退回重办后继承转交资格，仍满足当前基础审批权限。 */
function delegatedReworkCase(): void {
  const defs = [definition('A', 'u-chen'), definition('B', 'u-zhou', ['A'])];
  defs[0]!.assignee = { type: 'role', value: 'academic' };
  const { config, activity } = fixture(defs);
  const a = node(activity, 'A');
  const initial = pending(activity, 'A', 'u-zhou');
  transferTask(config, 'u-wang', activity, initial.id, {
    assignee: 'u-liu',
    expectedTaskVersion: initial.version,
    reason: '负责人休假',
  });
  for (const task of [...activity.tasks])
    if (task.nodeId === a.id && task.status === 'pending') perform(config, activity, 'A', {}, task.assignee);
  perform(config, activity, 'B', {
    decision: 'return',
    publicComment: '补充说明',
    returnTargetId: a.id,
    expectedTargetGeneration: 1,
  });
  const reopened = pending(activity, 'A', 'u-liu');
  expect(reopened.delegated).toBe(true);
  expect(canHandleTask(config, 'u-liu', activity, reopened)).toBe(true);
}
test('节点退回重办继承明确转交人的资格，不恢复旧负责人', delegatedReworkCase);

/** 任务成果也能退回重办，知会与首节点不进入评分对象。 */
function taskTargetCase(): void {
  const defs = [definition('Task', 'u-wang'), definition('Review', 'u-zhou', ['Task'])];
  defs[0]!.kind = 'task';
  delete defs[0]!.approvalPolicy;
  const { config, activity } = fixture(defs);
  perform(config, activity, 'Task', { publicComment: '已补充材料' });
  const review = pending(activity, 'Review');
  const caps = decisionCapabilities(config, 'u-zhou', activity, review);
  expect(caps.ratingTargets).toEqual([]);
  expect(caps.returnTargets[0]!.label).toBe('Task');
  perform(config, activity, 'Review', {
    decision: 'return',
    publicComment: '材料缺页',
    returnTargetId: node(activity, 'Task').id,
    expectedTargetGeneration: 1,
  });
  expect(node(activity, 'Task').status).toBe('active');
  perform(config, activity, 'Task');
  perform(config, activity, 'Review');
  expect(activity.status).toBe('ready_assign');
}
test('任务成果可退回重办，任务不作为审批评分对象', taskTargetCase);

/** 对新加签审批应用保守权限，不能利用未配置策略获得终止能力。 */
function insertedPolicyCase(): void {
  const { config, activity } = fixture();
  adjustWorkflow(config, 'u-wang', activity, {
    name: '新增复核',
    kind: 'approval',
    assignee: { type: 'user', value: 'u-liu' },
    anchor: node(activity, 'A').id,
    position: 'before',
    reason: '补充检查',
    expectedStructureRevision: 1,
    idempotencyKey: crypto.randomUUID(),
  });
  const inserted = activity.nodes.find(
    /** 找到新加签的审批。
     * @param item 实例节点
     * @returns 是否新加签
     */ function added(item) {
      return item.origin === 'instance';
    },
  )!;
  expect(inserted.approvalPolicy).toEqual(defaultApprovalPolicy());
}
test('新加签审批默认关闭终止与评分，不套用旧实例宽策略', insertedPolicyCase);
