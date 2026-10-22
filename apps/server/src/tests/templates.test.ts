import { expect, test } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';
import {
  seedConfig,
  canSelectTemplate,
  defaultTemplateConflicts,
  instantiateWorkflow,
  templateContext,
  validateTemplate,
} from '@workflow/domain';
import { initialTemplates, INITIAL_ACTIVITY_TYPES } from '../db/template-migration';
import { selectTemplate } from '../services/template-service';
import { changeConnection, insertNode, removeNode } from '../../../web/src/components/templates/editing';

/** 核对4套种子模板复用原有公司流程，且全部通过真实组织的受理资格校验。 */
function seedTemplatesCase(): void {
  const config = seedConfig();
  const entries = initialTemplates(config);
  expect(entries).toHaveLength(4);
  expect(entries[0]!.definition.nodes).toEqual(config.workflow.nodes);
  for (const entry of entries)
    expect(validateTemplate(config, entry.definition, INITIAL_ACTIVITY_TYPES)).toEqual([]);
}
test('初始4模板结构和受理资格有效', seedTemplatesCase);

/** 核对标准模板的金额边界、线上简化路线、收费低预算复核以及二部负责人。 */
function routingCase(): void {
  const config = seedConfig();
  const entries = initialTemplates(config);
  for (const budget of ['9999.99', '10000', '10000.01']) {
    const result = instantiateWorkflow(
      templateContext(config, entries[0]!.definition, config.form),
      { budget },
      'u-lin',
    );
    expect(result.errors).toEqual([]);
    expect(result.nodes[3]!.status === 'skipped').toBe(budget === '9999.99');
  }
  const online = instantiateWorkflow(
    templateContext(config, entries[1]!.definition, config.form),
    { budget: '8000' },
    'u-qiao',
  );
  expect(online.nodes).toHaveLength(2);
  expect(online.nodes[0]!.assignees).toEqual(['u-du']);
  const training = instantiateWorkflow(
    templateContext(config, entries[2]!.definition, config.form),
    { budget: '8000' },
    'u-lin',
  );
  expect(training.nodes[3]!.status).not.toBe('skipped');
}
test('不同模板、金额临界值和组织负责人生成不同路线', routingCase);

/** 核对模板定义、不同活动节点和历史定义快照互相隔离，后续编辑不改已生成实例。 */
function instanceIsolationCase(): void {
  const config = seedConfig();
  const definition = initialTemplates(config)[0]!.definition;
  const snapshot = structuredClone(definition);
  const first = instantiateWorkflow(
    templateContext(config, definition, config.form),
    { budget: '12000' },
    'u-lin',
  );
  const second = instantiateWorkflow(
    templateContext(config, definition, config.form),
    { budget: '12000' },
    'u-qiao',
  );
  first.nodes[1]!.label = '本场临时调整';
  definition.nodes[1]!.label = '后续模板新版本';
  expect(second.nodes[1]!.label).toBe('教研方案审核');
  expect(snapshot.nodes[1]!.label).toBe('教研方案审核');
  expect(first.nodes[0]!.id).not.toBe(second.nodes[0]!.id);
  expect(first.nodes[0]!.origin).toBe('template');
}
test('模板草稿、发布快照和不同活动实例互相隔离', instanceIsolationCase);

/** 核对模板选择不提升角色权限，并按部门、活动类型与角色范围共同过滤。 */
function scopeCase(): void {
  const config = seedConfig();
  const definition = initialTemplates(config)[0]!.definition;
  definition.departmentIds = ['d1'];
  expect(canSelectTemplate(config, 'u-lin', definition, 'teaching')).toBe(true);
  expect(canSelectTemplate(config, 'u-qiao', definition, 'teaching')).toBe(false);
  expect(canSelectTemplate(config, 'u-admin', definition, 'teaching')).toBe(false);
  expect(canSelectTemplate(config, 'u-lin', definition, 'online')).toBe(false);
  definition.roleIds = ['director'];
  expect(canSelectTemplate(config, 'u-lin', definition, 'teaching')).toBe(false);
}
test('模板类型、部门、角色和操作权限共同限制可选范围', scopeCase);

/** 核对默认推荐冲突覆盖部门层级，分离部门的默认模板可以共存。 */
function defaultsCase(): void {
  const config = seedConfig();
  const left = initialTemplates(config)[0]!.definition;
  const right = structuredClone(left);
  left.departmentIds = ['research'];
  right.departmentIds = ['d1'];
  expect(defaultTemplateConflicts(config, left, [right]).length).toBeGreaterThan(0);
  left.departmentIds = ['d2'];
  expect(defaultTemplateConflicts(config, left, [right])).toEqual([]);
}
test('默认推荐冲突能识别上级部门范围重叠', defaultsCase);

/** 核对不合法条件、自环与必要审核缺失均无法通过发布校验。 */
function invalidCase(): void {
  const config = seedConfig();
  const original = initialTemplates(config)[0]!.definition;
  const cycle = structuredClone(original);
  cycle.nodes[0]!.deps = [cycle.nodes[3]!.id];
  expect(validateTemplate(config, cycle, INITIAL_ACTIVITY_TYPES).join('')).toContain('循环');
  const missing = structuredClone(original);
  missing.nodes[0]!.protected = false;
  expect(validateTemplate(config, missing, INITIAL_ACTIVITY_TYPES).join('')).toContain('部门');
  const condition = structuredClone(original);
  condition.nodes[1]!.condition = { field: 'delivery_mode', operator: 'eq', value: '不存在的举办方式' };
  expect(validateTemplate(config, condition, INITIAL_ACTIVITY_TYPES).join('')).toContain('选项');
  const owner = structuredClone(original);
  owner.nodes[1]!.assignee = { type: 'user', value: 'u-su' };
  expect(validateTemplate(config, owner, INITIAL_ACTIVITY_TYPES).join('')).toContain('权限');
}
test('模板发布拒绝循环、缺失必要审核、无效条件和无审批资格受理人', invalidCase);

/** 核对前后插与并行新增正确重接依赖，删除继承前置，且不改变源模板。 */
function editingCase(): void {
  const original = initialTemplates(seedConfig())[0]!.definition;
  const after = insertNode(original, 'n-department', 'task', 'after');
  expect(after.definition.nodes[1]!.deps).toEqual([after.id]);
  expect(after.definition.nodes[2]!.deps).toEqual([after.id]);
  const before = insertNode(original, 'n-academic', 'approval', 'before');
  expect(before.definition.nodes[1]!.deps).toEqual([before.id]);
  const parallel = insertNode(original, 'n-academic', 'task', 'parallel');
  expect(parallel.definition.nodes[3]!.deps).toContain(parallel.id);
  expect(removeNode(after.definition, after.id).nodes).toEqual(original.nodes);
  expect(original.nodes).toHaveLength(4);
  /** 尝试建立从后继回到入口的循环依赖，用于验证结构保护。 */
  function addCycle(): void {
    changeConnection(original, { source: 'n-director', target: 'n-department' });
  }
  expect(addCycle).toThrow('循环');
  const unlinked = changeConnection(original, { source: 'n-academic', target: 'n-director' }, true);
  expect(unlinked.nodes[3]!.deps).toEqual(['n-marketing']);
  expect(original.nodes[3]!.deps).toHaveLength(2);
}
test('设计器前插后插并行、删节点和连线均保持独立可校验结构', editingCase);

/**
 * 构造只读模板数据连接，测试真实选择服务的版本、启停与授权规则。
 * @param active 模板是否启用
 * @param version 当前发布指针
 * @returns 数据库替身及SQL记录
 */
function selectionDatabase(active = true, version = 1) {
  const config = seedConfig();
  const definition = initialTemplates(config)[0]!.definition;
  const statements: string[] = [];
  /**
   * 返回最小模板查询结果，未知SQL即失败，避免隐藏新增数据库依赖。
   * @param sql 参数化查询
   * @returns 模拟驱动的行与字段
   */
  async function execute(sql: string): Promise<[unknown[], unknown[]]> {
    statements.push(sql);
    if (sql.includes('FROM activity_types')) return [INITIAL_ACTIVITY_TYPES, []];
    if (sql.includes('FROM workflow_templates WHERE'))
      return [
        [
          {
            id: 'wf-standard',
            code: 'standard',
            active,
            current_version: version,
            draft_revision: 1,
            draft: definition,
            published: definition,
            updated_at: '',
          },
        ],
        [],
      ];
    if (sql.includes('FROM workflow_template_releases'))
      return [
        [
          {
            definition,
            form_snapshot: { ...config.form, name: '冻结申请表' },
            published_by: 'u-admin',
            published_at: '',
          },
        ],
        [],
      ];
    throw new Error('未声明的SQL：' + sql);
  }
  return { db: { execute } as unknown as PoolConnection, config, statements };
}

/** 核对选择模板持有发布指针共享锁，使用冻结表单而非实时全局表单。 */
async function selectionCase(): Promise<void> {
  const mock = selectionDatabase();
  const result = await selectTemplate(mock.db, mock.config, 'u-lin', {
    activityTypeId: 'teaching',
    templateId: 'wf-standard',
    expectedTemplateVersion: 1,
  });
  expect(result.form.name).toBe('冻结申请表');
  expect(mock.statements.join(' ')).toContain('FOR SHARE');
  expect(result.version).toBe(1);
}
test('申请选择锁定发布指针并使用版本冻结表单', selectionCase);

/** 核对模板版本冲突、停用与活动类型越权都在真实选择服务中被拒绝。 */
async function selectionFailuresCase(): Promise<void> {
  const changed = selectionDatabase(true, 2);
  await expect(
    selectTemplate(changed.db, changed.config, 'u-lin', {
      activityTypeId: 'teaching',
      templateId: 'wf-standard',
      expectedTemplateVersion: 1,
    }),
  ).rejects.toMatchObject({ code: 'TEMPLATE_VERSION_CONFLICT' });
  const disabled = selectionDatabase(false);
  await expect(
    selectTemplate(disabled.db, disabled.config, 'u-lin', {
      activityTypeId: 'teaching',
      templateId: 'wf-standard',
      expectedTemplateVersion: 1,
    }),
  ).rejects.toMatchObject({ code: 'TEMPLATE_UNAVAILABLE' });
  const forbidden = selectionDatabase();
  await expect(
    selectTemplate(forbidden.db, forbidden.config, 'u-lin', {
      activityTypeId: 'online',
      templateId: 'wf-standard',
      expectedTemplateVersion: 1,
    }),
  ).rejects.toMatchObject({ code: 'TEMPLATE_FORBIDDEN' });
}
test('版本变化、停用模板与越权模板均阻止提交', selectionFailuresCase);
