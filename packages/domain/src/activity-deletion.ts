import { z } from 'zod';
import type { Activity, CompanyConfig } from './types';
import { canReadActivity, findById } from './permissions';

export const activityDeleteSchema = z
  .object({
    attachmentContextId: z.uuid().optional(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1, '请填写删除原因').max(500),
    idempotencyKey: z.string().min(16).max(100),
  })
  .strict();
export type ActivityDeleteCommand = z.infer<typeof activityDeleteSchema>;
export interface ActivityDeleteResult {
  id: string;
  deleted: true;
}

/**
 * 判断删除资格：管理员按授权范围删除任意状态，发起者只能删除本人未在办理的活动。
 * @param config 当前公司配置
 * @param actor 当前成员
 * @param activity 活动主单及参与信息
 * @returns 是否允许删除
 */
export function canDeleteActivity(config: CompanyConfig, actor: string, activity: Activity): boolean {
  if (activity.deleted) return false;
  const adminRoles = [];
  const ownRoles = [];
  for (const role of config.roles) {
    if (role.permissions.includes('activity:delete:any')) adminRoles.push(role);
    if (role.permissions.includes('activity:delete')) ownRoles.push(role);
  }
  if (canReadActivity({ ...config, roles: adminRoles }, actor, activity)) return true;
  return (
    activity.applicant === actor &&
    ['draft', 'needs_info', 'withdrawn', 'rejected', 'cancelled'].includes(activity.status) &&
    canReadActivity({ ...config, roles: ownRoles }, actor, activity)
  );
}

/**
 * 为现有组织补充发起者删除能力和独立的活动删除管理员角色，保留敏感资料授权。
 * @param input 当前发布配置或独立草案
 * @returns 包含删除权限及管理员活动列表入口的配置副本
 */
export function withActivityDeletion(input: CompanyConfig): CompanyConfig {
  const config = structuredClone(input);
  for (const role of config.roles)
    if (
      role.permissions.includes('activity:create') &&
      role.permissions.includes('activity:read') &&
      !role.permissions.includes('activity:delete')
    )
      role.permissions.push('activity:delete');
  const pages: string[] = [];
  for (const page of config.pages) if (page.active && page.component === 'activity_list') pages.push(page.id);
  if (!pages.length) {
    const group = config.groups.find(activeGroup);
    if (!group) throw new Error('请先启用一个菜单分组后安装活动删除功能');
    if (findById(config.pages, 'p-activity-management')) throw new Error('活动管理页面标识已被占用');
    config.pages.push({
      id: 'p-activity-management',
      name: '活动管理',
      component: 'activity_list',
      active: true,
      group: group.id,
    });
    pages.push('p-activity-management');
  }
  const existing = findById(config.roles, 'activity-deletion-admin');
  if (
    existing &&
    (existing.scope !== 'all' ||
      existing.permissions.length !== 2 ||
      !existing.permissions.includes('activity:read') ||
      !existing.permissions.includes('activity:delete:any'))
  )
    throw new Error('activity-deletion-admin 已被其他角色占用，请调整标识后迁移');
  if (!existing)
    config.roles.push({
      id: 'activity-deletion-admin',
      name: '活动删除管理员',
      permissions: ['activity:read', 'activity:delete:any'],
      scope: 'all',
      pages,
    });
  for (const member of config.users) {
    let admin = false;
    for (const id of member.roles)
      if (findById(config.roles, id)?.permissions.includes('config:manage')) admin = true;
    if (admin && !member.roles.includes('activity-deletion-admin'))
      member.roles.push('activity-deletion-admin');
  }
  return config;
}

/**
 * 查找可以承载管理员活动列表的已启用菜单分组。
 * @param group 当前分组
 * @returns 是否启用
 */
function activeGroup(group: { active: boolean }): boolean {
  return group.active;
}
