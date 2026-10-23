import type { CompanyConfig, Role, Permission, Scope } from './types';
import { PAGE_COMPONENTS } from './constants';
export const ROLE_PURPOSES: Record<string, string> = {
  admin: '维护用户、组织、表单、菜单与权限',
  'activity-admin': '管理全公司活动及删除操作，不管理系统配置',
  applicant: '创建活动、提交申请、维护本人申请',
  department: '审核本部门及下级活动、查看部门数据',
  reviewer: '办理指派给自己的跨部门审核与任务',
  coordinator: '协调流程、调整节点、指派执行人员',
  executor: '完成办理任务、执行活动并提交成果',
  archivist: '审核活动成果并归档',
  director: '领导审核、查看公司活动与经营看板',
};
export const ROLE_GROUPS = [
  { name: '系统与业务管理', ids: ['admin', 'activity-admin'] },
  { name: '申请与审核', ids: ['applicant', 'department', 'reviewer'] },
  { name: '协调、执行与归档', ids: ['coordinator', 'executor', 'archivist'] },
  { name: '领导查看与决策', ids: ['director'] },
];
/** 按常规业务岗位生成精简角色，不按每个部门复制角色。
 * @param config 当前菜单配置
 * @returns 九类通用角色及对应页面、动作和数据范围
 */
export function standardBusinessRoles(config: Pick<CompanyConfig, 'pages'>): Role[] {
  const roles: Role[] = [];
  /** 创建岗位角色并仅绑定其动作权限允许的页面。
   * @param id 角色标识
   * @param name 岗位名称
   * @param scope 数据范围
   * @param permissions 操作权限
   */
  function add(id: string, name: string, scope: Scope, permissions: Permission[]): void {
    const pages: string[] = [];
    for (const page of config.pages)
      if (page.active && permissions.includes(PAGE_COMPONENTS[page.component].permission))
        pages.push(page.id);
    roles.push({ id, name, scope, permissions, pages });
  }
  add('admin', '系统管理员', 'all', [
    'config:manage',
    'activity:read',
    'activity:delete:any',
    'dashboard:read',
  ]);
  add('activity-admin', '活动管理员', 'all', ['activity:read', 'activity:delete:any', 'activity:export']);
  add('applicant', '活动发起人', 'self', [
    'activity:read',
    'activity:create',
    'activity:submit',
    'activity:delete',
    'activity:export',
    'file:download',
    'evaluation:read',
    'evaluation:manage',
  ]);
  add('department', '部门负责人', 'department_tree', [
    'activity:read',
    'approval:decide',
    'task:complete',
    'file:download',
    'dashboard:read',
    'evaluation:read',
    'evaluation:manage',
  ]);
  add('reviewer', '业务审核人', 'tasks', [
    'activity:read',
    'approval:decide',
    'task:complete',
    'file:download',
  ]);
  add('coordinator', '流程协调人', 'all', [
    'activity:read',
    'workflow:adjust',
    'activity:assign',
    'task:complete',
    'activity:export',
  ]);
  add('executor', '活动执行人', 'tasks', [
    'activity:read',
    'task:complete',
    'execution:report',
    'file:download',
    'evaluation:read',
    'evaluation:manage',
  ]);
  add('archivist', '归档管理员', 'all', ['activity:read', 'archive:review', 'activity:export']);
  add('director', '公司领导', 'all', [
    'activity:read',
    'approval:decide',
    'dashboard:read',
    'file:download',
    'evaluation:read',
    'evaluation:manage',
  ]);
  return roles;
}
/** 将已交付的旧重复角色映射为通用岗位角色，未知自定义角色需要单独核对。
 * @param id 旧角色ID
 * @returns 合并后的角色ID
 */
export function canonicalRoleId(id: string): string {
  const aliases: Record<string, string> = {
    'org-executor': 'executor',
    'orgsql-admin': 'admin',
    'orgsql-applicant': 'applicant',
    'orgsql-worker': 'executor',
    'orgsql-manager': 'department',
    'orgsql-leader': 'director',
    'orgsql-coordinator': 'coordinator',
    'orgsql-archivist': 'archivist',
    'activity-deletion-admin': 'activity-admin',
    'leadership-insights': 'director',
    academic: 'reviewer',
    marketing: 'reviewer',
  };
  if (aliases[id]) return aliases[id];
  if (id.startsWith('org-') || (id.startsWith('orgsql-') && id.endsWith('-review'))) return 'reviewer';
  if (Object.hasOwn(ROLE_PURPOSES, id)) return id;
  throw new Error(`需要先确认自定义角色的合并方式：${id}`);
}
/** 合并旧角色并保留当前敏感授权受众，部门专属受理改为明确的部门负责人。
 * @param input 当前完整上下文
 * @returns 使用九类通用角色的独立副本
 */
export function withStandardBusinessRoles(input: CompanyConfig): CompanyConfig {
  const config = structuredClone(input);
  config.roles = standardBusinessRoles(input);
  for (const member of config.users) member.roles = [...new Set(member.roles.map(canonicalRoleId))];
  for (const field of config.form.fields) {
    preserveAudience(field.access?.read);
    preserveAudience(field.access?.write);
  }
  for (const node of config.workflow.nodes) {
    preserveAudience(node.access);
    preserveAudience(node.downloadAccess);
    if (node.assignee.type !== 'role') continue;
    const id = node.assignee.value;
    if (
      id === 'academic' ||
      id === 'marketing' ||
      (id.startsWith('org-') && id !== 'org-executor') ||
      (id.startsWith('orgsql-') && id.endsWith('-review'))
    ) {
      const departments = input.departments.filter(
        /** 查找旧专属角色对应的唯一有效部门负责人。
         * @param department 当前部门
         * @returns 负责人是否持有旧角色
         */ function matches(department) {
          const manager = input.users.find(
            /** 匹配部门负责人身份。
             * @param member 旧人员
             * @returns 是否为当前部门负责人
             */ function isManager(member) {
              return member.id === department.manager;
            },
          );
          return !!manager?.active && manager.department === department.id && manager.roles.includes(id);
        },
      );
      if (departments.length !== 1)
        throw new Error(`${node.label}的旧部门角色无法唯一映射，请先指定受理部门`);
      node.assignee = { type: 'department_manager', value: departments[0]!.id };
    } else node.assignee.value = canonicalRoleId(id);
  }
  return config;
  /** 将旧角色敏感授权固定为现有有效人员，防止合并角色后扩大查看范围。
   * @param rule 当前字段或节点的访问规则
   */
  function preserveAudience(rule: import('./types').DataAccessRule | undefined): void {
    if (!rule?.roleIds.length) return;
    const users = new Set(rule.userIds);
    for (const member of input.users)
      if (
        member.roles.some(
          /** 检查旧角色是否属于访问受众。
           * @param role 旧角色ID
           * @returns 是否被原规则允许
           */ function allowed(role) {
            return rule!.roleIds.includes(role);
          },
        ) &&
        isActive(member.id)
      )
        users.add(member.id);
    rule.roleIds = [];
    rule.userIds = [...users];
  }
  /** 检查原始配置中的人员与完整部门链有效性。
   * @param id 人员ID
   * @returns 是否有效
   */
  function isActive(id: string): boolean {
    const member = input.users.find(
      /** 定位当前人员。
       * @param user 原始成员
       * @returns 是否匹配
       */ function match(user) {
        return user.id === id;
      },
    );
    if (!member?.active) return false;
    let dept = member.department;
    const visited = new Set<string>();
    while (dept) {
      if (visited.has(dept)) return false;
      visited.add(dept);
      const item = input.departments.find(
        /** 定位当前组织链节点。
         * @param department 部门
         * @returns 是否匹配
         */ function match(department) {
          return department.id === dept;
        },
      );
      if (!item?.active) return false;
      dept = item.parent;
    }
    return visited.size > 0;
  }
}
