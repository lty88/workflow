import { expect, test } from 'vitest';
import {
  activityActions,
  adjustWorkflow,
  advanceWorkflow,
  applyActivityAction,
  canHandleTask,
  canReadActivity,
  configSchema,
  decideTask,
  defaultValues,
  findById,
  instantiateWorkflow,
  pageAllowed,
  seedConfig,
  topological,
  transferTask,
  validateConfig,
  validateForm,
} from '@workflow/domain';
import type { Activity, CompanyConfig, WorkflowTask } from '@workflow/domain';

/**
 * 生成可校验的申请输入，使用未来时间且不访问数据库。
 * @param config 测试配置
 * @returns 完整业务表单
 */
function validPayload(config: CompanyConfig): Record<string, string> {
  return {
    ...defaultValues(config.form),
    activity_name: '教研公开课交流活动',
    start_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    end_at: new Date(Date.now() + 8 * 86400000).toISOString(),
    location: '树人实验学校',
    background: '提升教师课堂教学能力',
    agenda: '开展公开课与课例交流研讨',
    people: '50',
    contact: '联系人',
    contact_info: '13800000001',
    arranger: '安排人',
    arranger_info: '13800000002',
    receiver: '接收人',
    receiver_info: '13800000003',
    expert_fee: '8000',
    conference_fee: '1000',
    travel_fee: '1000',
    budget: '10000',
  };
}

/**
 * 生成新提交的流程实例并激活首批待办。
 * @param config 公司配置
 * @param budget 金额
 * @returns 活动实例
 */
function instance(config = seedConfig(), budget = '10000'): Activity {
  const payload = validPayload(config);
  payload.budget = budget;
  const plan = instantiateWorkflow(config, payload, 'u-lin');
  expect(plan.errors).toEqual([]);
  const now = new Date().toISOString();
  const activity: Activity = {
    id: crypto.randomUUID(),
    code: 'HD-TEST-001',
    applicant: 'u-lin',
    department: 'd1',
    name: payload.activity_name!,
    status: 'approving',
    version: 1,
    structureRevision: 1,
    revision: 1,
    configVersion: 1,
    schema: config.form,
    payload,
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
  advanceWorkflow(activity);
  return activity;
}

/**
 * 取得当前成员的有效个人任务。
 * @param activity 活动
 * @param actor 成员
 * @returns 待办
 */
function pending(activity: Activity, actor: string): WorkflowTask {
  const task = activity.tasks.find(
    /**
     * 匹配个人未办任务。
     * @param item 任务
     * @returns 是否匹配
     */ function match(item) {
      return item.assignee === actor && item.status === 'pending';
    },
  );
  if (!task) throw new Error('测试任务不存在：' + actor);
  return task;
}

/**
 * 按当前任务版本通过审批。
 * @param config 公司配置
 * @param activity 活动
 * @param actor 审核人
 */
function approve(config: CompanyConfig, activity: Activity, actor: string): void {
  const task = pending(activity, actor);
  decideTask(config, actor, activity, task.id, {
    decision: 'approve',
    comment: '',
    expectedTaskVersion: task.version,
    idempotencyKey: crypto.randomUUID(),
  });
}

/**
 * 验证默认配置及预算防篡改。
 */
function formCase(): void {
  const config = configSchema.parse(seedConfig());
  expect(validateConfig(config)).toEqual([]);
  const payload = validPayload(config);
  payload.budget = '1';
  payload.meeting_url = 'javascript:alert(1)';
  payload.unknown_key = '恶意字段';
  const result = validateForm(config.form, payload);
  expect(result.errors).toEqual([]);
  expect(result.payload.budget).toBe('10000.00');
  expect(result.payload).not.toHaveProperty('meeting_url');
  expect(result.payload).not.toHaveProperty('unknown_key');
  payload.people = '1.5';
  expect(validateForm(config.form, payload).errors.join()).toContain('整数');
  payload.expert_fee = '-1';
  expect(validateForm(config.form, payload).errors.length).toBeGreaterThan(0);
}
test('表单费用由明细计算，隐藏字段和未知字段不进入提交快照', formCase);

/**
 * 验证多分支汇合和个人版本隔离。
 */
function parallelCase(): void {
  const config = seedConfig();
  const activity = instance(config);
  approve(config, activity, 'u-chen');
  const marketing = structuredClone(pending(activity, 'u-zhao'));
  approve(config, activity, 'u-zhou');
  expect(activity.status).toBe('approving');
  expect(
    activity.tasks.some(
      /**
       * 检查负责人节点尚未激活。
       * @param task 任务
       * @returns 是否负责人任务
       */ function director(task) {
        return task.assignee === 'u-liu';
      },
    ),
  ).toBe(false);
  decideTask(config, 'u-zhao', activity, marketing.id, {
    decision: 'approve',
    comment: '',
    expectedTaskVersion: marketing.version,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(pending(activity, 'u-liu')).toBeDefined();
  approve(config, activity, 'u-liu');
  expect(activity.status).toBe('ready_assign');
}
test('并行分支全部完成后汇合，另一分支可用原个人版本办理', parallelCase);

/**
 * 验证低预算跳过负责人审核。
 */
function lowBudgetCase(): void {
  const config = seedConfig();
  const activity = instance(config, '9999.99');
  approve(config, activity, 'u-chen');
  approve(config, activity, 'u-zhou');
  approve(config, activity, 'u-zhao');
  expect(activity.status).toBe('ready_assign');
  expect(
    activity.nodes.find(
      /**
       * 匹配预算节点。
       * @param node 节点
       * @returns 是否匹配
       */ function director(node) {
        return node.key === 'n-director';
      },
    )?.status,
  ).toBe('skipped');
}
test('预算低于阈值时跳过负责人节点', lowBudgetCase);

/**
 * 验证跳过中间节点时，后继仍继承有效前置而不会提前激活。
 */
function skippedParentCase(): void {
  const config = seedConfig();
  config.workflow.nodes.push({
    id: 'n-optional',
    label: '可选专项复核',
    kind: 'approval',
    deps: ['n-department'],
    assignee: { type: 'user', value: 'u-liu' },
    condition: { field: 'budget', operator: 'gte', value: '50000' },
  });
  const academic = findById(config.workflow.nodes, 'n-academic')!;
  academic.deps = ['n-optional'];
  const activity = instance(config);
  const actual = activity.nodes.find(
    /**
     * 查找教研节点实例。
     * @param node 实例节点
     * @returns 是否教研节点
     */ function match(node) {
      return node.key === 'n-academic';
    },
  )!;
  expect(actual.status).toBe('waiting');
  expect(actual.deps).toContain(pending(activity, 'u-chen').nodeId);
  approve(config, activity, 'u-chen');
  expect(actual.status).toBe('active');
}
test('跳过条件节点后继承有效前置，保留串行约束', skippedParentCase);

/**
 * 验证多人会签必须全部通过。
 */
function allVoteCase(): void {
  const config = seedConfig();
  config.users.push({
    id: 'u-academic2',
    name: '教研二审',
    username: 'academic2',
    department: 'research',
    roles: ['academic'],
    active: true,
  });
  const activity = instance(config);
  approve(config, activity, 'u-chen');
  approve(config, activity, 'u-zhou');
  const node = findById(activity.nodes, pending(activity, 'u-academic2').nodeId)!;
  expect(node.status).toBe('active');
  approve(config, activity, 'u-academic2');
  expect(node.status).toBe('completed');
}
test('角色有两名受理人时必须全员通过', allVoteCase);

/**
 * 验证退回结束当前轮次并阻止旧任务再次办理。
 */
function returnCase(): void {
  const config = seedConfig();
  const activity = instance(config);
  approve(config, activity, 'u-chen');
  const academic = pending(activity, 'u-zhou');
  const marketing = structuredClone(pending(activity, 'u-zhao'));
  decideTask(config, 'u-zhou', activity, academic.id, {
    decision: 'return',
    comment: '请补充具体教学议程',
    expectedTaskVersion: 1,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(activity.status).toBe('needs_info');
  expect(activityActions(config, 'u-lin', activity)).toContain('edit');
  expect(canHandleTask(config, 'u-zhao', activity, marketing)).toBe(false);
  expect(
    /**
     * 检查已退回失效的并行任务不能继续办理。
     */ () =>
      decideTask(config, 'u-zhao', activity, marketing.id, {
        decision: 'approve',
        comment: '',
        expectedTaskVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      }),
  ).toThrow();
}
test('退回终止本轮并使其他未办任务失效', returnCase);

/**
 * 验证前加签会替换受影响任务轮次，旧页面提交被拒绝。
 */
function insertionCase(): void {
  const config = seedConfig();
  const activity = instance(config);
  const oldTask = structuredClone(pending(activity, 'u-chen'));
  const node = findById(activity.nodes, oldTask.nodeId)!;
  adjustWorkflow(config, 'u-wang', activity, {
    name: '专项业务复核',
    kind: 'approval',
    assignee: { type: 'user', value: 'u-liu' },
    anchor: node.id,
    position: 'before',
    reason: '新增专项风险检查',
    expectedStructureRevision: 1,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(node.generation).toBe(2);
  expect(node.status).toBe('waiting');
  expect(findById(activity.tasks, oldTask.id)?.status).toBe('cancelled');
  expect(canHandleTask(config, 'u-chen', activity, oldTask)).toBe(false);
  approve(config, activity, 'u-liu');
  expect(pending(activity, 'u-chen').generation).toBe(2);
  expect(topological(activity.nodes).error).toBe('');
  expect(
    /**
     * 验证旧结构版本的插入请求被拒绝。
     */ () =>
      adjustWorkflow(config, 'u-wang', activity, {
        name: '旧结构加签',
        kind: 'approval',
        assignee: { type: 'user', value: 'u-liu' },
        anchor: node.id,
        position: 'after',
        reason: '使用过期结构版本',
        expectedStructureRevision: 1,
        idempotencyKey: crypto.randomUUID(),
      }),
  ).toThrow('流程结构已变化');
}
test('在途前加签失效旧待办，完成新增节点后恢复原节点新轮次', insertionCase);

/**
 * 验证配置权限、跨部门数据范围及禁止自审。
 */
function permissionsCase(): void {
  const config = seedConfig();
  const activity = instance(config);
  expect(canReadActivity(config, 'u-admin', activity)).toBe(false);
  expect(canReadActivity(config, 'u-qiao', activity)).toBe(false);
  expect(pageAllowed(config, 'u-lin', 'p-config')).toBe(false);
  config.departments.find(
    /**
     * 匹配申请部门。
     * @param dept 部门
     * @returns 是否匹配
     */ function department(dept) {
      return dept.id === 'd1';
    },
  )!.manager = 'u-lin';
  config.users
    .find(
      /**
       * 匹配申请人。
       * @param user 人员
       * @returns 是否匹配
       */ function applicant(user) {
        return user.id === 'u-lin';
      },
    )!
    .roles.push('department');
  expect(instantiateWorkflow(config, activity.payload, 'u-lin').errors.join()).toContain('禁止申请人自审');
  config.departments[0]!.active = false;
  expect(canReadActivity(config, 'u-chen', activity)).toBe(false);
}
test('页面、操作与数据范围共同授权，停用上级部门即时阻止操作', permissionsCase);

/**
 * 验证停用受理人后可由流程负责人转交给合格人员。
 */
function transferCase(): void {
  const config = seedConfig();
  const activity = instance(config);
  approve(config, activity, 'u-chen');
  const task = pending(activity, 'u-zhou');
  config.users.find(
    /**
     * 匹配原审核人。
     * @param user 人员
     * @returns 是否匹配
     */ function reviewer(user) {
      return user.id === 'u-zhou';
    },
  )!.active = false;
  expect(canHandleTask(config, 'u-zhou', activity, task)).toBe(false);
  transferTask(config, 'u-wang', activity, task.id, {
    assignee: 'u-liu',
    reason: '原受理人离岗转交',
    expectedTaskVersion: task.version,
  });
  expect(canHandleTask(config, 'u-liu', activity, task)).toBe(true);
  expect(task.version).toBe(2);
  expect(task.delegated).toBe(true);
  expect(activity.audit.at(-1)?.note).toContain('原受理人离岗转交');
}
test('负责人转交保留原因审计，新受理人继续检查权限与数据范围', transferCase);

/**
 * 验证完整批准后指派、汇报、退档和归档闭环。
 */
function archiveCase(): void {
  const config = seedConfig();
  const activity = instance(config, '0');
  approve(config, activity, 'u-chen');
  approve(config, activity, 'u-zhou');
  approve(config, activity, 'u-zhao');
  const version = activity.version;
  applyActivityAction(
    config,
    'u-zhao',
    activity,
    {
      expectedVersion: version,
      idempotencyKey: crypto.randomUUID(),
      action: 'assign',
      executor: 'u-su',
      comment: '负责现场实施并协调参会人员',
    },
    false,
  );
  activity.payload.start_at = new Date(Date.now() - 3600000).toISOString();
  applyActivityAction(
    config,
    'u-su',
    activity,
    { expectedVersion: version, idempotencyKey: crypto.randomUUID(), action: 'start', comment: '' },
    false,
  );
  applyActivityAction(
    config,
    'u-su',
    activity,
    {
      expectedVersion: version,
      idempotencyKey: crypto.randomUUID(),
      action: 'report',
      comment: '',
      report: {
        start: new Date(Date.now() - 3000000).toISOString(),
        end: new Date(Date.now() - 1000).toISOString(),
        people: 50,
        summary: '公开课与研讨全部完成，教学成果良好',
        spend: '1000.00',
        exception: '',
      },
    },
    false,
  );
  expect(activity.status).toBe('executing');
  expect(activity.report).toBeNull();
  expect(activity.executionRecords).toHaveLength(1);
  applyActivityAction(
    config,
    'u-su',
    activity,
    {
      expectedVersion: version,
      idempotencyKey: crypto.randomUUID(),
      action: 'execution-complete',
      comment: '',
      report: { ...activity.executionRecords![0]!, end: new Date().toISOString(), title: undefined },
    },
    false,
  );
  expect(activity.status).toBe('archive_draft');
  expect(
    /**
     * 检查缺少成果链接和附件时阻止档案提交。
     */ () =>
      applyActivityAction(
        config,
        'u-su',
        activity,
        {
          expectedVersion: version,
          idempotencyKey: crypto.randomUUID(),
          action: 'archive-submit',
          comment: '本次活动教学材料与成果已整理完成',
        },
        false,
      ),
  ).toThrow('请上传成果');
  applyActivityAction(
    config,
    'u-su',
    activity,
    {
      expectedVersion: version,
      idempotencyKey: crypto.randomUUID(),
      action: 'archive-submit',
      comment: '本次活动教学材料与成果已整理完成',
      url: 'https://example.com/results',
    },
    false,
  );
  applyActivityAction(
    config,
    'u-zhao',
    activity,
    {
      expectedVersion: version,
      idempotencyKey: crypto.randomUUID(),
      action: 'archive-approve',
      comment: '',
      checks: [true, true, true],
    },
    true,
  );
  expect(activity.status).toBe('archived');
  expect(activity.archive?.code).toBeDefined();
  expect(activityActions(config, 'u-lin', activity)).not.toContain('edit');
}
test('执行汇报和成果资料齐全后才能归档，归档后锁定', archiveCase);

/**
 * 验证取消审核冻结业务并可恢复原状态。
 */
function cancellationCase(): void {
  const config = seedConfig();
  const activity = instance(config, '0');
  approve(config, activity, 'u-chen');
  approve(config, activity, 'u-zhou');
  approve(config, activity, 'u-zhao');
  applyActivityAction(
    config,
    'u-lin',
    activity,
    {
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      action: 'cancel-request',
      comment: '学校计划调整需要取消',
    },
    false,
  );
  expect(activity.status).toBe('cancel_review');
  expect(activity.cancellation?.reviewer).toBe('u-chen');
  expect(activityActions(config, 'u-wang', activity)).not.toContain('assign');
  applyActivityAction(
    config,
    'u-chen',
    activity,
    {
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      action: 'cancel-reject',
      comment: '学校确认仍按原计划执行',
    },
    false,
  );
  expect(activity.status).toBe('ready_assign');
}
test('取消审核期间冻结指派，拒绝后恢复原状态', cancellationCase);
