import type { CompanyConfig } from './types';
import { findById } from './permissions';

/**
 * 为初始化或显式迁移补充评价岗位能力和领导看板，保留已有数据范围与敏感资料权限。
 * @param input 原有公司配置
 * @returns 独立的新配置，管理员与公司负责人获得汇总看板入口
 */
export function withActivityInsights(input: CompanyConfig): CompanyConfig {
  const config = structuredClone(input);
  let group = findById(config.groups, 'business');
  if (!group) {
    group = { id: 'business', name: '活动协作', active: true };
    config.groups.push(group);
  }
  const page = findById(config.pages, 'p-leadership');
  if (page && page.component !== 'leadership_dashboard')
    throw new Error('p-leadership 已被其他页面占用，请调整标识后迁移');
  if (!page)
    config.pages.push({
      id: 'p-leadership',
      name: '领导看板',
      group: group.id,
      component: 'leadership_dashboard',
      active: true,
    });
  for (const role of config.roles) {
    if (!role.permissions.includes('activity:read')) continue;
    if (role.permissions.some(organizerPermission)) {
      if (!role.permissions.includes('evaluation:read')) role.permissions.push('evaluation:read');
      if (!role.permissions.includes('evaluation:manage')) role.permissions.push('evaluation:manage');
    }
    if (['department', 'department_tree', 'all'].includes(role.scope)) {
      if (!role.permissions.includes('dashboard:read')) role.permissions.push('dashboard:read');
      if (!role.pages.includes('p-leadership')) role.pages.push('p-leadership');
    }
  }
  const existing = findById(config.roles, 'leadership-insights');
  if (
    existing &&
    (existing.permissions.length !== 1 ||
      existing.permissions[0] !== 'dashboard:read' ||
      existing.scope !== 'all')
  )
    throw new Error('leadership-insights 已被自定义角色占用，请调整标识后迁移');
  if (!existing)
    config.roles.push({
      id: 'leadership-insights',
      name: '公司领导看板',
      permissions: ['dashboard:read'],
      scope: 'all',
      pages: ['p-leadership'],
    });
  const leaders = new Set<string>();
  for (const department of config.departments)
    if (!department.parent && department.active && department.manager) leaders.add(department.manager);
  for (const member of config.users) {
    for (const id of member.roles)
      if (findById(config.roles, id)?.permissions.includes('config:manage')) leaders.add(member.id);
    if (member.active && leaders.has(member.id) && !member.roles.includes('leadership-insights'))
      member.roles.push('leadership-insights');
  }
  return config;
}

/**
 * 标识可以负责收集与查看活动反馈的组织、执行或档案岗位。
 * @param permission 岗位已有业务权限
 * @returns 是否应获得所在数据范围内的评价协作能力
 */
function organizerPermission(permission: string): boolean {
  return ['activity:create', 'activity:assign', 'execution:report', 'archive:review'].includes(permission);
}
