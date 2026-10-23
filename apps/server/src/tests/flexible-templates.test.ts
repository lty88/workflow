import { expect, test } from 'vitest';
import type { Activity, NodeDefinition, TemplateDefinition } from '@workflow/domain';
import {
  advanceWorkflow,
  decideTask,
  editableTemplateDefinition,
  firstTemplateNode,
  instantiateWorkflow,
  seedConfig,
  templateContext,
  templateDefinitionSchema,
  validateTemplate,
} from '@workflow/domain';
import { initialTemplates, INITIAL_ACTIVITY_TYPES } from '../db/template-migration';
import { insertNode, removeNode } from '../../../web/src/components/templates/editing';
import { templatePositionKey } from '../../../web/src/components/graph/positioning';
import { templateEditorGraph } from '../../../web/src/components/templates/editor-model';
import { loadTemplate } from '../db/template-repository';
import type { Database } from '../db/repository';

/**
 * 构造单节点普通模板，用真实种子组织校验权限。
 * @param kind 首节点类型
 * @returns 可编辑模板
 */
function definition(kind: NodeDefinition['kind']): TemplateDefinition {
  const value = editableTemplateDefinition(initialTemplates(seedConfig())[0]!.definition);
  value.nodes = [firstTemplateNode(kind)];
  return value;
}
/**
 * 使用真实模板引擎生成待激活活动，不访问数据库。
 * @param value 模板定义
 * @returns 流程活动
 */
function instance(value: TemplateDefinition): Activity {
  const config = seedConfig();
  const plan = instantiateWorkflow(templateContext(config, value, config.form), {}, 'u-lin', {
    requireApproval: false,
  });
  expect(plan.errors).toEqual([]);
  return {
    id: 'a-flexible',
    code: 'HD-FLEXIBLE',
    applicant: 'u-lin',
    department: 'd1',
    name: '灵活流程',
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
/** 核对三种首节点均可发布，解锁草稿不会改变发布快照。 */
function editableCase(): void {
  for (const kind of ['approval', 'task', 'notice'] as const) {
    const value = definition(kind);
    expect(value.nodes[0]!.kind).toBe(kind);
    expect(value.nodes[0]).not.toHaveProperty('protected');
    expect(validateTemplate(seedConfig(), value, INITIAL_ACTIVITY_TYPES)).toEqual([]);
  }
  const published = initialTemplates(seedConfig())[0]!.definition;
  const before = JSON.stringify(published);
  const draft = editableTemplateDefinition(published);
  expect(draft.nodes.every((node) => node.protected === undefined)).toBe(true);
  draft.nodes[0]!.kind = 'task';
  expect(JSON.stringify(published)).toBe(before);
}
test('三种普通首节点均可发布，旧默认锁定仅从独立草稿中移除', editableCase);
/** 核对空草稿可保存不可发布，删除最后节点后可从开始重新添加。 */
function emptyCase(): void {
  const value = definition('task');
  const empty = removeNode(value, value.nodes[0]!.id);
  expect(templateDefinitionSchema.safeParse(empty).success).toBe(true);
  expect(validateTemplate(seedConfig(), empty, INITIAL_ACTIVITY_TYPES).join()).toContain('至少添加');
  const added = insertNode(empty, 'stage:apply', 'notice', 'after');
  expect(added.definition.nodes).toHaveLength(1);
  expect(added.definition.nodes[0]!.deps).toEqual([]);
  const before = insertNode(value, 'stage:apply', 'task', 'after');
  expect(before.definition.nodes.find((node) => node.id === value.nodes[0]!.id)!.deps).toEqual([before.id]);
  expect(value.nodes[0]!.deps).toEqual([]);
}
test('空草稿可保存不可发布，最后节点删除后仍可重新新增', emptyCase);
/** 核对任务完成才继续，后置知会自动完成而不产生人工待办。 */
function taskCase(): void {
  const value = definition('task');
  value.nodes.push({ ...firstTemplateNode('notice'), id: 'notice-after', deps: [value.nodes[0]!.id] });
  const activity = instance(value);
  advanceWorkflow(activity);
  expect(activity.status).toBe('approving');
  expect(activity.nodes[1]!.status).toBe('waiting');
  const pending = activity.tasks.find((task) => task.status === 'pending')!;
  decideTask(seedConfig(), pending.assignee, activity, pending.id, {
    decision: 'approve',
    comment: '准备材料已经提交',
    expectedTaskVersion: pending.version,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(activity.status).toBe('ready_assign');
  expect(activity.nodes[1]!.status).toBe('completed');
  expect(
    activity.tasks.some((task) => task.nodeId === activity.nodes[1]!.id && task.status === 'completed'),
  ).toBe(true);
  expect(activity.tasks.some((task) => task.status === 'pending')).toBe(false);
}
test('任务流程等待完成，后置知会自动完成并进入待指派', taskCase);
/** 核对纯知会立即进入待指派，知会首节点不会阻断后续审批。 */
function noticeCase(): void {
  const onlyNotice = instance(definition('notice'));
  const created = advanceWorkflow(onlyNotice);
  expect(onlyNotice.status).toBe('ready_assign');
  expect(created.length).toBeGreaterThan(0);
  expect(created.every((task) => task.status === 'completed')).toBe(true);
  expect(advanceWorkflow(onlyNotice)).toEqual([]);
  const value = definition('notice');
  value.nodes.push({ ...firstTemplateNode('approval'), id: 'review-after', deps: [value.nodes[0]!.id] });
  const activity = instance(value);
  advanceWorkflow(activity);
  expect(activity.nodes.map((node) => node.status)).toEqual(['completed', 'active']);
  expect(activity.status).toBe('approving');
}
test('纯知会自动完成，知会首节点不阻断后续审批', noticeCase);
/** 核对放开首节点后自审、受理资格和全部条件跳过仍然会被拦截。 */
function guardsCase(): void {
  const config = seedConfig();
  const value = definition('approval');
  value.nodes[0]!.assignee = { type: 'user', value: 'u-lin' };
  expect(
    instantiateWorkflow(templateContext(config, value, config.form), {}, 'u-lin', {
      requireApproval: false,
    }).errors.join(),
  ).toContain('自审');
  value.nodes = [firstTemplateNode('task')];
  value.nodes[0]!.assignee = { type: 'user', value: 'u-admin' };
  expect(
    instantiateWorkflow(templateContext(config, value, config.form), {}, 'u-lin', {
      requireApproval: false,
    }).errors.join(),
  ).toContain('权限');
  value.nodes = [
    { ...firstTemplateNode('notice'), condition: { field: 'budget', operator: 'gte', value: '1000' } },
  ];
  expect(
    instantiateWorkflow(templateContext(config, value, config.form), { budget: '0' }, 'u-lin', {
      requireApproval: false,
    }).errors.join(),
  ).toContain('没有生效流程节点');
  expect(
    instantiateWorkflow(templateContext(config, definition('task'), config.form), {}, 'u-lin').errors.join(),
  ).toContain('至少需要一个生效审核');
}
test('保留自审、权限、空执行分支保护，并兼容旧公司流程校验', guardsCase);
/** 核对系统锚点只展示在图中，知会不作为完成前的必办叶子。 */
function graphCase(): void {
  const config = seedConfig();
  const value = definition('task');
  value.nodes.push({ ...firstTemplateNode('notice'), id: 'notice', deps: [value.nodes[0]!.id] });
  const before = JSON.stringify(value);
  const model = templateEditorGraph(templateContext(config, value, config.form));
  expect(model.data.nodes).toHaveLength(4);
  expect(model.data.nodes?.filter((node) => node.data?.boundary)).toHaveLength(2);
  expect(
    model.data.edges?.some((edge) => edge.source === 'workflow:n-first' && edge.target === 'stage:approved'),
  ).toBe(true);
  expect(
    model.data.edges?.some((edge) => edge.source === 'workflow:notice' && edge.target === 'stage:approved'),
  ).toBe(false);
  expect(JSON.stringify(value)).toBe(before);
  value.nodes = [];
  expect(templateEditorGraph(templateContext(config, value, config.form)).data.nodes).toHaveLength(2);
}
test('展示起止边界且不写入业务定义，知会不阻断完成', graphCase);
/** 核对真实仓储读取时解锁旧草稿，原始发布版本保持不变。 */
async function repositoryCase(): Promise<void> {
  const published = initialTemplates(seedConfig())[0]!.definition;
  /**
   * 返回带旧保护标记的模板记录。
   * @returns 模拟数据库行与字段
   */
  async function execute() {
    return [
      [
        {
          id: 'wf-old',
          code: 'old',
          active: true,
          current_version: 1,
          draft_revision: 2,
          draft: published,
          published,
          updated_at: '',
        },
      ],
      [],
    ];
  }
  const template = (await loadTemplate({ execute } as unknown as Database, 'wf-old'))!;
  expect(template.draft.nodes[0]).not.toHaveProperty('protected');
  expect(template.published!.nodes[0]!.protected).toBe(true);
  expect(published.nodes[0]!.protected).toBe(true);
}
test('仓储读取旧模板时解锁草稿且保留发布快照', repositoryCase);

/** 核对系统起止坐标可保存并通过发布校验，业务节点和未知展示阶段仍各自受约束。 */
function boundaryPositionsCase(): void {
  const config = seedConfig();
  const value = definition('approval');
  value.layout.positions = {
    'stage:apply': { x: 100, y: -200 },
    'stage:approved': { x: 100, y: 900 },
    'n-first': { x: 100, y: 300 },
  };
  const restored = templateDefinitionSchema.parse(JSON.parse(JSON.stringify(value)));
  expect(restored.layout.positions).toEqual(value.layout.positions);
  expect(validateTemplate(config, restored, INITIAL_ACTIVITY_TYPES)).toEqual([]);
  const graph = templateEditorGraph(templateContext(config, restored, config.form));
  const keys = graph.data.nodes!.map(templatePositionKey);
  expect(keys).toEqual(['stage:apply', 'n-first', 'stage:approved']);
  expect(templatePositionKey({ id: 'stage:execute', data: { kind: 'stage', boundary: true } })).toBe('');
  expect(templatePositionKey({ id: 'stage:apply', data: { kind: 'stage' } })).toBe('');
  expect(
    templatePositionKey({ id: 'dept:company', data: { kind: 'department', businessId: 'company' } }),
  ).toBe('');
  restored.layout.positions['stage:unknown'] = { x: 0, y: 0 };
  expect(validateTemplate(config, restored, INITIAL_ACTIVITY_TYPES).join()).toContain(
    '画布坐标引用已删除节点',
  );
  delete restored.layout.positions['stage:unknown'];
  restored.nodes[0]!.id = 'stage:apply';
  expect(validateTemplate(config, restored, INITIAL_ACTIVITY_TYPES).join()).toContain('保留标识');
}
test('系统起止节点坐标可序列化和发布，其他阶段仍禁止保存布局', boundaryPositionsCase);
