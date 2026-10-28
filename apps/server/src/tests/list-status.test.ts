import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { expect, test } from 'vitest';
import { STATUSES, defaultRequestForm, listQuerySchema, seedConfig, withActivityDeletion } from '@workflow/domain';
import type { Activity, ActivityStatus, WorkflowNode } from '@workflow/domain';
import { listActivities } from '../services/list-service';
import type { Database } from '../db/repository';

const GENERAL_STATUSES: ActivityStatus[] = [
  'draft',
  'approving',
  'needs_info',
  'withdrawn',
  'rejected',
  'completed',
];

/** 在内存SQL引擎建立两类申请的全部有效状态，执行真实分页SQL，不连接项目数据库。
 * @returns 只读服务适配器、基础记录总数和资源关闭能力
 */
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const config = withActivityDeletion(seedConfig());
  sqlite.exec(`CREATE TABLE configuration(id TEXT,published TEXT,draft TEXT,revision INTEGER,draft_revision INTEGER);
    CREATE TABLE activities(id TEXT,code TEXT,applicant_id TEXT,department_id TEXT,status TEXT,version INTEGER,data TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE requests AS SELECT * FROM activities WHERE 0;
    CREATE TABLE workflow_nodes(id TEXT,activity_id TEXT,node_key TEXT,status TEXT,generation INTEGER,data TEXT);
    CREATE TABLE request_nodes AS SELECT * FROM workflow_nodes WHERE 0;
    CREATE TABLE workflow_tasks(id TEXT,activity_id TEXT,node_id TEXT,assignee_id TEXT,generation INTEGER,status TEXT,version INTEGER,data TEXT);
    CREATE TABLE request_tasks AS SELECT * FROM workflow_tasks WHERE 0;`);
  sqlite
    .prepare('INSERT INTO configuration VALUES (?,?,?,?,?)')
    .run('company', JSON.stringify(config), JSON.stringify(config), 1, 1);
  /** 模拟MySQL的JSON拆引号，SQLite提取结果已是标量。
   * @param value JSON提取结果
   * @returns 原始标量或空值
   */
  function unquote(value: unknown): string | number | null {
    return typeof value === 'string' || typeof value === 'number' ? value : null;
  }
  /** 为个人任务及角色范围提供JSON包含语义，覆盖真实列表权限子查询。
   * @param source JSON数组
   * @param needle JSON标量
   * @returns 是否包含，使用SQL整数布尔值
   */
  function contains(source: unknown, needle: unknown): number {
    if (typeof source !== 'string' || typeof needle !== 'string') return 0;
    const values: unknown = JSON.parse(source);
    return Array.isArray(values) && values.includes(JSON.parse(needle)) ? 1 : 0;
  }
  sqlite.function('JSON_UNQUOTE', unquote);
  sqlite.function('JSON_CONTAINS', contains);
  /** 写入一个申请、历史参与节点及实际待办；逻辑删除只标记相应记录。
   * @param status 业务状态
   * @param general 是否通用审批
   * @param suffix 唯一后缀
   * @param applicant 发起人
   * @param deleted 是否已逻辑删除
   */
  function insert(
    status: ActivityStatus,
    general = false,
    suffix = '',
    applicant = 'u-lin',
    deleted = false,
  ): void {
    const id = `${general ? 'general' : 'activity'}-${status}${suffix}`;
    const node: WorkflowNode = {
      id: `node-${id}`,
      key: 'review',
      kind: 'approval',
      label: '部门审批',
      deps: [],
      status: status === 'approving' ? 'active' : 'invalidated',
      generation: 1,
      applicationRevision: 1,
      assignees: ['u-chen'],
      assigneeRule: { type: 'manager', value: '' },
    };
    const activity: Activity = {
      id,
      code: id,
      name: id,
      applicant,
      department: applicant === 'u-qiao' ? 'd2' : 'd1',
      status,
      version: 1,
      revision: 1,
      structureRevision: 1,
      configVersion: 1,
      schema: general ? defaultRequestForm() : config.form,
      payload: general
        ? { request_title: id, request_reason: '申请事由' }
        : { activity_name: id, budget: '0' },
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
      createdAt: '2026-10-28T00:00:00.000Z',
      updatedAt: '2026-10-28T00:00:00.000Z',
      ...(general ? { lifecycle: { businessType: 'general', afterApproval: 'complete', version: 1 } } : {}),
      ...(deleted ? { deleted: { at: '2026-10-28T01:00:00.000Z', by: 'u-admin', reason: '重复记录' } } : {}),
    };
    const root = general ? 'requests' : 'activities';
    sqlite
      .prepare(`INSERT INTO ${root} VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id,
        id,
        applicant,
        activity.department,
        status,
        1,
        JSON.stringify(activity),
        activity.createdAt,
        activity.updatedAt,
        deleted ? activity.deleted!.at : null,
      );
    const nodes = general ? 'request_nodes' : 'workflow_nodes';
    sqlite
      .prepare(`INSERT INTO ${nodes} VALUES (?,?,?,?,?,?)`)
      .run(node.id, id, node.key, node.status, 1, JSON.stringify(node));
    if (status === 'approving') {
      const tasks = general ? 'request_tasks' : 'workflow_tasks';
      sqlite
        .prepare(`INSERT INTO ${tasks} VALUES (?,?,?,?,?,?,?,?)`)
        .run(
          `task-${id}`,
          id,
          node.id,
          'u-chen',
          1,
          'pending',
          1,
          JSON.stringify({
            id: `task-${id}`,
            nodeId: node.id,
            assignee: 'u-chen',
            status: 'pending',
            generation: 1,
            version: 1,
            comment: '',
          }),
        );
    }
  }
  for (const status of Object.keys(STATUSES) as ActivityStatus[]) insert(status);
  for (const status of GENERAL_STATUSES) insert(status, true);
  insert('rejected', true, '-deleted', 'u-lin', true);
  insert('draft', false, '-deleted', 'u-lin', true);
  insert('rejected', false, '-other', 'u-qiao');
  /** 只允许列表服务读取内存SQL，参数绑定与真实查询完全共用。
   * @param sql 服务生成的只读SQL
   * @param params 已绑定查询参数
   * @returns 驱动兼容行集合
   */
  async function execute(sql: string, params: unknown[] = []): Promise<[unknown[], unknown[]]> {
    if (!sql.trimStart().startsWith('SELECT')) throw new Error('列表查询不应写入数据');
    return [sqlite.prepare(sql).all(...(params as SQLInputValue[])), []];
  }
  /** 释放内存数据库，无持久化副作用。 */
  function close(): void {
    sqlite.close();
  }
  return {
    db: { execute } as unknown as Database,
    total: Object.keys(STATUSES).length + GENERAL_STATUSES.length,
    close,
  };
}

/** 默认工单覆盖全部状态，已终止仍可查看，逻辑删除隐藏，发起人权限范围不扩大。 */
async function allStatesCase(): Promise<void> {
  const memory = fixture();
  try {
    const input = listQuerySchema.parse({ pageSize: 100 });
    const own = await listActivities(memory.db, 'u-lin', input, false, true);
    const admin = await listActivities(memory.db, 'u-admin', input, false, true);
    expect(own.total).toBe(memory.total);
    expect(own.items).toHaveLength(memory.total);
    expect(admin.total).toBe(memory.total + 1);
    expect(
      own.items.find(
        /** 终止记录保留真实业务状态和类型。
         * @param item 返回工单
         * @returns 是否通用终止单
         */ function terminated(item) {
          return item.id === 'general-rejected';
        },
      ),
    ).toMatchObject({ status: 'rejected', businessType: 'general' });
    expect(
      own.items.some(
        /** 他人的记录与已删除记录不出现在发起人查询中。
         * @param item 工单
         * @returns 是否越权或已删除
         */ function hidden(item) {
          return item.id.endsWith('-other') || item.id.endsWith('-deleted');
        },
      ),
    ).toBe(false);
    for (const status of Object.keys(STATUSES) as ActivityStatus[]) {
      const result = await listActivities(
        memory.db,
        'u-lin',
        listQuerySchema.parse({ status, pageSize: 100 }),
        false,
        true,
      );
      expect(result.total).toBe(GENERAL_STATUSES.includes(status) ? 2 : 1);
      expect(
        result.items.every(
          /** 返回记录全部符合显式状态过滤。
           * @param item 工单
           * @returns 是否目标状态
           */ function match(item) {
            return item.status === status;
          },
        ),
      ).toBe(true);
    }
  } finally {
    memory.close();
  }
}
test('全部工单覆盖两类申请所有状态，终止可查、逻辑删除隐藏且身份范围有效', allStatesCase);

/** 组合筛选与导出使用相同SQL条件；旧活动无生命周期标记仍属于活动申请。 */
async function filtersCase(): Promise<void> {
  const memory = fixture();
  try {
    for (const businessType of ['activity', 'general'] as const) {
      const input = listQuerySchema.parse({
        businessType,
        status: 'rejected',
        scope: 'mine',
        q: 'rejected',
        pageSize: 100,
      });
      const result = await listActivities(memory.db, 'u-lin', input, false, true);
      const exported = await listActivities(memory.db, 'u-lin', input, true, true);
      expect(result.total).toBe(1);
      expect(result.items[0]!.id).toBe(`${businessType}-rejected`);
      expect(
        exported.items.map(
          /** 对比导出与列表的授权记录标识。
           * @param item 工单
           * @returns 标识
           */ function id(item) {
            return item.id;
          },
        ),
      ).toEqual([`${businessType}-rejected`]);
    }
  } finally {
    memory.close();
  }
}
test('业务类型、终止状态、本人及关键词筛选与导出一致，兼容旧活动', filtersCase);

/** 终止后离开待办属于正常语义，全部工单保留历史；档案仍只接受已归档状态。 */
async function specializedListsCase(): Promise<void> {
  const memory = fixture();
  try {
    const tasks = await listActivities(
      memory.db,
      'u-chen',
      listQuerySchema.parse({ scope: 'tasks', pageSize: 100 }),
    );
    expect(
      tasks.items.map(
        /** 待办只包含个人当前可办理审批。
         * @param item 工单
         * @returns 状态
         */ function status(item) {
          return item.status;
        },
      ),
    ).toEqual(['approving', 'approving']);
    const terminated = await listActivities(
      memory.db,
      'u-chen',
      listQuerySchema.parse({ scope: 'tasks', status: 'rejected' }),
    );
    expect(terminated.total).toBe(0);
    const archives = await listActivities(memory.db, 'u-lin', listQuerySchema.parse({ scope: 'archives' }));
    expect(archives.items).toHaveLength(1);
    expect(archives.items[0]!.status).toBe('archived');
  } finally {
    memory.close();
  }
}
test('我的待办排除终止等不可办理状态，活动档案保持归档范围', specializedListsCase);
