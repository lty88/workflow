import { z } from 'zod';
import type { CompanyConfig, FormDefinition, NodeDefinition } from './types';
import { configSchema } from './schemas';
import { activeMember, findById, hasPermission, withinDepartment } from './permissions';
import { validateConfig } from './config';
import { instantiateWorkflow } from './workflow';

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

const identifier = z.string().min(1).max(80);
export const templateDefinitionSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    activityTypeIds: z.array(identifier).min(1).max(30),
    defaultForTypeIds: z.array(identifier).max(30),
    departmentIds: z.array(identifier).max(200),
    roleIds: z.array(identifier).max(100),
    nodes: configSchema.shape.workflow.shape.nodes,
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
  if (activityTypeId && !definition.activityTypeIds.includes(activityTypeId)) return false;
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
 * 将冻结表单与模板流程组合为现有引擎上下文，实时组织保持不变。
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
  return { ...config, form, workflow: { name: definition.name, nodes: definition.nodes } };
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
  const errors = validateConfig(templateContext(config, definition, config.form));
  for (const [label, ids] of [
    ['活动类型', definition.activityTypeIds],
    ['默认类型', definition.defaultForTypeIds],
    ['部门', definition.departmentIds],
    ['角色', definition.roleIds],
  ] as const)
    if (new Set(ids).size !== ids.length) errors.push(`${label}引用重复`);
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
      for (const item of config.form.fields) if (item.key === node.condition.field) field = item;
      if (field?.type === 'select' && !field.options.includes(node.condition.value))
        errors.push(`${node.label}条件值不在${field.label}选项中`);
    }
  if (
    !definition.nodes.some(
      /** 确认不可跳过的部门负责人审批。
       * @param node 模板节点
       * @returns 是否为必要部门初审
       */ function required(node) {
        return (
          node.protected && node.kind === 'approval' && node.assignee.type === 'manager' && !node.condition
        );
      },
    )
  )
    errors.push('必须保留无条件的部门负责人初审');
  for (const id of Object.keys(definition.layout.positions))
    if (!findById(definition.nodes, id)) errors.push('画布坐标引用已删除节点');
  const context = templateContext(config, definition, config.form);
  const forced = structuredClone(context);
  for (const node of forced.workflow.nodes) delete node.condition;
  let applicants = 0;
  for (const user of config.users) {
    if (!canSelectTemplate(config, user.id, definition)) continue;
    applicants++;
    const result = instantiateWorkflow(forced, {}, user.id);
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
