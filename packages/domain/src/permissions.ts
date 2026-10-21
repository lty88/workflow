import type {
  Activity,
  CompanyConfig,
  Member,
  PageDefinition,
  Permission,
  Role,
  WorkflowTask,
} from './types';
import { PAGE_COMPONENTS } from './constants';

/**
 * 查找稳定标识对应的对象。
 * @param items 对象集合
 * @param id 标识
 * @returns 对象或未找到
 */
export function findById<T extends { id: string }>(items: T[], id: string): T | undefined {
  for (const item of items) if (item.id === id) return item;
  return undefined;
}

/**
 * 校验成员及所属上级部门的启用状态。
 * @param config 公司配置
 * @param userId 成员标识
 * @returns 是否为有效成员
 */
export function activeMember(config: CompanyConfig, userId: string): boolean {
  const user = findById(config.users, userId);
  if (!user?.active) return false;
  const seen = new Set<string>();
  let id = user.department;
  while (id) {
    if (seen.has(id)) return false;
    seen.add(id);
    const dept = findById(config.departments, id);
    if (!dept?.active) return false;
    id = dept.parent;
  }
  return seen.size > 0;
}

/**
 * 取得成员当前有效角色。
 * @param config 公司配置
 * @param userId 成员标识
 * @returns 角色集合
 */
export function rolesFor(config: CompanyConfig, userId: string): Role[] {
  if (!activeMember(config, userId)) return [];
  const roles: Role[] = [];
  for (const id of findById(config.users, userId)!.roles) {
    const role = findById(config.roles, id);
    if (role) roles.push(role);
  }
  return roles;
}

/**
 * 合并当前成员的操作权限。
 * @param config 公司配置
 * @param userId 成员标识
 * @returns 去重权限码
 */
export function permissionsFor(config: CompanyConfig, userId: string): Permission[] {
  const set = new Set<Permission>();
  for (const role of rolesFor(config, userId)) for (const permission of role.permissions) set.add(permission);
  return [...set];
}

/**
 * 判断当前有效成员是否具有操作权限。
 * @param config 公司配置
 * @param userId 成员标识
 * @param permission 权限码
 * @returns 是否授权
 */
export function hasPermission(config: CompanyConfig, userId: string, permission: Permission): boolean {
  return permissionsFor(config, userId).includes(permission);
}

/**
 * 判断部门是否属于授权部门树。
 * @param config 公司配置
 * @param department 当前部门
 * @param ancestor 授权根部门
 * @returns 是否在范围内
 */
export function withinDepartment(config: CompanyConfig, department: string, ancestor: string): boolean {
  const seen = new Set<string>();
  let id = department;
  while (id && !seen.has(id)) {
    if (id === ancestor) return true;
    seen.add(id);
    id = findById(config.departments, id)?.parent || '';
  }
  return false;
}

/**
 * 检查导航、页面与模板所需操作权限。
 * @param config 公司配置
 * @param userId 当前成员
 * @param pageId 页面标识
 * @returns 是否允许访问
 */
export function pageAllowed(config: CompanyConfig, userId: string, pageId: string): boolean {
  const page = findById(config.pages, pageId);
  if (
    !page?.active ||
    !findById(config.groups, page.group)?.active ||
    !hasPermission(config, userId, PAGE_COMPONENTS[page.component].permission)
  )
    return false;
  for (const role of rolesFor(config, userId)) if (role.pages.includes(pageId)) return true;
  return false;
}

/**
 * 获取成员可见的动态页面。
 * @param config 公司配置
 * @param userId 当前成员
 * @returns 授权页面列表
 */
export function pagesFor(config: CompanyConfig, userId: string): PageDefinition[] {
  const pages: PageDefinition[] = [];
  for (const page of config.pages) if (pageAllowed(config, userId, page.id)) pages.push(page);
  return pages;
}

/**
 * 校验活动读取权限及多角色数据范围。
 * @param config 当前配置
 * @param userId 当前成员
 * @param activity 活动及参与信息
 * @returns 是否可访问
 */
export function canReadActivity(
  config: CompanyConfig,
  userId: string,
  activity: Pick<Activity, 'applicant' | 'department' | 'nodes' | 'executor' | 'cancellation'>,
): boolean {
  if (!hasPermission(config, userId, 'activity:read')) return false;
  const user = findById(config.users, userId)!;
  for (const role of rolesFor(config, userId)) {
    if (!role.permissions.includes('activity:read')) continue;
    if (
      role.scope === 'all' ||
      (role.scope === 'self' && activity.applicant === userId) ||
      (role.scope === 'department' && activity.department === user.department) ||
      (role.scope === 'department_tree' && withinDepartment(config, activity.department, user.department))
    )
      return true;
    if (role.scope === 'tasks') {
      if (activity.executor === userId || activity.cancellation?.reviewer === userId) return true;
      for (const node of activity.nodes) if (node.assignees.includes(userId)) return true;
    }
  }
  return false;
}

/**
 * 校验个人待办归属、节点状态与当前权限，防止自审及旧轮次办理。
 * @param config 当前配置
 * @param userId 当前成员
 * @param activity 实例
 * @param task 个人任务
 * @returns 是否可办理
 */
export function canHandleTask(
  config: CompanyConfig,
  userId: string,
  activity: Activity,
  task: WorkflowTask,
): boolean {
  if (
    !canReadActivity(config, userId, activity) ||
    activity.status !== 'approving' ||
    task.assignee !== userId ||
    task.status !== 'pending'
  )
    return false;
  const node = findById(activity.nodes, task.nodeId);
  if (
    !node ||
    node.status !== 'active' ||
    node.generation !== task.generation ||
    (node.kind === 'approval' && activity.applicant === userId)
  )
    return false;
  if (
    !task.delegated &&
    node.assigneeRule.type === 'role' &&
    !findById(config.users, userId)?.roles.includes(node.assigneeRule.value)
  )
    return false;
  return hasPermission(config, userId, node.kind === 'approval' ? 'approval:decide' : 'task:complete');
}

/**
 * 获取可安全显示的成员名称。
 * @param users 成员列表
 * @param id 成员标识
 * @returns 姓名或标识
 */
export function memberName(users: Member[], id: string): string {
  return findById(users, id)?.name || id;
}
