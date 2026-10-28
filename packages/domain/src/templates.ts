import { z } from 'zod';
import type { CompanyConfig, FormDefinition, NodeDefinition } from './types';
import { configSchema, lifecycleSchema } from './schemas';
import { lifecycleOf, defaultRequestForm } from './lifecycle';
import { activeMember, findById, hasPermission, withinDepartment } from './permissions';
import { validateConfig } from './config';
import { instantiateWorkflow } from './workflow';
import { defaultApprovalPolicy } from './approval-rules';

export interface ActivityType {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sort: number;
}
export interface TemplateLayout {
  direction: 'TB' | 'LR';
  positions: Record<string, { x: number; y: number }>;
}
export interface TemplateDefinition {
  lifecycle?: import('./types').LifecycleDefinition;
  form?: FormDefinition;
  ratingEnabled?: boolean;
  name: string;
  activityTypeIds: string[];
  defaultForTypeIds: string[];
  departmentIds: string[];
  roleIds: string[];
  nodes: NodeDefinition[];
  layout: TemplateLayout;
}
export interface WorkflowTemplate {
  id: string;
  code: string;
  active: boolean;
  currentVersion: number;
  draftRevision: number;
  draft: TemplateDefinition;
  published: TemplateDefinition | null;
  updatedAt: string;
}
export interface TemplateRelease {
  templateId: string;
  version: number;
  definition: TemplateDefinition;
  form: FormDefinition;
  publishedBy: string;
  publishedAt: string;
}
export interface TemplateSummary {
  id: string;
  code: string;
  version: number;
  definition: TemplateDefinition;
  form: FormDefinition;
}
export interface TemplateSelection {
  activityTypeId: string;
  templateId: string;
  expectedTemplateVersion: number;
}

export const TEMPLATE_BOUNDARY_IDS: readonly string[] = ['stage:apply', 'stage:approved', 'stage:case-end', 'stage:business:assign', 'stage:business:execution', 'stage:business:archive_submit', 'stage:business:archive_review'];

const identifier = z.string().min(1).max(80);
export const templateDefinitionSchema = z
  .object({
    name: z.string().trim().min(1, '请填写模板名称').max(80),
    ratingEnabled: z.boolean().optional(),
    lifecycle: lifecycleSchema.optional(),
    form: configSchema.shape.form.transform(
      /** 将已严格校验的表单映射为共享领域类型。
       * @param form 已校验表单
       * @returns 冻结表单定义
       */ function definition(form): FormDefinition { return form; },
    ).optional(),
    activityTypeIds: z.array(identifier).max(30),
    defaultForTypeIds: z.array(identifier).max(30),
    departmentIds: z.array(identifier).max(200),
    roleIds: z.array(identifier).max(100),
    nodes: z.array(configSchema.shape.workflow.shape.nodes.element).max(80),
    layout: z
      .object({
        direction: z.enum(['TB', 'LR']),
        positions: z.record(
          identifier,
          z
            .object({
              x: z.number().finite().min(-100000).max(100000),
              y: z.number().finite().min(-100000).max(100000),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
export const templateSelectionSchema = z
  .object({
    activityTypeId: identifier,
    templateId: identifier,
    expectedTemplateVersion: z.number().int().positive(),
  })
  .strict();
export const templateWriteSchema = z
  .object({
    definition: templateDefinitionSchema,
    expectedDraftRevision: z.number().int().positive(),
    idempotencyKey: z.string().min(16).max(100),
  })
  .strict();
export const templateCreateSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_-]{2,59}$/),
    sourceId: identifier.optional(),
    firstNodeKind: z.enum(['approval', 'task', 'notice']).optional(),
    businessType: z.enum(['activity', 'general']).optional(),
    idempotencyKey: z.string().min(16).max(100),
  })
  .strict();
export const templateVersionCommandSchema = z
  .object({
    expectedDraftRevision: z.number().int().positive(),
    idempotencyKey: z.string().min(16).max(100),
  })
  .strict();
export const templateActiveSchema = templateVersionCommandSchema.extend({ active: z.boolean() });

/**
 * 将旧模板定义转换为独立编辑草稿，解除保护并补齐保守审批规则；历史发布版本保持原样。
 * @param definition 来源模板定义，可能来自旧草稿或发布版本
 * @returns 保留类型、依赖、受理与资料权限的可编辑副本，不修改来源快照
 */
export function editableTemplateDefinition(definition: TemplateDefinition): TemplateDefinition {
  const next = structuredClone(definition);
  for (const node of next.nodes) {
    delete node.protected;
    if (node.kind === 'approval' && !node.approvalPolicy) node.approvalPolicy = defaultApprovalPolicy();
  }
  return next;
}

/**
 * 按管理员选择生成首个业务节点，审批默认允许退回并关闭终止和评分。
 * @param kind 首个节点类型
 * @returns 使用对应默认受理规则的普通节点
 */
export function firstTemplateNode(kind: NodeDefinition['kind'] = 'approval'): NodeDefinition {
  return {
    id: 'n-first',
    label: { approval: '活动事项审核', task: '活动准备任务', notice: '活动事项知会' }[kind],
    kind,
    approvalPolicy: kind === 'approval' ? defaultApprovalPolicy() : undefined,
    deps: [],
    assignee: kind === 'approval' ? { type: 'manager', value: '' } : { type: 'role', value: 'coordinator' },
  };
}

/**
 * 判断申请人是否在模板授权范围内，不隐式授予业务权限。
 * @param config 当前组织与权限配置
 * @param actor 真实申请人
 * @param definition 模板定义
 * @param activityTypeId 可选活动类型
 * @returns 是否可选择模板
 */
export function canSelectTemplate(
  config: CompanyConfig,
  actor: string,
  definition: TemplateDefinition,
  activityTypeId?: string,
): boolean {
  const user = findById(config.users, actor);
  if (
    !user ||
    !activeMember(config, actor) ||
    !hasPermission(config, actor, 'activity:create') ||
    !hasPermission(config, actor, 'activity:read')
  )
    return false;
  if (activityTypeId && (lifecycleOf(definition).businessType === 'general' ? activityTypeId !== 'general' : !definition.activityTypeIds.includes(activityTypeId))) return false;
  if (
    definition.departmentIds.length &&
    !definition.departmentIds.some(
      /** 判断申请人是否在授权部门及下级中。
       * @param id 授权部门
       * @returns 是否覆盖申请人
       */ function contains(id) {
        return withinDepartment(config, user.department, id);
      },
    )
  )
    return false;
  if (
    definition.roleIds.length &&
    !definition.roleIds.some(
      /** 判断申请人是否具有授权角色。
       * @param id 角色标识
       * @returns 是否具有角色
       */ function contains(id) {
        return user.roles.includes(id);
      },
    )
  )
    return false;
  return true;
}

/**
 * 复制模板的可序列化数据，兼容前端嵌套响应式代理，并隔离发布快照与编辑上下文。
 * @param value 仅包含 JSON 字段的模板节点、表单或生命周期配置
 * @returns 不携带响应式代理的独立数据副本
 */
function cloneTemplateData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 将冻结表单、原发布节点和评分总开关组合为引擎上下文，兼容前端响应式输入且保留发布规则。
 * @param config 当前公司配置
 * @param definition 模板定义
 * @param form 发布时冻结表单
 * @returns 可复用校验与流程引擎的上下文
 */
export function templateContext(
  config: CompanyConfig,
  definition: TemplateDefinition,
  form: FormDefinition,
): CompanyConfig {
  return {
    ...config,
    form:
      lifecycleOf(definition).businessType === 'general'
        ? {
            ...cloneTemplateData(form.businessType === 'general' ? form : definition.form || defaultRequestForm()),
            businessType: 'general',
          }
        : form,
    workflow: {
      name: definition.name,
      nodes: cloneTemplateData(definition.nodes),
      ratingEnabled: definition.ratingEnabled,
      lifecycle: cloneTemplateData(lifecycleOf(definition)),
    },
  };
}

/**
 * 校验模板结构、活动类型、范围及所有分支的真实办理资格。
 * @param config 当前发布组织配置
 * @param definition 模板草稿
 * @param types 可用活动类型
 * @returns 可显示的错误集合，包含节点名称便于定位
 */
export function validateTemplate(
  config: CompanyConfig,
  definition: TemplateDefinition,
  types: ActivityType[],
): string[] {
  const errors = validateConfig(templateContext(config, definition, config.form), {
    requireProtectedApproval: false,
    requireActivityFields: lifecycleOf(definition).businessType === 'activity',
  });
  if (!definition.nodes.length) errors.push('请至少添加一个审批、任务或知会节点后再发布');
  for (const [label, ids] of [
    ['活动类型', definition.activityTypeIds],
    ['默认类型', definition.defaultForTypeIds],
    ['部门', definition.departmentIds],
    ['角色', definition.roleIds],
  ] as const)
    if (new Set(ids).size !== ids.length) errors.push(`${label}引用重复`);
  const lifecycle = lifecycleOf(definition);
  if (lifecycle.businessType === 'activity' && !definition.activityTypeIds.length) errors.push('活动模板请选择适用活动类型');
  if (lifecycle.businessType === 'general' && (definition.activityTypeIds.length || definition.defaultForTypeIds.length)) errors.push('通用申请模板不关联活动类型');
  if (lifecycle.businessType === 'general' && lifecycle.afterApproval !== 'complete') errors.push('通用申请仅支持审批通过后直接办结');
  for (const id of definition.activityTypeIds)
    if (!findById(types, id)?.active) errors.push('活动类型不存在或已停用');
  for (const id of definition.defaultForTypeIds)
    if (!definition.activityTypeIds.includes(id)) errors.push('默认类型必须属于适用类型');
  for (const id of definition.departmentIds)
    if (!findById(config.departments, id)?.active) errors.push('授权部门不存在或已停用');
  for (const id of definition.roleIds) if (!findById(config.roles, id)) errors.push('授权角色不存在');
  for (const node of definition.nodes)
    if (node.condition) {
      let field;
      for (const item of templateContext(config, definition, config.form).form.fields) if (item.key === node.condition.field) field = item;
      if (field?.type === 'select' && !field.options.includes(node.condition.value))
        errors.push(`${node.label}条件值不在${field.label}选项中`);
    }
  for (const node of definition.nodes)
    if (TEMPLATE_BOUNDARY_IDS.includes(node.id)) errors.push('业务节点不能使用系统起止标记的保留标识');
  for (const id of Object.keys(definition.layout.positions))
    if (!TEMPLATE_BOUNDARY_IDS.includes(id) && !findById(definition.nodes, id))
      errors.push('画布坐标引用已删除节点');
  const context = templateContext(config, definition, config.form);
  const forced = structuredClone(context);
  for (const node of forced.workflow.nodes) delete node.condition;
  let applicants = 0;
  for (const user of config.users) {
    if (!canSelectTemplate(config, user.id, definition)) continue;
    applicants++;
    const result = instantiateWorkflow(forced, {}, user.id, { requireApproval: false });
    for (const error of result.errors) errors.push(`${user.name}：${error}`);
  }
  if (!applicants) errors.push('授权范围内没有可发起活动的有效成员');
  return [...new Set(errors)];
}

/**
 * 检查同一活动类型与授权范围是否出现重复默认模板。
 * @param config 当前组织与权限
 * @param candidate 待发布定义
 * @param others 其他启用模板定义
 * @returns 默认模板冲突描述
 */
export function defaultTemplateConflicts(
  config: CompanyConfig,
  candidate: TemplateDefinition,
  others: TemplateDefinition[],
): string[] {
  const errors: string[] = [];
  for (const other of others)
    for (const id of candidate.defaultForTypeIds) {
      if (!other.defaultForTypeIds.includes(id)) continue;
      let overlap = !candidate.departmentIds.length || !other.departmentIds.length;
      for (const left of candidate.departmentIds)
        for (const right of other.departmentIds)
          if (withinDepartment(config, left, right) || withinDepartment(config, right, left)) overlap = true;
      if (overlap) errors.push(`活动类型${id}的默认模板与“${other.name}”覆盖范围冲突`);
    }
  return [...new Set(errors)];
}

export interface TemplateExecutionSummary {
  approvals: number;
  tasks: number;
  notices: number;
  message: string;
}

/**
 * 说明模板实际包含的办理类型，无审批时明确进入执行的条件。
 * @param nodes 模板业务节点
 * @returns 审批、任务和知会数量，以及面向申请人与管理员的流转说明
 */
export function templateExecutionSummary(nodes: NodeDefinition[], lifecycle?: import('./types').LifecycleDefinition): TemplateExecutionSummary {
  const approvals = nodes.filter((node) => node.kind === 'approval').length;
  const tasks = nodes.filter((node) => node.kind === 'task').length;
  const notices = nodes.filter((node) => node.kind === 'notice').length;
  const tail = lifecycleOf({ lifecycle }).afterApproval === 'complete' ? '全部生效必办节点完成后直接办结；知会不阻断。' : '全部生效必办节点完成后进入活动执行与归档子流程；知会不阻断。';
  const message = !nodes.length
    ? '请从开始节点添加一个业务节点，再检查并发布流程。'
    : approvals
      ? '审批和任务按前置关系办理。' + tail
      : tasks
        ? '本模板没有审批节点。' + tail
        : '本模板仅包含知会；提交后发送通知。' + tail;
  return { approvals, tasks, notices, message };
}
