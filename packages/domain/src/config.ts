import type { CompanyConfig } from './types';
import { activeMember, findById, hasPermission, withinDepartment } from './permissions';
import { topological } from './workflow';
import { amountFen } from './forms';
import { validateDataAccessRule } from './data-access';

/**
 * 检查配置引用、组织有效性与必要业务门槛。
 * @param config 待发布配置
 * @returns 可展示的结构错误
 */
export function validateConfig(config: CompanyConfig): string[] {
  const errors: string[] = [];
  for (const list of [
    config.departments,
    config.users,
    config.roles,
    config.groups,
    config.pages,
    config.form.fields,
    config.workflow.nodes,
  ]) {
    const ids = new Set<string>();
    for (const item of list) {
      if (ids.has(item.id)) errors.push('配置对象标识重复');
      ids.add(item.id);
    }
  }
  const keys = new Set<string>();
  for (const field of config.form.fields) {
    if (keys.has(field.key)) errors.push(`字段键重复：${field.key}`);
    keys.add(field.key);
    errors.push(
      ...validateDataAccessRule(config, field.access?.read, `${field.label}查看`),
      ...validateDataAccessRule(config, field.access?.write, `${field.label}编辑`),
    );
    if (field.key === 'activity_name' && field.access?.read.mode === 'restricted')
      errors.push('活动名称属于流程公共标识，请保持活动内共享');
    if (field.access?.read.nodeAssignees || field.access?.write?.nodeAssignees)
      errors.push(`${field.label}为申请字段，请使用指定角色、人员或申请人授权`);
    if (field.required && field.access?.read.mode === 'restricted' && !field.access.read.applicant)
      errors.push(`${field.label}为申请必填字段，必须允许申请人查看`);
    if (field.required && field.access?.write?.mode === 'restricted' && !field.access.write.applicant)
      errors.push(`${field.label}为申请必填字段，必须允许申请人填写`);
    if (
      ['select', 'checkboxes'].includes(field.type) &&
      (!field.options.length || new Set(field.options).size !== field.options.length)
    )
      errors.push(`${field.label}选项为空或重复`);
    if (field.type === 'select' && field.default && !field.options.includes(field.default))
      errors.push(`${field.label}默认值不在选项中`);
    if (field.type === 'number' && field.default && !Number.isFinite(amountFen(field.default)))
      errors.push(`${field.label}默认数字无效`);
    for (const option of field.options)
      if (
        !option.trim() ||
        option !== option.trim() ||
        (field.type === 'checkboxes' && option.includes('、'))
      )
        errors.push(`${field.label}选项包含空白或多选分隔符`);
    if (field.type === 'checkboxes' && field.default)
      for (const option of field.default.split('、'))
        if (!field.options.includes(option)) errors.push(`${field.label}默认多选值不在选项中`);
    if (field.type === 'datetime' && field.default && !Number.isFinite(Date.parse(field.default)))
      errors.push(`${field.label}默认时间无效`);
  }
  for (const key of [
    'activity_name',
    'budget',
    'start_at',
    'end_at',
    'expert_fee',
    'conference_fee',
    'travel_fee',
  ]) {
    let field;
    for (const item of config.form.fields) if (item.key === key) field = item;
    if (!field || !field.required || field.visible) errors.push(`必须保留始终可见的必填字段：${key}`);
    if (['budget', 'expert_fee', 'conference_fee', 'travel_fee'].includes(key) && field?.type !== 'number')
      errors.push(`${key}必须使用数字字段`);
  }
  const visibleGraph = [];
  for (const field of config.form.fields) {
    visibleGraph.push({ id: field.key, deps: field.visible ? [field.visible.field] : [] });
    if (field.visible) {
      let source;
      for (const candidate of config.form.fields)
        if (candidate.key === field.visible.field) source = candidate;
      if (source?.type === 'select' && !source.options.includes(field.visible.value))
        errors.push(`${field.label}显示条件值无效`);
      if (
        field.visible.operator === 'gte' &&
        (source?.type !== 'number' || !Number.isFinite(amountFen(field.visible.value)))
      )
        errors.push(`${field.label}数字显示条件无效`);
    }
  }
  if (topological(visibleGraph).error) errors.push('表单显隐条件存在循环或缺失引用');
  const graph = topological(config.workflow.nodes);
  if (graph.error) errors.push(graph.error);
  let protectedCount = 0;
  for (const node of config.workflow.nodes) {
    errors.push(
      ...validateDataAccessRule(config, node.access, `${node.label}内容`),
      ...validateDataAccessRule(config, node.downloadAccess, `${node.label}下载`),
    );
    if (node.access?.mode === 'restricted' && !node.access.nodeAssignees)
      errors.push(`${node.label}必须允许本节点受理人查看办理资料`);
    if (node.protected) {
      protectedCount += 1;
      if (node.kind !== 'approval' || node.condition) errors.push('必要审核不能降级或设置跳过条件');
    }
    if (node.condition) {
      let field;
      for (const item of config.form.fields) if (item.key === node.condition.field) field = item;
      if (!field) errors.push(`${node.label}引用字段不存在`);
      else if (
        node.condition.operator === 'gte' &&
        (field.type !== 'number' || !Number.isFinite(amountFen(node.condition.value)))
      )
        errors.push(`${node.label}金额条件无效`);
    }
    if (node.assignee.type === 'role' && !findById(config.roles, node.assignee.value))
      errors.push(`${node.label}受理角色不存在`);
    if (node.assignee.type === 'user' && !activeMember(config, node.assignee.value))
      errors.push(`${node.label}受理员工无效`);
  }
  if (!protectedCount) errors.push('至少保留一个必要审核节点');
  const names = new Set<string>();
  let admins = 0;
  for (const user of config.users) {
    if (names.has(user.username)) errors.push('登录账号重复');
    names.add(user.username);
    if (!findById(config.departments, user.department)) errors.push(`${user.name}所属部门不存在`);
    for (const role of user.roles) if (!findById(config.roles, role)) errors.push(`${user.name}角色不存在`);
    if (hasPermission(config, user.id, 'config:manage')) admins += 1;
  }
  if (!admins) errors.push('至少保留一个有效配置管理员');
  for (const dept of config.departments) {
    if (
      dept.parent &&
      (!findById(config.departments, dept.parent) || withinDepartment(config, dept.parent, dept.id))
    )
      errors.push(`${dept.name}组织层级异常`);
    if (dept.manager) {
      const manager = findById(config.users, dept.manager);
      if (!manager || manager.department !== dept.id || (dept.active && !activeMember(config, manager.id)))
        errors.push(`${dept.name}负责人需为本部门有效成员`);
    }
  }
  for (const page of config.pages) {
    if (!findById(config.groups, page.group)) errors.push(`${page.name}菜单分组不存在`);
    if (page.component === 'activity_form' && page.formId !== config.form.id)
      errors.push(`${page.name}表单绑定无效`);
  }
  for (const role of config.roles) {
    if (role.permissions.some(isDataPermission) && !role.permissions.includes('activity:read'))
      errors.push(`${role.name}的敏感或下载授权需同时授予活动查看权限`);
  }
  for (const role of config.roles)
    for (const page of role.pages)
      if (!findById(config.pages, page)) errors.push(`${role.name}绑定页面不存在`);
  return [...new Set(errors)];
}

/**
 * 标识必须绑定同一角色活动范围的内容权限。
 * @param permission 权限码
 * @returns 是否为数据内容权限
 */
function isDataPermission(permission: string): boolean {
  return ['activity:sensitive:read', 'activity:sensitive:export', 'file:download'].includes(permission);
}
