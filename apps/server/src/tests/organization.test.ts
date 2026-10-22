import { expect, test } from 'vitest';
import {
  COMMON_DEPARTMENTS,
  configSchema,
  findById,
  hasPermission,
  resolveAssignees,
  seedConfig,
  supplementCommonOrganization,
  validateConfig,
} from '@workflow/domain';
import type { CompanyConfig, Department, Member, Role } from '@workflow/domain';

/**
 * 构造原有五部门、十一成员配置，验证已有项目的增量补齐而非重置。
 * @returns 不含新增预置组织的旧配置
 */
function legacyConfig(): CompanyConfig {
  const config = seedConfig();
  /**
   * 保留原有部门。
   * @param department 部门
   * @returns 是否旧部门
   */
  function oldDepartment(department: Department): boolean {
    return ['company', 'research', 'd1', 'd2', 'market'].includes(department.id);
  }
  /**
   * 保留原有示例成员，排除补齐后的新账号。
   * @param member 成员
   * @returns 是否旧成员
   */
  function oldMember(member: Member): boolean {
    return [
      'u-admin',
      'u-lin',
      'u-chen',
      'u-zhou',
      'u-zhao',
      'u-liu',
      'u-wang',
      'u-su',
      'u-he',
      'u-qiao',
      'u-du',
    ].includes(member.id);
  }
  /**
   * 保留原有岗位授权。
   * @param role 角色
   * @returns 是否旧角色
   */
  function oldRole(role: Role): boolean {
    return [
      'admin',
      'applicant',
      'department',
      'academic',
      'marketing',
      'director',
      'coordinator',
      'executor',
      'archivist',
    ].includes(role.id);
  }
  config.departments = config.departments.filter(oldDepartment);
  config.users = config.users.filter(oldMember);
  config.roles = config.roles.filter(oldRole);
  return config;
}

/** 核对新安装的常用部门、负责人和成员引用均有效，原教研和营销身份保持稳定。 */
function seedCase(): void {
  const config = seedConfig();
  expect(config.departments).toHaveLength(13);
  expect(config.users).toHaveLength(28);
  expect(configSchema.safeParse(config).success).toBe(true);
  expect(validateConfig(config)).toEqual([]);
  for (const preset of COMMON_DEPARTMENTS) {
    const department = findById(config.departments, preset.id)!;
    expect(department.name).toBe(preset.name);
    expect(findById(config.users, department.manager)?.department).toBe(department.id);
  }
  expect(findById(config.departments, 'market')!.manager).toBe('u-zhao');
  expect(findById(config.departments, 'd1')!.manager).toBe('u-chen');
}
test('初始组织包含13个部门和28名成员，全部引用与发布校验有效', seedCase);

/** 核对默认补齐只增加部门和岗位角色，不自动创建账号或覆盖现有设置。 */
function departmentsOnlyCase(): void {
  const input = legacyConfig();
  const before = JSON.stringify(input);
  const result = supplementCommonOrganization(input);
  expect(result.addedDepartments).toHaveLength(8);
  expect(result.addedRoles).toHaveLength(8);
  expect(result.addedMembers).toHaveLength(0);
  expect(JSON.stringify(input)).toBe(before);
  expect(result.config.version).toBe(input.version);
  for (const user of input.users) expect(findById(result.config.users, user.id)).toEqual(user);
  expect(validateConfig(result.config)).toEqual([]);
}
test('已有组织增量补齐部门和角色，默认不新增登录账号', departmentsOnlyCase);

/** 核对重复执行不会重复新增部门、角色或成员，并能在第二次选择时补齐示例人员。 */
function repeatedCase(): void {
  const first = supplementCommonOrganization(legacyConfig());
  const withMembers = supplementCommonOrganization(first.config, true);
  expect(withMembers.addedDepartments).toHaveLength(0);
  expect(withMembers.addedMembers).toHaveLength(17);
  const again = supplementCommonOrganization(withMembers.config, true);
  expect(again.addedDepartments).toHaveLength(0);
  expect(again.addedMembers).toHaveLength(0);
  expect(again.addedRoles).toHaveLength(0);
  expect(again.config).toEqual(withMembers.config);
}
test('部门与可选示例人员支持分次补齐，重复操作保持幂等', repeatedCase);

/** 核对示例部门负责人可以受理本部门初审，示例成员没有敏感全量或系统管理权限。 */
function approvalCase(): void {
  const result = supplementCommonOrganization(legacyConfig(), true);
  for (const preset of COMMON_DEPARTMENTS) {
    const department = findById(result.config.departments, preset.id)!;
    let staff: Member | undefined;
    for (const member of result.config.users)
      if (member.department === department.id && member.id !== department.manager && member.active)
        staff = member;
    expect(staff).toBeDefined();
    const resolved = resolveAssignees(result.config, { type: 'manager', value: '' }, staff!.id, 'approval');
    expect(resolved.ids).toEqual([department.manager]);
    expect(resolved.errors).toEqual([]);
  }
  for (const member of result.addedMembers) {
    expect(hasPermission(result.config, member.id, 'config:manage')).toBe(false);
    expect(hasPermission(result.config, member.id, 'activity:sensitive:read')).toBe(false);
  }
  expect(validateConfig(result.config)).toEqual([]);
}
test('新增负责人具备部门审批资格，示例账号按岗位最小授权', approvalCase);

/** 核对用户已有的同名别名部门、负责人和自定义层级不被替换。 */
function reuseCase(): void {
  const input = legacyConfig();
  input.departments.push({
    id: 'custom-finance',
    name: '财务中心',
    parent: 'research',
    manager: 'custom-lead',
    active: true,
  });
  input.users.push({
    id: 'custom-lead',
    name: '原财务负责人',
    username: 'original_finance',
    department: 'custom-finance',
    roles: ['department'],
    active: true,
  });
  const result = supplementCommonOrganization(input);
  expect(findById(result.config.departments, 'custom-finance')).toEqual(
    findById(input.departments, 'custom-finance'),
  );
  let matches = 0;
  for (const department of result.config.departments)
    if (['财务部', '财务中心'].includes(department.name)) matches++;
  expect(matches).toBe(1);
  expect(result.addedDepartments).toHaveLength(7);
}
test('同名别名部门沿用原有负责人和组织层级', reuseCase);

/** 核对停用部门及停用上级继续保留停用状态，不添加可以绕过停用的新组织。 */
function disabledCase(): void {
  const input = legacyConfig();
  findById(input.departments, 'research')!.active = false;
  input.departments.push({ id: 'finance', name: '财务部', parent: 'research', manager: '', active: true });
  const result = supplementCommonOrganization(input, true);
  expect(result.skippedDepartments).toContain('财务部');
  expect(findById(result.config.departments, 'finance')!.manager).toBe('');
  for (const member of result.addedMembers) expect(member.department).not.toBe('finance');
  expect(findById(result.config.departments, 'research')!.active).toBe(false);
}
test('停用部门和停用上级不会被补齐操作重新启用', disabledCase);

/** 核对账号与角色标识冲突时生成独立对象，既有高权限角色不会分配给新账号。 */
function collisionCase(): void {
  const input = legacyConfig();
  findById(input.users, 'u-admin')!.username = 'finance_manager';
  for (const id of ['org-finance', 'common-org-finance'])
    input.roles.push({
      id,
      name: '现有高权限角色',
      permissions: ['config:manage'],
      scope: 'all',
      pages: ['p-config'],
    });
  input.departments.push({
    id: 'finance',
    name: '已有自定义业务部',
    parent: 'company',
    manager: '',
    active: true,
  });
  const result = supplementCommonOrganization(input, true);
  let department: Department | undefined;
  for (const item of result.config.departments) if (item.name === '财务部') department = item;
  expect(department!.id).toBe('finance-2');
  const manager = findById(result.config.users, department!.manager)!;
  expect(manager.username).toBe('finance_manager_2');
  expect(hasPermission(result.config, manager.id, 'config:manage')).toBe(false);
  expect(findById(result.config.users, 'u-admin')!.username).toBe('finance_manager');
  const again = supplementCommonOrganization(result.config, true);
  expect(again.addedDepartments).toHaveLength(0);
  expect(again.addedRoles).toHaveLength(0);
  expect(again.addedMembers).toHaveLength(0);
}
test('部门角色账号冲突安全分配且不会意外授予管理权限', collisionCase);
