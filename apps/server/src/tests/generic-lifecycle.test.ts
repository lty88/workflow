import { expect, test } from 'vitest';
import {
  activityActions,
  advanceWorkflow,
  applyActivityAction,
  defaultRequestForm,
  decideTask,
  firstTemplateNode,
  instantiateWorkflow,
  lifecycleOf,
  requestLifecycleState,
  seedConfig,
  synchronizeBusinessSubprocess,
  templateContext,
  templateDefinitionSchema,
  validateForm,
  validateTemplate,
} from '@workflow/domain';
import type {
  Activity,
  ActionCommand,
  CompanyConfig,
  TemplateDefinition,
  WorkflowTask,
} from '@workflow/domain';
import { templateEditorGraph } from '../../../web/src/components/templates/editor-model';
import { runtimeGraph } from '../../../web/src/components/graph/models';
import { saveActivity, loadActivity } from '../db/repository';
import type { Database } from '../db/repository';
import { listActivities } from '../services/list-service';
import { authorizeFileRead } from '../services/file-service';
import type { Pool } from 'mysql2/promise';

/** 构造普通申请或活动流程，复用相同引擎与组织权限，不连接数据库。
 * @param general 是否普通申请
 * @param direct 活动是否也配置为审批即办结
 * @returns 公司上下文、模板与已提交实例
 */
function fixture(general = true, direct = false) {
  const config = seedConfig();
  const definition: TemplateDefinition = {
    name: '生命周期测试',
    lifecycle: {
      businessType: general ? 'general' : 'activity',
      afterApproval: general || direct ? 'complete' : 'activity_standard',
      version: 1,
    },
    ...(general ? { form: defaultRequestForm() } : {}),
    nodes: [firstTemplateNode()],
    activityTypeIds: general ? [] : ['teaching'],
    defaultForTypeIds: [],
    departmentIds: [],
    roleIds: [],
    layout: { direction: 'TB', positions: {} },
  };
  const context = templateContext(config, definition, config.form);
  const plan = instantiateWorkflow(context, {}, 'u-lin', { requireApproval: false });
  expect(plan.errors).toEqual([]);
  const now = new Date().toISOString();
  const activity: Activity = {
    id: crypto.randomUUID(),
    code: 'OA-TEST',
    lifecycle: structuredClone(definition.lifecycle),
    name: '办公用品采购申请',
    applicant: 'u-lin',
    department: 'd1',
    status: 'approving',
    version: 1,
    revision: 1,
    structureRevision: 1,
    configVersion: 1,
    schema: context.form,
    payload: {
      request_title: '办公用品采购申请',
      request_reason: '教学资料整理',
      start_at: new Date(Date.now() - 60000).toISOString(),
    },
    nodes: plan.nodes,
    tasks: [],
    snapshots: [],
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
  return { config, definition, context, activity };
}
/** 完成首个审批，审批即办结或进入注册的活动子流程。
 * @param config 当前组织
 * @param activity 运行实例
 */
function approve(config: CompanyConfig, activity: Activity): void {
  const task = activity.tasks.find(
    /** 选择当前审批待办。
     * @param item 个人任务
     * @returns 是否审批任务
     */ function pending(item) {
      return item.status === 'pending';
    },
  )!;
  decideTask(config, task.assignee, activity, task.id, {
    decision: 'approve',
    comment: '',
    expectedTaskVersion: task.version,
    idempotencyKey: crypto.randomUUID(),
  });
}
/** 使用当前版本办理业务，服务端动作能力仍实时校验。
 * @param config 实时组织
 * @param activity 实例
 * @param actor 操作者
 * @param input 业务命令
 */
function act(
  config: CompanyConfig,
  activity: Activity,
  actor: string,
  input: Omit<ActionCommand, 'expectedVersion' | 'idempotencyKey' | 'comment'> & { comment?: string },
): void {
  applyActivityAction(
    config,
    actor,
    activity,
    { expectedVersion: activity.version, idempotencyKey: crypto.randomUUID(), comment: '', ...input },
    true,
  );
}
/** 普通OA审批通过直接办结，不产生执行或归档待办。 */
function directCase(): void {
  const { config, activity, definition } = fixture();
  expect(validateTemplate(config, definition, [])).toEqual([]);
  const form = validateForm(activity.schema, {
    request_title: '请假申请',
    request_reason: '事假',
    people: '-1',
  });
  expect(form.errors).toEqual([]);
  expect(form.payload).not.toHaveProperty('people');
  approve(config, activity);
  expect(activity.status).toBe('completed');
  expect(activity.completedAt).toBeTruthy();
  expect(activity.workflowOwnerId).toBeUndefined();
  expect(activity.nodes).toHaveLength(1);
  expect(
    activity.tasks.some(
      /** 检查不会产生隐藏后续待办。
       * @param task 任务
       * @returns 是否仍待处理
       */ function pending(task) {
        return task.status === 'pending';
      },
    ),
  ).toBe(false);
  expect(requestLifecycleState(activity)).toEqual({
    status: 'completed',
    approvalResult: 'approved',
    currentStage: null,
  });
  expect(activityActions(config, 'u-chen', activity)).not.toContain('assign');
  expect(
    /** 通用申请不能绕过动作授权调用执行指派。 */
    function forbidden() {
      act(config, activity, 'u-chen', { action: 'assign', executor: 'u-su', comment: '执行' });
    },
  ).toThrow();
}
test('普通申请独立表单，审批通过直接办结且无活动后续操作', directCase);

/** 活动也可以仅审批，策略随实例冻结不被模板草稿修改覆盖。 */
function frozenCase(): void {
  const { config, activity, definition } = fixture(false, true);
  definition.lifecycle!.afterApproval = 'activity_standard';
  approve(config, activity);
  expect(activity.status).toBe('completed');
  expect(lifecycleOf(activity).afterApproval).toBe('complete');
  expect(lifecycleOf({}).afterApproval).toBe('activity_standard');
}
test('可选接续方案冻结，活动仅审批与旧活动默认闭环均兼容', frozenCase);

/** 活动业务子流程复用节点和任务，汇报追加不推进，归档退回只重办归档段。 */
function activityCase(): void {
  const { config, activity } = fixture(false);
  approve(config, activity);
  expect(activity.status).toBe('ready_assign');
  expect(
    activity.nodes.filter(
      /** 收集注册业务步骤。
       * @param node 实例节点
       * @returns 是否业务节点
       */ function business(node) {
        return !!node.businessStage;
      },
    ),
  ).toHaveLength(4);
  const assignmentTask = activity.tasks.find(
    /** 找出业务待办，不能通过普通审批接口跳过业务校验。
     * @param task 个人任务
     * @returns 是否当前待办
     */ function pending(task) {
      return task.status === 'pending';
    },
  )!;
  expect(
    /** 普通任务完成接口不能代替真实指派。 */
    function bypass() {
      decideTask(config, assignmentTask.assignee, activity, assignmentTask.id, {
        decision: 'approve',
        comment: '',
        expectedTaskVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      });
    },
  ).toThrow();
  const count = activity.tasks.length;
  synchronizeBusinessSubprocess(config, activity, 'u-chen');
  expect(activity.tasks).toHaveLength(count);
  act(config, activity, 'u-chen', { action: 'assign', executor: 'u-su', comment: '负责组织实施' });
  expect(activity.status).toBe('ready_execute');
  act(config, activity, 'u-su', { action: 'start' });
  const report = {
    start: activity.actualStart,
    end: new Date().toISOString(),
    people: 20,
    summary: '课程研讨完成',
    spend: '0',
    exception: '',
  };
  const before = activity.tasks.length;
  act(config, activity, 'u-su', { action: 'report', report });
  act(config, activity, 'u-su', { action: 'report', report });
  expect(activity.status).toBe('executing');
  expect(activity.executionRecords).toHaveLength(2);
  expect(activity.tasks).toHaveLength(before);
  act(config, activity, 'u-su', { action: 'execution-complete', report });
  act(config, activity, 'u-su', {
    action: 'archive-submit',
    comment: '成果齐全',
    url: 'https://example.com/result',
  });
  act(config, activity, 'u-chen', { action: 'archive-return', comment: '请补充课堂照片' });
  const submit = activity.nodes.find(
    /** 找到成果提交步骤。
     * @param node 节点
     * @returns 是否成果提交
     */ function stage(node) {
      return node.businessStage === 'archive_submit';
    },
  )!;
  expect(submit.status).toBe('active');
  expect(submit.generation).toBe(2);
  synchronizeBusinessSubprocess(config, activity, 'u-chen');
  expect(submit.generation).toBe(2);
  act(config, activity, 'u-su', {
    action: 'archive-submit',
    comment: '已补充照片',
    url: 'https://example.com/result',
  });
  act(config, activity, 'u-chen', { action: 'archive-approve', checks: [true, true, true] });
  expect(activity.status).toBe('archived');
  expect(activity.completedAt).toBeTruthy();
  expect(requestLifecycleState(activity).status).toBe('completed');
  expect(
    activity.tasks.filter(
      /** 已归档不残留业务待办。
       * @param task 任务
       * @returns 是否待办
       */ function pending(task) {
        return task.status === 'pending';
      },
    ),
  ).toHaveLength(0);
}
test('活动履约真实任务闭环、汇报可追加、归档退回重办且同步幂等', activityCase);

/** 设计器与运行图根据同一策略展示真正结束点。 */
function graphCase(): void {
  for (const general of [true, false]) {
    const { config, context, activity } = fixture(general);
    const design = templateEditorGraph(context);
    expect(
      design.data.nodes!.some(
        /** 通用模板不出现强制执行步骤。
         * @param node 图节点
         * @returns 是否执行入口
         */ function business(node) {
          return node.id === 'stage:business:assign';
        },
      ),
    ).toBe(!general);
    approve(config, activity);
    const graph = runtimeGraph({ activity, participants: [] });
    expect(
      graph.data.nodes!.some(
        /** 画布包含真实整单结束标记。
         * @param node 图节点
         * @returns 是否结束点
         */ function end(node) {
          return node.id === 'stage:case-end';
        },
      ),
    ).toBe(true);
    expect(
      graph.data.nodes!.filter(
        /** 新活动显示真实业务任务而非再补一套重复节点。
         * @param node 图节点
         * @returns 是否真实指派步骤
         */ function assign(node) {
          return (
            node.id ===
            'runtime:' +
              activity.nodes.find(
                /** 定位实际指派节点。
                 * @param item 节点
                 * @returns 是否指派
                 */ function match(item) {
                  return item.businessStage === 'assign';
                },
              )?.id
          );
        },
      ),
    ).toHaveLength(general ? 0 : 1);
  }
}
test('模板和详情按同一生命周期展示结束点，业务节点不重复拼接', graphCase);

/** 未注册生命周期及不兼容的通用接续配置在模板启用前拒绝。 */
function validationCase(): void {
  const { config, definition } = fixture();
  definition.lifecycle!.afterApproval = 'activity_standard';
  expect(validateTemplate(config, definition, []).join()).toContain('通用申请仅支持');
  expect(
    templateDefinitionSchema.safeParse({
      ...definition,
      lifecycle: { businessType: 'general', afterApproval: 'unknown', version: 1 },
    }).success,
  ).toBe(false);
  definition.lifecycle!.afterApproval = 'complete';
  definition.form!.fields = definition.form!.fields.filter(
    /** 模拟错误删除公共标题字段。
     * @param field 申请字段
     * @returns 是否保留
     */ function keep(field) {
      return field.key !== 'request_title';
    },
  );
  expect(validateTemplate(config, definition, []).join()).toContain('request_title');
}
test('通用表单公共标题与注册接续方案受发布校验约束', validationCase);

/** 普通申请独立落表，调用既有仓储仍不会创建活动占位或执行记录。 */
async function storageCase(): Promise<void> {
  const { config, activity } = fixture();
  approve(config, activity);
  const queries: string[] = [];
  let data: Activity | undefined;
  /** 捕获真实仓储的SQL，读取时只提供独立通用申请记录。
   * @param sql SQL语句
   * @param values 绑定参数
   * @returns 受控数据库返回值
   */
  async function execute(sql: string, values: unknown[] = []) {
    queries.push(sql);
    if (sql.startsWith('INSERT INTO requests(')) data = JSON.parse(String(values[8]));
    if (sql.includes('SELECT data FROM requests')) return [[{ data }], []];
    if (sql.startsWith('SELECT')) return [[], []];
    return [{ affectedRows: 1 }, []];
  }
  const db = { execute } as unknown as Database;
  await saveActivity(db, activity, true);
  expect(
    queries.some(
      /** 原活动表不存放普通申请占位。
       * @param sql 查询语句
       * @returns 是否写活动
       */ function legacy(sql) {
        return /INSERT INTO activities|UPDATE activities/.test(sql);
      },
    ),
  ).toBe(false);
  expect(data).not.toHaveProperty('executor');
  expect(data!.status).toBe('completed');
  const restored = await loadActivity(db, activity.id);
  expect(restored!.lifecycle!.businessType).toBe('general');
  expect(restored!.executor).toBe('');
  expect(
    queries.some(
      /** 只对真实活动读取执行记录。
       * @param sql 查询语句
       * @returns 是否访问执行记录
       */ function execution(sql) {
        return sql.includes('FROM execution_records');
      },
    ),
  ).toBe(false);
}
test('通用申请独立存储且仓储兼容读取，不借用活动表', storageCase);

/** 验证任务范围成员在跨业务列表中的授权SQL，以及通用申请附件经相同服务读出。 */
async function adapterCase(): Promise<void> {
  const { config, activity } = fixture();
  config.roles.push({
    id: 'general-reviewer',
    name: '通用审批人',
    permissions: ['activity:read', 'approval:decide'],
    pages: [],
    scope: 'tasks',
  });
  config.users.find(
    /** 让审批人只拥有参与任务范围，避免全公司权限掩盖目录关联遗漏。
     * @param user 系统成员
     * @returns 是否当前审批人
     */ function reviewer(user) {
      return user.id === 'u-chen';
    },
  )!.roles = ['general-reviewer'];
  const statements: string[] = [];
  const file = {
    id: 'general-file',
    activity_id: activity.id,
    uploader_id: 'u-lin',
    name: '采购清单.pdf',
    storage_key: 'a'.repeat(64),
    mime: 'application/pdf',
    size: 1024,
    stage: 'application',
    node_id: null,
    field_key: null,
    context_id: null,
    action_key: null,
    access_rule: null,
    download_rule: null,
    created_at: '2026-10-27 08:00:00.000',
  };
  /** 同时提供目录及附件所需查询，未知SQL立即失败，禁止测试访问真实数据库。
   * @param sql 生成的参数化语句
   * @returns 模拟驱动行集合
   */
  async function execute(sql: string): Promise<[unknown, unknown[]]> {
    statements.push(sql);
    if (sql.includes('FROM configuration'))
      return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
    if (sql.includes('SELECT COUNT(*)')) return [[{ total: 1 }], []];
    if (sql.includes('SELECT a.data')) return [[{ data: structuredClone(activity) }], []];
    if (sql.startsWith('SELECT activity_id,data'))
      return [[{ activity_id: activity.id, data: activity.nodes[0] }], []];
    if (sql.startsWith('SELECT activity_id,storage_key FROM files')) return [[], []];
    if (sql.startsWith('SELECT activity_id,storage_key FROM request_files')) return [[file], []];
    if (sql.includes('SELECT data FROM activities')) return [[], []];
    if (sql.includes('SELECT data FROM requests')) return [[{ data: structuredClone(activity) }], []];
    if (sql.includes('SELECT data FROM request_nodes'))
      return [
        activity.nodes.map(
          /** 转换存储节点查询形状。
           * @param data 节点
           * @returns 数据库行
           */ function row(data) {
            return { data };
          },
        ),
        [],
      ];
    if (sql.includes('SELECT data FROM request_tasks'))
      return [
        activity.tasks.map(
          /** 转换存储任务查询形状。
           * @param data 任务
           * @returns 数据库行
           */ function row(data) {
            return { data };
          },
        ),
        [],
      ];
    if (sql.includes('SELECT data FROM audit_events')) return [[], []];
    if (sql.includes('FROM request_files')) return [[file], []];
    if (sql.startsWith('INSERT INTO audit_events')) return [{affectedRows:1},[]];
    throw new Error('未声明SQL：' + sql);
  }
  /** 模拟事务边界，不访问外部连接。 */
  async function noop(): Promise<void> {}
  /** 结束内存连接，无外部副作用。 */
  function release(): void {}
  /** 提供附件服务的一致事务连接。
   * @returns 内存连接
   */
  async function getConnection() {
    return { execute, beginTransaction: noop, commit: noop, rollback: noop, release };
  }
  const pool = { execute, getConnection } as unknown as Pool;
  const list = await listActivities(
    pool,
    'u-chen',
    { q: '', status: '', scope: 'tasks', page: 1, pageSize: 15 },
    false,
    true,
  );
  expect(list.items[0]!.businessType).toBe('general');
  const count = statements.find(
    /** 找到包含授权条件的计数查询。
     * @param sql SQL文本
     * @returns 是否计数
     */ function count(sql) {
      return sql.startsWith('SELECT COUNT(*)');
    },
  )!;
  expect(count).toContain('FROM requests');
  expect(count.match(/FROM request_nodes/g)!.length).toBeGreaterThanOrEqual(2);
  expect(count).toContain('FROM request_tasks');
  await expect(authorizeFileRead(pool, 'u-lin', file.id)).rejects.toThrow('无该附件下载权限');
  config.roles.find(
    /** 为申请人显式授予下载能力，核对新适配器仍遵守原权限码。
     * @param role 角色
     * @returns 是否申请人角色
     */ function applicant(role) { return role.id === 'applicant'; },
  )!.permissions.push('file:download');
  const result = await authorizeFileRead(pool, 'u-lin', file.id);
  expect(result).toEqual({ storageKey: file.storage_key, name: file.name, mime: file.mime });
}
test('通用申请任务范围查询覆盖新表，附件定位与读取沿用统一授权', adapterCase);
