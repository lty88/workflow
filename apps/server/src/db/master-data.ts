import type { CompanyConfig } from '@workflow/domain';
import { jsonValue, query } from './repository';
import type { Database } from './repository';

/**
 * 从业务主表装配运行上下文，人员及部门始终使用真实列，忽略旧配置中的同名数组。
 * @param db 数据库连接
 * @param base 表单、基础流程及版本上下文
 * @returns 以业务主表为唯一来源的公司上下文
 */
export async function readMasterData(db: Database, base: CompanyConfig): Promise<CompanyConfig> {
  const members = await query<{
    id: string;
    username: string;
    name: string;
    department_id: string;
    active: number;
    roles: unknown;
  }>(db, 'SELECT id,username,name,department_id,active,roles FROM members ORDER BY id');
  const departments = await query<{
    id: string;
    parent_id: string;
    name: string;
    manager_id: string;
    active: number;
  }>(db, 'SELECT id,parent_id,name,manager_id,active FROM departments ORDER BY id');
  const roles = await query<{ id: string; name: string; data: unknown }>(
    db,
    'SELECT id,name,data FROM roles ORDER BY id',
  );
  const pages = await query<{ id: string; name: string; active: number; data: unknown }>(
    db,
    'SELECT id,name,active,data FROM menu_pages ORDER BY sort_order,id',
  );
  const groups = await query<{ id: string; name: string; active: number }>(
    db,
    'SELECT id,name,active FROM menu_groups ORDER BY sort_order,id',
  );
  const forms = await query<{ definition: unknown }>(
    db,
    'SELECT definition FROM form_definitions WHERE id=?',
    [base.form.id],
  );
  if (!forms[0]) throw new Error('当前表单定义缺失，请检查第六版主数据迁移');
  return {
    ...base,
    users: members.map(toMember),
    departments: departments.map(toDepartment),
    roles: roles.map(toRole),
    pages: pages.map(toPage),
    groups: groups.map(toGroup),
    form: jsonValue<CompanyConfig['form']>(forms[0].definition),
  };
}
/** 转换登录主表中的人员资料，不读取密码。
 * @param row 人员行
 * @returns 领域人员
 */
function toMember(row: {
  id: string;
  username: string;
  name: string;
  department_id: string;
  active: number;
  roles: unknown;
}): CompanyConfig['users'][number] {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    department: row.department_id,
    active: Boolean(row.active),
    roles: jsonValue<string[]>(row.roles),
  };
}
/** 转换部门主表，忽略历史data副本。
 * @param row 部门行
 * @returns 领域部门
 */
function toDepartment(row: {
  id: string;
  parent_id: string;
  name: string;
  manager_id: string;
  active: number;
}): CompanyConfig['departments'][number] {
  return {
    id: row.id,
    parent: row.parent_id,
    name: row.name,
    manager: row.manager_id,
    active: Boolean(row.active),
  };
}
/** 装配角色权限定义并以主列为准。
 * @param row 角色行
 * @returns 角色
 */
function toRole(row: { id: string; name: string; data: unknown }): CompanyConfig['roles'][number] {
  return { ...jsonValue<CompanyConfig['roles'][number]>(row.data), id: row.id, name: row.name };
}
/** 装配动态菜单定义。
 * @param row 菜单行
 * @returns 页面
 */
function toPage(row: {
  id: string;
  name: string;
  active: number;
  data: unknown;
}): CompanyConfig['pages'][number] {
  return {
    ...jsonValue<CompanyConfig['pages'][number]>(row.data),
    id: row.id,
    name: row.name,
    active: Boolean(row.active),
  };
}
/** 转换菜单分组主表。
 * @param row 分组行
 * @returns 分组
 */
function toGroup(row: { id: string; name: string; active: number }): CompanyConfig['groups'][number] {
  return { id: row.id, name: row.name, active: Boolean(row.active) };
}
/**
 * 从兼容上下文中剥离主数据，禁止再次写回配置作为运行来源。
 * @param config 领域上下文
 * @returns 仅含技术版本、表单定位和旧基础流程的兼容配置
 */
export function configurationEnvelope(config: CompanyConfig): object {
  return {
    storage: 'master-data-v6',
    version: config.version,
    form: { id: config.form.id },
    workflow: config.workflow,
  };
}
