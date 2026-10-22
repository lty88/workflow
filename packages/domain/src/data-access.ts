import type {
  Activity,
  CompanyConfig,
  DataAccessRule,
  FileRecord,
  FormField,
  Permission,
  Role,
  WorkflowNode,
} from './types';
import {
  activeMember,
  canReadActivity,
  findById,
  hasPermission,
  rolesFor,
  withinDepartment,
} from './permissions';

export const SHARED_ACCESS: DataAccessRule = { mode: 'shared', roleIds: [], userIds: [] };
export const NODE_PRIVATE_ACCESS: DataAccessRule = {
  mode: 'restricted',
  roleIds: [],
  userIds: [],
  nodeAssignees: true,
};

/**
 * 判断单个授权角色的数据范围，避免宽范围普通角色扩大另一角色的敏感权限。
 * @param config 当前组织
 * @param actor 当前成员
 * @param activity 活动
 * @param role 提供授权的角色
 * @returns 角色范围是否覆盖活动
 */
function roleCovers(config: CompanyConfig, actor: string, activity: Activity, role: Role): boolean {
  const user = findById(config.users, actor);
  if (!user) return false;
  if (role.scope === 'all') return true;
  if (role.scope === 'self') return activity.applicant === actor;
  if (role.scope === 'department') return activity.department === user.department;
  if (role.scope === 'department_tree') return withinDepartment(config, activity.department, user.department);
  return (
    activity.executor === actor ||
    activity.cancellation?.reviewer === actor ||
    activity.nodes.some(
      /**
       * 判断角色的待办范围是否包含活动。
       * @param node 实例节点
       * @returns 是否参与该节点
       */
      function assigned(node) {
        return node.assignees.includes(actor);
      },
    )
  );
}

/**
 * 按授予该权限的同一角色范围判断敏感阅读、导出或附件下载资格。
 * @param config 当前组织
 * @param actor 成员标识
 * @param activity 授权目标
 * @param permission 独立权限码
 * @returns 当前有效授权是否覆盖目标
 */
export function hasScopedDataPermission(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  permission: Permission,
): boolean {
  if (!activeMember(config, actor) || !canReadActivity(config, actor, activity)) return false;
  for (const role of rolesFor(config, actor))
    if (
      role.permissions.includes(permission) &&
      role.permissions.includes('activity:read') &&
      roleCovers(config, actor, activity, role)
    )
      return true;
  return false;
}

/**
 * 使用实时组织和转交状态确认节点受理人，撤销角色或调整部门负责人后即时失效。
 * @param config 当前组织
 * @param actor 当前成员
 * @param activity 活动及任务
 * @param node 节点
 * @returns 是否仍有节点受理资格
 */
export function isCurrentNodeReader(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  node: WorkflowNode,
): boolean {
  if (!activeMember(config, actor) || !node.assignees.includes(actor)) return false;
  if (
    node.kind !== 'notice' &&
    !hasPermission(config, actor, node.kind === 'approval' ? 'approval:decide' : 'task:complete')
  )
    return false;
  for (const task of activity.tasks)
    if (
      task.nodeId === node.id &&
      task.assignee === actor &&
      task.delegated &&
      task.generation === node.generation &&
      task.status !== 'cancelled'
    )
      return true;
  if (node.assigneeRule.type === 'user') return node.assigneeRule.value === actor;
  if (node.assigneeRule.type === 'manager')
    return findById(config.departments, activity.department)?.manager === actor;
  return findById(config.users, actor)?.roles.includes(node.assigneeRule.value) || false;
}

/**
 * 判断显式内容受众，不隐式给予系统管理员敏感阅读资格。
 * @param config 当前组织
 * @param actor 当前成员
 * @param activity 所属活动
 * @param rule 内容规则
 * @param node 可选所属节点
 * @returns 是否命中受众
 */
export function audienceAllows(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  rule: DataAccessRule,
  node?: WorkflowNode,
): boolean {
  if (!activeMember(config, actor)) return false;
  if (rule.mode === 'shared') return true;
  const user = findById(config.users, actor)!;
  if (rule.userIds.includes(actor)) return true;
  for (const id of rule.roleIds) if (user.roles.includes(id) && findById(config.roles, id)) return true;
  if (rule.applicant && activity.applicant === actor) return true;
  if (rule.executor && activity.executor === actor) return true;
  if (rule.departmentManager && findById(config.departments, activity.department)?.manager === actor)
    return true;
  return !!rule.nodeAssignees && !!node && isCurrentNodeReader(config, actor, activity, node);
}

/**
 * 判断节点内部材料读取，旧节点默认仅当前受理人及获得独立授权的领导可读。
 * @param config 当前组织
 * @param actor 当前成员
 * @param activity 活动
 * @param node 节点
 * @returns 是否可以查看内部内容
 */
export function canReadNodeContent(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  node: WorkflowNode,
): boolean {
  return (
    canReadActivity(config, actor, activity) &&
    (hasScopedDataPermission(config, actor, activity, 'activity:sensitive:read') ||
      audienceAllows(config, actor, activity, node.access || NODE_PRIVATE_ACCESS, node))
  );
}

/**
 * 获取冻结字段和当前同键字段的共同约束，当前收紧立即生效，放宽不改变旧快照。
 * @param config 当前配置
 * @param field 冻结字段
 * @returns 需要同时满足的字段定义
 */
export function fieldConstraints(config: CompanyConfig, field: FormField): FormField[] {
  const current = config.form.fields.find(
    /**
     * 按稳定字段键查找当前权限。
     * @param item 当前字段
     * @returns 是否同键
     */
    function same(item) {
      return item.key === field.key;
    },
  );
  const constraints = current && current !== field ? [field, current] : [field];
  for (const access of field.accessConstraints || [])
    constraints.push({ ...field, access, accessConstraints: undefined });
  return constraints;
}

/**
 * 判断字段是否属于受限信息。
 * @param config 当前配置
 * @param field 冻结字段
 * @returns 是否存在受限读取规则
 */
export function isSensitiveField(config: CompanyConfig, field: FormField): boolean {
  for (const item of fieldConstraints(config, field))
    if (item.access?.read.mode === 'restricted') return true;
  return false;
}

/**
 * 判断字段读取或编辑，写入必须同时有原文阅读资格。
 * @param config 当前配置
 * @param actor 当前成员
 * @param activity 活动
 * @param field 冻结字段
 * @param write 是否判断字段编辑
 * @returns 是否可以读取原文或写入
 */
export function canAccessField(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  field: FormField,
  write = false,
): boolean {
  if (!canReadActivity(config, actor, activity)) return false;
  const full = hasScopedDataPermission(config, actor, activity, 'activity:sensitive:read');
  for (const item of fieldConstraints(config, field)) {
    if (!full && !audienceAllows(config, actor, activity, item.access?.read || SHARED_ACCESS)) return false;
    if (write && !audienceAllows(config, actor, activity, item.access?.write || SHARED_ACCESS)) return false;
  }
  return true;
}

/**
 * 判断附件可见性，文件自行设置的规则与节点规则取交集。
 * @param config 当前组织
 * @param actor 当前成员
 * @param activity 活动
 * @param file 附件元数据
 * @returns 是否可见附件名称与内容
 */
export function canReadFile(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  file: FileRecord,
): boolean {
  if (file.activityId !== activity.id || !canReadActivity(config, actor, activity)) return false;
  const node = file.nodeId ? findById(activity.nodes, file.nodeId) : undefined;
  if ((file.stage === 'node' || file.nodeId) && (!node || !canReadNodeContent(config, actor, activity, node)))
    return false;
  return (
    hasScopedDataPermission(config, actor, activity, 'activity:sensitive:read') ||
    audienceAllows(config, actor, activity, file.access || SHARED_ACCESS, node)
  );
}

/**
 * 判断独立下载授权，拥有敏感阅读权限不会自动获得受限附件下载权。
 * @param config 当前组织
 * @param actor 当前成员
 * @param activity 活动
 * @param file 附件
 * @returns 是否允许下载
 */
export function canDownloadFile(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  file: FileRecord,
): boolean {
  if (
    !canReadFile(config, actor, activity, file) ||
    !hasScopedDataPermission(config, actor, activity, 'file:download')
  )
    return false;
  const node = file.nodeId ? findById(activity.nodes, file.nodeId) : undefined;
  const override =
    hasScopedDataPermission(config, actor, activity, 'activity:sensitive:read') &&
    hasScopedDataPermission(config, actor, activity, 'activity:sensitive:export');
  if (override) return true;
  if (
    node &&
    !audienceAllows(config, actor, activity, node.downloadAccess || node.access || NODE_PRIVATE_ACCESS, node)
  )
    return false;
  return audienceAllows(config, actor, activity, file.downloadAccess || file.access || SHARED_ACCESS, node);
}

/**
 * 校验授权引用和受众是否可解析，供配置及上传共用。
 * @param config 当前组织
 * @param rule 待保存规则
 * @param label 提示所属对象
 * @returns 可展示的引用错误
 */
export function validateDataAccessRule(
  config: CompanyConfig,
  rule: DataAccessRule | undefined,
  label: string,
): string[] {
  if (!rule || rule.mode === 'shared') return [];
  const errors: string[] = [];
  for (const id of rule.roleIds) if (!findById(config.roles, id)) errors.push(`${label}授权角色不存在`);
  for (const id of rule.userIds) if (!activeMember(config, id)) errors.push(`${label}授权人员不存在或已停用`);
  if (
    !rule.roleIds.length &&
    !rule.userIds.length &&
    !rule.applicant &&
    !rule.executor &&
    !rule.departmentManager &&
    !rule.nodeAssignees
  )
    errors.push(`${label}至少指定一类可访问人员`);
  return errors;
}

/**
 * 保守判断附加授权是否只收紧范围，避免上传者通过修改文件权限扩大接收人。
 * @param previous 原始附加规则
 * @param next 新附加规则
 * @returns 新规则是否为原规则的明确子集
 */
export function isNarrowerAccess(previous: DataAccessRule, next: DataAccessRule): boolean {
  if (previous.mode === 'shared') return true;
  if (next.mode === 'shared') return false;
  for (const id of next.roleIds) if (!previous.roleIds.includes(id)) return false;
  for (const id of next.userIds) if (!previous.userIds.includes(id)) return false;
  for (const key of ['applicant', 'executor', 'departmentManager', 'nodeAssignees'] as const)
    if (next[key] && !previous[key]) return false;
  return true;
}
