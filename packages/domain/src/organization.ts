import type { CompanyConfig, Department, Member, Role } from './types';
import { findById } from './permissions';

export interface CommonDepartment {
  id: string;
  name: string;
  aliases: string[];
  roleId: string;
  roleName: string;
  accountPrefix: string;
  shortName: string;
}
export interface OrganizationSupplement {
  config: CompanyConfig;
  addedDepartments: Department[];
  addedMembers: Member[];
  addedRoles: Role[];
  skippedDepartments: string[];
}

export const COMMON_DEPARTMENTS: CommonDepartment[] = [
  {
    id: 'finance',
    name: '财务部',
    aliases: ['财务中心'],
    roleId: 'org-finance',
    roleName: '财务审核人',
    accountPrefix: 'finance',
    shortName: '财务',
  },
  {
    id: 'planning',
    name: '策划部',
    aliases: ['活动策划部', '策划中心'],
    roleId: 'org-planning',
    roleName: '策划审核人',
    accountPrefix: 'planning',
    shortName: '策划',
  },
  {
    id: 'market',
    name: '营销中心',
    aliases: ['营销部', '市场部', '市场营销部'],
    roleId: 'marketing',
    roleName: '营销审核人',
    accountPrefix: 'marketing',
    shortName: '营销',
  },
  {
    id: 'design',
    name: '设计部',
    aliases: ['创意设计部', '设计中心'],
    roleId: 'org-design',
    roleName: '设计审核人',
    accountPrefix: 'design',
    shortName: '设计',
  },
  {
    id: 'printing',
    name: '印刷制作部',
    aliases: ['印刷部', '制作部', '印务部'],
    roleId: 'org-printing',
    roleName: '印刷制作审核人',
    accountPrefix: 'printing',
    shortName: '印刷',
  },
  {
    id: 'procurement',
    name: '采购部',
    aliases: ['采购中心'],
    roleId: 'org-procurement',
    roleName: '采购审核人',
    accountPrefix: 'procurement',
    shortName: '采购',
  },
  {
    id: 'logistics',
    name: '仓储物流部',
    aliases: ['物流部', '仓储部'],
    roleId: 'org-logistics',
    roleName: '仓储物流审核人',
    accountPrefix: 'logistics',
    shortName: '物流',
  },
  {
    id: 'administration',
    name: '行政人事部',
    aliases: ['行政部', '人事行政部', '综合管理部'],
    roleId: 'org-administration',
    roleName: '行政人事审核人',
    accountPrefix: 'adminhr',
    shortName: '行政',
  },
  {
    id: 'customer-service',
    name: '客户服务部',
    aliases: ['客服部', '客户服务中心'],
    roleId: 'org-customer-service',
    roleName: '客户服务审核人',
    accountPrefix: 'service',
    shortName: '客服',
  },
];

/**
 * 分配不覆盖已有对象的稳定标识，冲突时追加数字后缀。
 * @param items 已存在对象
 * @param preferred 首选标识
 * @returns 未使用的标识
 */
function availableId(items: Array<{ id: string }>, preferred: string): string {
  let id = preferred;
  let suffix = 2;
  while (findById(items, id)) id = preferred + '-' + suffix++;
  return id;
}

/**
 * 检查已有角色是否与预置职责完全兼容，保留自定义高权限角色而不自动分配给示例账号。
 * @param existing 当前角色
 * @param wanted 预置职责
 * @returns 是否可以安全复用
 */
function compatibleRole(existing: Role, wanted: Role): boolean {
  if (existing.scope !== wanted.scope || existing.permissions.length !== wanted.permissions.length)
    return false;
  for (const permission of wanted.permissions) if (!existing.permissions.includes(permission)) return false;
  for (const page of wanted.pages) if (!existing.pages.includes(page)) return false;
  return true;
}

/**
 * 复用同职责角色或补充独立角色，始终保留已存在角色的授权设置。
 * @param result 补齐结果及独立配置
 * @param wanted 需要的角色
 * @returns 实际可引用的角色标识
 */
function ensureRole(result: OrganizationSupplement, wanted: Role): string {
  for (const id of [wanted.id, 'common-' + wanted.id]) {
    const existing = findById(result.config.roles, id);
    if (existing && compatibleRole(existing, wanted)) return existing.id;
  }
  const base = findById(result.config.roles, wanted.id) ? 'common-' + wanted.id : wanted.id;
  for (const existing of result.config.roles)
    if (
      existing.id.startsWith(base + '-') &&
      existing.name === wanted.name + '（常用部门）' &&
      compatibleRole(existing, wanted)
    )
      return existing.id;
  const role = { ...wanted, id: availableId(result.config.roles, base) };
  if (role.id !== wanted.id) role.name += '（常用部门）';
  result.config.roles.push(role);
  result.addedRoles.push(role);
  return role.id;
}

/**
 * 为常用部门角色绑定已有业务页面，兼容用户已自定义的页面标识。
 * @param config 当前页面配置
 * @returns 工作台、活动列表和待办页面标识
 */
function businessPages(config: CompanyConfig): string[] {
  const pages: string[] = [];
  for (const page of config.pages)
    if (page.active && ['summary', 'activity_list', 'task_list'].includes(page.component))
      pages.push(page.id);
  return pages;
}

/**
 * 根据名称及常用别名复用现有部门，保持已有部门的层级、名称、状态和负责人。
 * @param config 当前组织
 * @param preset 常用部门定义
 * @returns 已存在的同名部门
 */
function existingDepartment(config: CompanyConfig, preset: CommonDepartment): Department | undefined {
  for (const department of config.departments) {
    const name = department.name.replace(/\s+/g, '');
    for (const candidate of [preset.name, ...preset.aliases]) if (name === candidate) return department;
  }
  return undefined;
}

/**
 * 检查部门及全部上级是否启用，尊重用户已有的停用和层级配置。
 * @param config 当前配置
 * @param department 部门
 * @returns 是否可以补充该部门的示例人员
 */
function departmentEnabled(config: CompanyConfig, department: Department): boolean {
  const seen = new Set<string>();
  let id = department.id;
  while (id) {
    if (seen.has(id)) return false;
    seen.add(id);
    const item = findById(config.departments, id);
    if (!item?.active) return false;
    id = item.parent;
  }
  return true;
}

/**
 * 创建一个明确标记为示例的部门成员，账号及标识冲突时分配新值。
 * @param result 当前补齐结果
 * @param department 成员所属部门
 * @param preset 常用部门定义
 * @param manager 是否为负责人
 * @param roles 最小职责角色
 * @returns 新增成员
 */
function addExampleMember(
  result: OrganizationSupplement,
  department: Department,
  preset: CommonDepartment,
  manager: boolean,
  roles: string[],
): Member {
  const preferred = preset.accountPrefix + (manager ? '_manager' : '_staff');
  let username = preferred;
  let suffix = 2;
  while (
    result.config.users.some(
      /**
       * 检查账号是否已经被任意现有成员使用。
       * @param member 已有成员
       * @returns 是否账号冲突
       */
      function taken(member) {
        return member.username === username;
      },
    )
  )
    username = preferred + '_' + suffix++;
  const member: Member = {
    id: availableId(result.config.users, `u-${preset.id}-${manager ? 'manager' : 'staff'}`),
    name: preset.shortName + (manager ? '负责人' : '专员') + '（示例）',
    username,
    department: department.id,
    roles,
    active: true,
  };
  result.config.users.push(member);
  result.addedMembers.push(member);
  return member;
}

/**
 * 以增量方式补齐常用部门与岗位角色，可选示例人员；只返回独立草案，不发布或写数据库。
 * @param input 用户当前配置
 * @param includeMembers 是否为缺少负责人与成员的部门补充示例账号
 * @returns 新草案、各类新增对象及保留停用的部门名称
 */
export function supplementCommonOrganization(
  input: CompanyConfig,
  includeMembers = false,
): OrganizationSupplement {
  const config = JSON.parse(JSON.stringify(input)) as CompanyConfig;
  const result: OrganizationSupplement = {
    config,
    addedDepartments: [],
    addedMembers: [],
    addedRoles: [],
    skippedDepartments: [],
  };
  let root: Department | undefined;
  for (const department of config.departments)
    if (!department.parent && department.active) {
      if (!root || department.id === 'company') root = department;
    }
  if (!root) throw new Error('请先建立并启用公司顶级部门，再补齐常用部门');
  const compact = config.roles.some(
    /** 检查是否已采用通用业务审核角色。
     * @param role 当前角色
     * @returns 是否启用精简角色体系
     */ function isCompact(role) {
      return role.id === 'reviewer';
    },
  );
  const pages = businessPages(config);
  let managerRole = '';
  let executorRole = '';
  if (includeMembers) {
    managerRole = compact
      ? 'department'
      : ensureRole(result, {
          id: 'department',
          name: '部门审核人',
          permissions: ['activity:read', 'approval:decide'],
          scope: 'department',
          pages,
        });
    executorRole = compact
      ? 'executor'
      : ensureRole(result, {
          id: 'org-executor',
          name: '部门执行协作人',
          permissions: ['activity:read', 'execution:report', 'task:complete', 'file:download'],
          scope: 'tasks',
          pages,
        });
  }
  for (const preset of COMMON_DEPARTMENTS) {
    let department = existingDepartment(config, preset);
    if (department && !departmentEnabled(config, department)) {
      result.skippedDepartments.push(department.name);
      continue;
    }
    if (!department) {
      department = {
        id: availableId(config.departments, preset.id),
        name: preset.name,
        parent: root.id,
        manager: '',
        active: true,
      };
      config.departments.push(department);
      result.addedDepartments.push(department);
    }
    const permissions: Role['permissions'] =
      preset.id === 'market'
        ? ['activity:read', 'approval:decide']
        : ['activity:read', 'approval:decide', 'task:complete', 'file:download'];
    const role = compact
      ? 'reviewer'
      : ensureRole(result, {
          id: preset.roleId,
          name: preset.roleName,
          permissions,
          scope: 'tasks',
          pages,
        });
    if (!includeMembers) continue;
    if (!department.manager)
      department.manager = addExampleMember(result, department, preset, true, [managerRole, role]).id;
    let hasStaff = false;
    for (const member of config.users)
      if (member.active && member.department === department.id && member.id !== department.manager)
        hasStaff = true;
    if (!hasStaff) addExampleMember(result, department, preset, false, [executorRole]);
  }
  if (config.departments.length > 200 || config.users.length > 1000 || config.roles.length > 100)
    throw new Error('补齐后超出组织配置容量（200部门、1000成员或100角色），请先整理现有配置');
  return result;
}
