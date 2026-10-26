import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import type {
  Activity,
  NodeDefinition,
  TemplateDefinition,
  WorkflowNode,
  WorkflowTask,
  WorkflowTemplate,
} from '@workflow/domain';
import { defaultValues, seedConfig } from '@workflow/domain';
import { INITIAL_ACTIVITY_TYPES } from '../db/template-migration';
import { createTemplate, publishTemplate } from '../services/template-service';
import { submitActivity } from '../services/activity-service';

/**
 * 构造只用于模板创建、发布、提交的内存事务连接，未知SQL直接失败。
 * @returns 连接池替身、申请准备、保存结果和通知查询能力
 */
function memoryPool() {
  const config = seedConfig();
  let template: Record<string, unknown> | null = null;
  let release: Record<string, unknown> | null = null;
  let activity: Activity | null = null;
  const nodes = new Map<string, WorkflowNode>();
  const tasks = new Map<string, WorkflowTask>();
  const events: unknown[][] = [];
  /**
   * 按SQL读写模板、活动、节点和可靠通知，提供空执行记录及附件以真实执行提交校验。
   * @param sql 参数化语句
   * @param values 绑定值
   * @returns MySQL驱动形状的查询或更新结果
   */
  async function execute(sql: string, values: unknown[] = []): Promise<[unknown, unknown[]]> {
    if (sql.includes('FROM execution_records') || sql.includes('FROM files')) return [[], []];
    if (sql.includes('FROM configuration'))
      return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
    if (sql.includes('FROM template_catalog_lock')) return [[{ id: 'catalog' }], []];
    if (sql.includes('FROM activity_types')) return [structuredClone(INITIAL_ACTIVITY_TYPES), []];
    if (sql.includes('FROM workflow_templates')) return [template ? [template] : [], []];
    if (sql.includes('FROM workflow_template_releases')) return [release ? [release] : [], []];
    if (sql.startsWith('INSERT INTO workflow_templates')) {
      template = {
        id: values[0],
        code: values[1],
        active: true,
        current_version: 0,
        draft_revision: 1,
        draft: JSON.parse(String(values[2])),
        published: null,
        updated_at: '',
      };
    } else if (sql.startsWith('INSERT INTO workflow_template_releases')) {
      release = {
        definition: JSON.parse(String(values[2])),
        form_snapshot: JSON.parse(String(values[3])),
        published_by: values[4],
        published_at: '',
      };
    } else if (sql.startsWith('UPDATE workflow_templates SET published=')) {
      template!.published = JSON.parse(String(values[0]));
      template!.current_version = values[1];
      template!.draft_revision = Number(template!.draft_revision) + 1;
    } else if (sql.includes('SELECT data FROM activities')) {
      return [activity ? [{ data: structuredClone(activity) }] : [], []];
    } else if (sql.includes('SELECT data FROM workflow_nodes')) {
      return [[...nodes.values()].map((data) => ({ data: structuredClone(data) })), []];
    } else if (sql.includes('SELECT data FROM workflow_tasks')) {
      return [[...tasks.values()].map((data) => ({ data: structuredClone(data) })), []];
    } else if (sql.includes('SELECT data FROM audit_events')) {
      return [[], []];
    } else if (sql.startsWith('UPDATE activities SET')) {
      activity = JSON.parse(String(values[3]));
    } else if (sql.startsWith('INSERT INTO workflow_nodes')) {
      nodes.set(String(values[0]), JSON.parse(String(values[5])));
    } else if (sql.startsWith('INSERT INTO workflow_tasks')) {
      tasks.set(String(values[0]), JSON.parse(String(values[7])));
    } else if (sql.startsWith('INSERT IGNORE INTO outbox_events')) {
      events.push(values);
    } else if (
      ![
        'INSERT IGNORE INTO idempotency_records',
        'UPDATE idempotency_records',
        'INSERT INTO audit_events',
        'INSERT IGNORE INTO audit_events',
        'DELETE FROM activity_type_templates',
        'INSERT INTO activity_type_templates',
        'DELETE FROM workflow_edges',
        'INSERT INTO workflow_edges',
      ].some((prefix) => sql.startsWith(prefix))
    )
      throw new Error('未声明SQL：' + sql);
    return [{ affectedRows: 1 }, []];
  }
  /** 开始内存事务，测试不访问真实数据库。 */
  async function beginTransaction(): Promise<void> {}
  /** 提交内存事务，不触发外部副作用。 */
  async function commit(): Promise<void> {}
  /** 标记失败路径，不提交到真实存储。 */
  async function rollback(): Promise<void> {}
  /** 释放内存连接，无外部资源。 */
  function releaseConnection(): void {}
  const connection = { execute, beginTransaction, commit, rollback, release: releaseConnection };
  /**
   * 提供服务层事务所需的内存连接。
   * @returns 受控内存连接
   */
  async function getConnection() {
    return connection;
  }
  /**
   * 用已发布模板准备完整活动草稿，供真实提交服务校验。
   * @param value 新发布模板
   * @param overrides 覆盖默认时间、费用等申请字段，用于提交边界场景
   */
  function prepare(value: WorkflowTemplate, overrides: Record<string, string> = {}): void {
    const payload = {
      ...defaultValues(config.form),
      activity_name: '首节点流转校验',
      start_at: new Date(Date.now() + 86400000).toISOString(),
      end_at: new Date(Date.now() + 172800000).toISOString(),
      location: '树人实验学校',
      background: '开展教研业务交流',
      agenda: '公开课和课堂交流',
      people: '50',
      contact: '联系人',
      contact_info: '13800000001',
      arranger: '安排人',
      arranger_info: '13800000002',
      receiver: '接收人',
      receiver_info: '13800000003',
      expert_fee: '0',
      conference_fee: '0',
      travel_fee: '0',
      budget: '0',
      ...overrides,
    };
    activity = {
      id: 'a-submit',
      code: 'HD-SUBMIT',
      applicant: 'u-lin',
      department: 'd1',
      name: payload.activity_name,
      status: 'draft',
      version: 1,
      structureRevision: 1,
      revision: 0,
      configVersion: 1,
      schema: config.form,
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      activityTypeId: value.published!.activityTypeIds[0],
      templateId: value.id,
      templateVersion: value.currentVersion,
    };
  }
  /**
   * 读取真实服务保存的主单和通知结果。
   * @returns 活动、节点、任务、通知与原始发布定义
   */
  function result() {
    return {
      activity,
      nodes: [...nodes.values()],
      tasks: [...tasks.values()],
      events,
      published: template?.published as TemplateDefinition,
    };
  }
  return { pool: { getConnection } as unknown as Pool, prepare, result };
}

/** 核对真实创建、发布、提交服务接受三种首节点，知会写入可靠投递并通知流程负责人。 */
async function lifecycleCase(): Promise<void> {
  for (const kind of ['approval', 'task', 'notice'] as NodeDefinition['kind'][]) {
    const memory = memoryPool();
    const created = await createTemplate(memory.pool, 'u-admin', {
      code: 'flexible-' + kind,
      firstNodeKind: kind,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(created.draft.nodes[0]!.kind).toBe(kind);
    expect(created.draft.nodes[0]).not.toHaveProperty('protected');
    const published = await publishTemplate(memory.pool, 'u-admin', created.id, {
      expectedDraftRevision: created.draftRevision,
      idempotencyKey: crypto.randomUUID(),
    });
    memory.prepare(published);
    await submitActivity(memory.pool, 'u-lin', 'a-submit', 1, crypto.randomUUID(), published.currentVersion);
    const saved = memory.result();
    expect(saved.activity!.status).toBe(kind === 'notice' ? 'ready_assign' : 'approving');
    expect(saved.tasks.length).toBeGreaterThan(0);
    expect(saved.tasks.every((task) => task.status === (kind === 'notice' ? 'completed' : 'pending'))).toBe(
      true,
    );
    expect(
      saved.events.some((event) => String(event[1]).startsWith(kind === 'notice' ? 'notice:' : 'task:')),
    ).toBe(true);
    expect(saved.activity!.snapshots[0]!.workflow[0]!.kind).toBe(kind);
    expect(saved.published.nodes[0]!.kind).toBe(kind);
    if (kind === 'notice') expect(saved.events.some((event) => event[3] === 'u-wang')).toBe(true);
  }
}
test('真实服务贯通三种首节点创建、发布、提交，知会可靠投递且不形成待办', lifecycleCase);

/** 核对填写耗时和历史补录均可提交，服务端仍按费用明细重新计算超过一亿元的预算。 */
async function lenientSubmissionCase(): Promise<void> {
  const now = Date.now();
  for (const elapsed of [5 * 60000, 2 * 86400000]) {
    const memory = memoryPool();
    const created = await createTemplate(memory.pool, 'u-admin', {
      code: 'lenient-submission',
      firstNodeKind: 'approval',
      idempotencyKey: crypto.randomUUID(),
    });
    const published = await publishTemplate(memory.pool, 'u-admin', created.id, {
      expectedDraftRevision: created.draftRevision,
      idempotencyKey: crypto.randomUUID(),
    });
    const start = new Date(now - elapsed).toISOString();
    const end = new Date(now - elapsed + 3600000).toISOString();
    memory.prepare(published, {
      start_at: start,
      end_at: end,
      expert_fee: '50',
      conference_fee: '100000000',
      travel_fee: '60',
      budget: '1',
    });
    await submitActivity(memory.pool, 'u-lin', 'a-submit', 1, crypto.randomUUID(), published.currentVersion);
    const saved = memory.result().activity!;
    expect(saved.status).toBe('approving');
    expect(saved.payload.start_at).toBe(start);
    expect(saved.payload.end_at).toBe(end);
    expect(saved.payload.budget).toBe('100000110.00');
    expect(saved.snapshots[0]!.payload.budget).toBe('100000110.00');
  }
}
test('真实提交服务允许填表耗时及历史补录，预算超过原上限仍按明细保存', lenientSubmissionCase);
