import { readFile } from 'node:fs/promises';
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { ActivityType, CompanyConfig, NodeDefinition, TemplateDefinition } from '@workflow/domain';
import { findById, hasPermission, templateDefinitionSchema, validateTemplate } from '@workflow/domain';
import { loadConfig, query, transaction } from './repository';

export const INITIAL_ACTIVITY_TYPES: ActivityType[] = [
  { id: 'teaching', code: 'teaching', name: '教研交流', active: true, sort: 1 },
  { id: 'reading', code: 'reading', name: '阅读项目', active: true, sort: 2 },
  { id: 'online', code: 'online', name: '线上研讨', active: true, sort: 3 },
  { id: 'training', code: 'training', name: '收费培训', active: true, sort: 4 },
  { id: 'internal', code: 'internal', name: '内部分享', active: true, sort: 5 },
];

/**
 * 生成基于现有公司流程的默认模板和三套可复用场景模板。
 * @param config 现有发布配置
 * @returns 稳定迁移标识与模板定义
 */
export function initialTemplates(
  config: CompanyConfig,
): Array<{ id: string; code: string; definition: TemplateDefinition }> {
  const departmentIds = new Set<string>();
  for (const member of config.users)
    if (
      hasPermission(config, member.id, 'activity:create') &&
      hasPermission(config, member.id, 'activity:read')
    )
      departmentIds.add(member.department);
  let department: NodeDefinition | undefined;
  for (const node of config.workflow.nodes)
    if (node.protected && node.assignee.type === 'manager') department = node;
  department ||= {
    id: 'n-department',
    label: '部门初审',
    kind: 'approval',
    deps: [],
    assignee: { type: 'manager', value: '' },
    protected: true,
  };
  const base = structuredClone(department);
  base.deps = [];
  delete base.condition;
  const academic: NodeDefinition = {
    id: 'n-academic',
    label: '教研方案审核',
    kind: 'approval',
    deps: [base.id],
    assignee: { type: 'role', value: 'academic' },
  };
  const marketing: NodeDefinition = {
    id: 'n-marketing',
    label: '营销与校方确认',
    kind: 'approval',
    deps: [base.id],
    assignee: { type: 'role', value: 'marketing' },
  };
  const director: NodeDefinition = {
    id: 'n-director',
    label: '院负责人复核',
    kind: 'approval',
    deps: [academic.id, marketing.id],
    assignee: { type: 'role', value: 'director' },
  };
  const entries = [
    {
      id: 'wf-standard',
      code: 'standard',
      name: '标准教研活动',
      types: ['teaching', 'reading'],
      nodes: config.workflow.nodes,
    },
    { id: 'wf-online', code: 'online', name: '线上公益研讨', types: ['online'], nodes: [base, academic] },
    {
      id: 'wf-training',
      code: 'training',
      name: '收费培训',
      types: ['training'],
      nodes: [base, academic, marketing, director],
    },
    {
      id: 'wf-internal',
      code: 'internal',
      name: '内部分享',
      types: ['internal'],
      nodes: [
        base,
        {
          id: 'n-materials',
          label: '分享资料准备',
          kind: 'task' as const,
          deps: [base.id],
          assignee: { type: 'role' as const, value: 'coordinator' },
        },
      ],
    },
  ];
  const result = [];
  for (const entry of entries)
    result.push({
      id: entry.id,
      code: entry.code,
      definition: templateDefinitionSchema.parse({
        name: entry.name,
        activityTypeIds: entry.types,
        defaultForTypeIds: entry.types,
        departmentIds: [...departmentIds],
        roleIds: [],
        nodes: structuredClone(entry.nodes),
        layout: { direction: 'TB', positions: {} },
      }),
    });
  return result;
}

/**
 * 显式执行增量迁移：创建模板表、添加活动索引字段、一次性导入模板，保留密码和旧实例。
 * @param pool 项目数据库连接池
 */
export async function migrateTemplates(pool: Pool): Promise<void> {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';')) if (statement.trim()) await pool.query(statement);
  const columns = await query<{ COLUMN_NAME: string }>(
    pool,
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='activities'",
  );
  const existing = new Set<string>();
  for (const row of columns) existing.add(row.COLUMN_NAME);
  for (const [name, type] of [
    ['activity_type_id', 'VARCHAR(80) NULL'],
    ['template_id', 'VARCHAR(80) NULL'],
    ['template_version', 'INT NULL'],
  ])
    if (!existing.has(name!)) await pool.query(`ALTER TABLE activities ADD COLUMN ${name} ${type}`);
  /**
   * 锁住公司配置后原子导入一次性初始模板，重复迁移不改已有模板。
   * @param connection 迁移事务连接
   */
  async function migrate(connection: PoolConnection): Promise<void> {
    const config = (await loadConfig(connection, 'update')).published;
    const applied = await query<{ version: number }>(
      connection,
      'SELECT version FROM schema_migrations WHERE version=2',
    );
    if (applied.length) return;
    await connection.execute("INSERT IGNORE INTO template_catalog_lock(id) VALUES ('catalog')");
    for (const type of INITIAL_ACTIVITY_TYPES)
      await connection.execute(
        'INSERT IGNORE INTO activity_types(id,code,name,active,sort) VALUES (?,?,?,?,?)',
        [type.id, type.code, type.name, type.active, type.sort],
      );
    for (const entry of initialTemplates(config)) {
      const present = await query<{ id: string }>(
        connection,
        'SELECT id FROM workflow_templates WHERE id=? OR code=?',
        [entry.id, entry.code],
      );
      if (present.length) continue;
      const errors = validateTemplate(config, entry.definition, INITIAL_ACTIVITY_TYPES);
      // 原有组织若已改造，保留可修复草稿；默认公司流程也需通过校验后才可用于新申请。
      const version = errors.length ? 0 : 1;
      await connection.execute(
        'INSERT INTO workflow_templates(id,code,active,current_version,draft,draft_revision,published,created_by) VALUES (?,?,TRUE,?,?,1,?,?)',
        [
          entry.id,
          entry.code,
          version,
          JSON.stringify(entry.definition),
          version ? JSON.stringify(entry.definition) : null,
          'migration',
        ],
      );
      if (version) {
        await connection.execute(
          'INSERT INTO workflow_template_releases(template_id,version,definition,form_snapshot,published_by) VALUES (?,1,?,?,?)',
          [entry.id, JSON.stringify(entry.definition), JSON.stringify(config.form), 'migration'],
        );
        for (const id of entry.definition.activityTypeIds)
          if (findById(INITIAL_ACTIVITY_TYPES, id))
            await connection.execute(
              'INSERT INTO activity_type_templates(activity_type_id,template_id,is_default) VALUES (?,?,TRUE)',
              [id, entry.id],
            );
      }
    }
    await connection.execute('INSERT INTO schema_migrations(version) VALUES (2)');
  }
  await transaction(pool, migrate);
}
