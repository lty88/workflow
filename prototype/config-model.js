"use strict";

const CM_PERMISSIONS = { "activity:read": "查看活动", "activity:create": "新建活动", "activity:submit": "提交申请", "approval:decide": "审核活动", "task:complete": "办理任务", "workflow:adjust": "调整流程", "config:manage": "管理配置" };
const CM_COMPONENTS = { summary: ["工作台", "activity:read"], activity_list: ["活动列表", "activity:read"], activity_form: ["申请表单", "activity:create"], task_list: ["任务列表", "activity:read"], archive_list: ["档案列表", "activity:read"], config_overview: ["配置概览", "config:manage"] };
const CM_SCOPES = { self: "本人", department: "本部门", department_tree: "本部门及下级", tasks: "本人相关任务", all: "全公司" };

/**
 * 克隆可序列化配置，隔离草案、已发布版本与申请快照。
 * @param {unknown} value 待克隆配置
 * @returns {unknown} 独立副本
 */
function cmCopy(value) { return JSON.parse(JSON.stringify(value)); }

/**
 * 生成用于本地配置对象的唯一标识。
 * @param {string} prefix 业务对象前缀
 * @returns {string} 本地对象标识
 */
function cmId(prefix) { return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8); }

/**
 * 生成未来五天的演示活动时间。
 * @returns {string} 日期时间控件接受的本地时间
 */
function cmFuture() { const d = new Date(); d.setDate(d.getDate() + 5); d.setHours(9, 0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

/**
 * 创建互相引用的组织、角色、菜单、表单和流程初始配置。
 * @returns {object} 可发布的公司活动配置
 */
function cmSeedConfig() {
  return {
    version: 1,
    departments: [{ id: "company", name: "树人教育", parent: "", manager: "u-liu", active: true }, { id: "research", name: "教育研究院", parent: "company", manager: "u-zhou", active: true }, { id: "d1", name: "教研一部", parent: "research", manager: "u-chen", active: true }, { id: "d2", name: "教研二部", parent: "research", manager: "u-du", active: true }, { id: "market", name: "营销中心", parent: "company", manager: "u-zhao", active: true }],
    users: [
      { id: "u-lin", name: "林晓", department: "d1", roles: ["applicant"], active: true }, { id: "u-chen", name: "陈宁", department: "d1", roles: ["department"], active: true },
      { id: "u-zhou", name: "周岚", department: "research", roles: ["academic"], active: true }, { id: "u-zhao", name: "赵明", department: "market", roles: ["marketing"], active: true },
      { id: "u-wang", name: "王舟", department: "d1", roles: ["coordinator"], active: true }, { id: "u-su", name: "苏禾", department: "d1", roles: ["executor"], active: true },
      { id: "u-he", name: "何青", department: "d1", roles: ["archivist"], active: true }, { id: "u-xu", name: "许言", department: "company", roles: ["admin"], active: true },
      { id: "u-qiao", name: "乔安", department: "d2", roles: ["applicant"], active: true }, { id: "u-du", name: "杜云", department: "d2", roles: ["department"], active: true },
      { id: "u-liu", name: "刘文", department: "company", roles: ["director"], active: true }
    ],
    roles: [
      { id: "applicant", name: "申请人", permissions: ["activity:read", "activity:create", "activity:submit"], scope: "self", pages: ["p-home", "p-list", "p-new"] },
      { id: "department", name: "部门审核人", permissions: ["activity:read", "approval:decide"], scope: "department", pages: ["p-home", "p-list", "p-tasks"] },
      { id: "academic", name: "教研审核人", permissions: ["activity:read", "approval:decide"], scope: "tasks", pages: ["p-home", "p-list", "p-tasks"] },
      { id: "marketing", name: "营销审核人", permissions: ["activity:read", "approval:decide"], scope: "tasks", pages: ["p-home", "p-tasks"] },
      { id: "director", name: "院负责人", permissions: ["activity:read", "approval:decide"], scope: "tasks", pages: ["p-home", "p-tasks"] },
      { id: "coordinator", name: "流程负责人", permissions: ["activity:read", "task:complete", "workflow:adjust"], scope: "department", pages: ["p-home", "p-list", "p-tasks"] },
      { id: "executor", name: "执行人", permissions: ["activity:read", "task:complete"], scope: "tasks", pages: ["p-home", "p-tasks"] },
      { id: "archivist", name: "归档审核人", permissions: ["activity:read", "approval:decide"], scope: "department", pages: ["p-home", "p-archive", "p-tasks"] },
      { id: "admin", name: "系统配置管理员", permissions: ["config:manage"], scope: "self", pages: ["p-config"] }
    ],
    groups: [{ id: "business", name: "活动协作", active: true }, { id: "system", name: "系统管理", active: true }],
    pages: [{ id: "p-home", name: "工作台", group: "business", component: "summary", active: true }, { id: "p-list", name: "活动工单", group: "business", component: "activity_list", active: true }, { id: "p-new", name: "发起活动", group: "business", component: "activity_form", formId: "activity", active: true }, { id: "p-tasks", name: "我的待办", group: "business", component: "task_list", active: true }, { id: "p-archive", name: "活动档案", group: "business", component: "archive_list", active: true }, { id: "p-config", name: "配置概览", group: "system", component: "config_overview", active: true }],
    form: { id: "activity", name: "活动申请表", fields: [
      { id: "f-name", key: "activity_name", label: "活动名称", type: "text", required: true, default: "阅读教学与表达研讨活动", options: [], system: true },
      { id: "f-mode", key: "delivery_mode", label: "举办方式", type: "select", required: true, default: "线下", options: ["线下", "线上", "混合"] },
      { id: "f-time", key: "start_at", label: "开始时间", type: "datetime", required: true, default: cmFuture(), options: [] },
      { id: "f-place", key: "location", label: "活动地点", type: "text", required: true, default: "和美实验学校", options: [], visible: { field: "delivery_mode", operator: "neq", value: "线上" } },
      { id: "f-budget", key: "budget", label: "预算总额（元）", type: "number", required: true, default: "8000", options: [], min: 0 },
      { id: "f-background", key: "background", label: "背景与诉求", type: "textarea", required: true, default: "结合学校教情学情开展示范研讨，形成课堂改进建议。", options: [] }
    ] },
    workflow: { name: "教研活动审核", nodes: [
      { id: "n-department", label: "部门初审", kind: "approval", deps: [], assignee: { type: "manager", value: "" }, protected: true },
      { id: "n-academic", label: "教研方案审核", kind: "approval", deps: ["n-department"], assignee: { type: "role", value: "academic" } },
      { id: "n-marketing", label: "营销与校方确认", kind: "approval", deps: ["n-department"], assignee: { type: "role", value: "marketing" } },
      { id: "n-director", label: "院负责人复核", kind: "approval", deps: ["n-academic", "n-marketing"], assignee: { type: "role", value: "director" }, condition: { field: "budget", operator: "gte", value: "10000" } }
    ] }
  };
}

/**
 * 按稳定标识查找对象。
 * @param {Array<object>} list 对象列表
 * @param {string} id 稳定标识
 * @returns {object|undefined} 匹配对象
 */
function cmFind(list, id) { for (const item of list) if (item.id === id) return item; return undefined; }

/**
 * 判断部门是否属于目标部门及其下级，并防止组织循环造成无限遍历。
 * @param {object} config 公司配置
 * @param {string} department 需要判断的部门
 * @param {string} ancestor 上级部门
 * @returns {boolean} 是否在授权部门树内
 */
function cmWithin(config, department, ancestor) { const seen = new Set(); let id = department; while (id && !seen.has(id)) { if (id === ancestor) return true; seen.add(id); id = cmFind(config.departments, id)?.parent; } return false; }

/**
 * 校验成员与全部上级部门是否有效。
 * @param {object} config 公司配置
 * @param {string} userId 成员标识
 * @returns {boolean} 是否是有效公司成员
 */
function cmActiveUser(config, userId) {
  const user = cmFind(config.users, userId); if (!user?.active) return false;
  const seen = new Set(); let id = user.department;
  while (id) { if (seen.has(id)) return false; seen.add(id); const dept = cmFind(config.departments, id); if (!dept?.active) return false; id = dept.parent; }
  return seen.size > 0;
}

/**
 * 取得有效成员当前所拥有的角色。
 * @param {object} config 公司配置
 * @param {string} userId 成员标识
 * @returns {Array<object>} 有效角色集合
 */
function cmUserRoles(config, userId) { const result = []; if (!cmActiveUser(config, userId)) return result; for (const id of cmFind(config.users, userId).roles) { const role = cmFind(config.roles, id); if (role) result.push(role); } return result; }

/**
 * 根据有效角色检查动作权限，未授权默认拒绝。
 * @param {object} config 公司配置
 * @param {string} userId 成员标识
 * @param {string} code 操作权限码
 * @returns {boolean} 是否拥有操作权限
 */
function cmHas(config, userId, code) { for (const role of cmUserRoles(config, userId)) if (role.permissions.includes(code)) return true; return false; }

/**
 * 同时检查菜单、父分组、页面授权与模板所需权限。
 * @param {object} config 公司配置
 * @param {string} userId 成员标识
 * @param {string} pageId 页面标识
 * @returns {boolean} 是否允许访问该页面
 */
function cmPageAllowed(config, userId, pageId) {
  const page = cmFind(config.pages, pageId); if (!page?.active || !cmFind(config.groups, page.group)?.active || !CM_COMPONENTS[page.component]) return false;
  if (!cmHas(config, userId, CM_COMPONENTS[page.component][1])) return false;
  for (const role of cmUserRoles(config, userId)) if (role.pages.includes(pageId)) return true;
  return false;
}

/**
 * 取得运行身份可访问的动态菜单页面。
 * @param {object} config 公司配置
 * @param {string} userId 成员标识
 * @returns {Array<object>} 已授权且启用的页面
 */
function cmPages(config, userId) { const pages = []; for (const page of config.pages) if (cmPageAllowed(config, userId, page.id)) pages.push(page); return pages; }

/**
 * 检查活动记录的数据范围，页面入口与详情共用此规则。
 * @param {object} config 当前公司配置
 * @param {string} userId 当前成员
 * @param {object} record 活动记录
 * @returns {boolean} 是否可读该记录
 */
function cmCanRead(config, userId, record) {
  if (!cmHas(config, userId, "activity:read")) return false;
  const user = cmFind(config.users, userId);
  for (const role of cmUserRoles(config, userId)) {
    if (!role.permissions.includes("activity:read")) continue;
    if (role.scope === "all" || (role.scope === "self" && record.applicant === userId) || (role.scope === "department" && record.department === user.department) || (role.scope === "department_tree" && cmWithin(config, record.department, user.department))) return true;
    if (role.scope === "tasks") for (const node of record.nodes || []) if (node.assignees.includes(userId)) return true;
  }
  return false;
}

/**
 * 取得字段当前值，显式空字符串不会被默认值覆盖。
 * @param {object} field 字段定义
 * @param {object} values 用户填写内容
 * @returns {string} 用于显示与校验的字段值
 */
function cmValue(field, values) { return String(Object.hasOwn(values, field.key) ? values[field.key] : field.default || ""); }

/**
 * 执行受控字段比较，仅允许等于、不等于和非负金额大于等于。
 * @param {object} condition 字段条件
 * @param {object} values 已归一化字段内容
 * @returns {boolean} 是否命中条件
 */
function cmMatches(condition, values) {
  if (!condition) return true;
  if (condition.operator === "gte") { const a = cmNumber(values[condition.field]); const b = cmNumber(condition.value); return Number.isFinite(a) && Number.isFinite(b) && a >= b; }
  if (condition.operator === "neq") return String(values[condition.field] ?? "") !== String(condition.value);
  return String(values[condition.field] ?? "") === String(condition.value);
}

/**
 * 将非负两位小数转为整数分，缺失或非法数字返回 NaN。
 * @param {unknown} value 输入金额或数字
 * @returns {number} 整数分或 NaN
 */
function cmNumber(value) { const text = String(value ?? "").trim(); if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN; const n = Math.round(Number(text) * 100); return Number.isSafeInteger(n) && n <= 10000000000 ? n : NaN; }

/**
 * 计算当前可见字段，显示条件的依赖字段也必须可见。
 * @param {object} form 表单定义
 * @param {object} values 原始表单内容
 * @returns {Array<object>} 可显示、可参与提交的字段
 */
function cmVisibleFields(form, values) {
  const all = {}; for (const field of form.fields) all[field.key] = cmValue(field, values);
  const visited = new Set(); let changed = true;
  while (changed) { changed = false; for (const field of form.fields) if (!visited.has(field.key) && (!field.visible || (visited.has(field.visible.field) && cmMatches(field.visible, all)))) { visited.add(field.key); changed = true; } }
  const result = []; for (const field of form.fields) if (visited.has(field.key)) result.push(field); return result;
}

/**
 * 校验动态表单并生成只包含可见字段的 payload。
 * @param {object} form 表单定义
 * @param {object} values 原始输入
 * @returns {object} 错误列表与可提交内容
 */
function cmValidateForm(form, values) {
  const errors = []; const payload = {};
  for (const field of cmVisibleFields(form, values)) {
    const value = cmValue(field, values).trim(); payload[field.key] = value;
    if (field.required && !value) { errors.push(field.label + "为必填项。"); continue; }
    if (!value) continue;
    if (field.type === "number" && !Number.isFinite(cmNumber(value))) errors.push(field.label + "需为非负数字，至多两位小数。");
    if (field.type === "select" && !field.options.includes(value)) errors.push(field.label + "请选择配置中的有效选项。");
    if (field.type === "datetime" && !Number.isFinite(Date.parse(value))) errors.push(field.label + "请填写有效日期时间。");
    if (value.length > 3000) errors.push(field.label + "超过 3000 字限制。");
  }
  return { errors, payload };
}

/**
 * 查找字段被其他显示规则或流程条件引用的位置。
 * @param {object} config 公司配置
 * @param {string} key 字段稳定键
 * @returns {Array<string>} 引用位置说明
 */
function cmFieldRefs(config, key) { const refs = []; for (const field of config.form.fields) if (field.visible?.field === key) refs.push("表单「" + field.label + "」显示条件"); for (const node of config.workflow.nodes) if (node.condition?.field === key) refs.push("流程「" + node.label + "」条件"); return refs; }

/**
 * 检查流程依赖是否合法并给出拓扑顺序。
 * @param {Array<object>} nodes 流程节点
 * @returns {object} 错误与拓扑顺序
 */
function cmDag(nodes) {
  const ids = new Set(); for (const node of nodes) { if (ids.has(node.id)) return { error: "流程节点标识重复。", order: [] }; ids.add(node.id); }
  for (const node of nodes) for (const id of node.deps) if (!ids.has(id)) return { error: "流程包含不存在的前置节点。", order: [] };
  const order = []; const seen = new Set(); let changed = true;
  while (changed) { changed = false; for (const node of nodes) { if (seen.has(node.id)) continue; let all = true; for (const id of node.deps) if (!seen.has(id)) all = false; if (all) { seen.add(node.id); order.push(node); changed = true; } } }
  return seen.size === nodes.length ? { error: "", order } : { error: "流程存在循环依赖。", order: [] };
}

/**
 * 根据有效组织与角色解析节点受理人，多人角色按全部办理汇合。
 * @param {object} config 公司配置
 * @param {object} node 流程定义节点
 * @param {string} applicant 申请人标识
 * @returns {object} 受理人集合与错误
 */
function cmAssignees(config, node, applicant) {
  const ids = []; const user = cmFind(config.users, applicant);
  if (!user || !cmActiveUser(config, applicant)) return { ids, error: "申请人或其部门已停用。" };
  if (node.assignee.type === "manager") { const id = cmFind(config.departments, user.department)?.manager; if (id) ids.push(id); }
  if (node.assignee.type === "user") ids.push(node.assignee.value);
  if (node.assignee.type === "role") for (const member of config.users) if (member.roles.includes(node.assignee.value) && cmActiveUser(config, member.id)) ids.push(member.id);
  if (!ids.length) return { ids, error: node.label + "未解析到受理人。" };
  for (const id of ids) {
    if (!cmActiveUser(config, id)) return { ids, error: node.label + "的受理人或部门已停用。" };
    if (node.kind === "approval" && id === applicant) return { ids, error: node.label + "出现自审，请配置替代人。" };
    const permission = node.kind === "approval" ? "approval:decide" : "task:complete";
    if (node.kind !== "notice" && (!cmHas(config, id, permission) || !cmHas(config, id, "activity:read"))) return { ids, error: node.label + "的受理人缺少查看或办理权限。" };
  }
  return { ids, error: "" };
}

/**
 * 将表单内容和流程模板解析成实例，条件跳过时递归继承原有前置。
 * @param {object} config 配置版本
 * @param {object} payload 提交内容
 * @param {string} applicant 申请人
 * @returns {object} 实际节点、跳过原因与错误
 */
function cmResolve(config, payload, applicant) {
  const dag = cmDag(config.workflow.nodes); if (dag.error) return { nodes: [], skipped: [], errors: [dag.error] };
  const nodes = []; const skipped = []; const errors = []; const matched = new Set();
  for (const def of dag.order) if (cmMatches(def.condition, payload)) matched.add(def.id); else skipped.push(def.label + "：条件未命中");
  /**
   * 继承被条件跳过或非阻塞知会节点的前置，保留所有必要审核。
   * @param {string} id 原前置标识
   * @returns {Array<string>} 实际生效的前置标识
   */
  function effectiveDeps(id) { const def = cmFind(config.workflow.nodes, id); if (matched.has(id) && def.kind !== "notice") return [id]; const deps = []; for (const parent of def.deps) deps.push(...effectiveDeps(parent)); return [...new Set(deps)]; }
  for (const def of dag.order) {
    if (!matched.has(def.id)) continue;
    const assignees = cmAssignees(config, def, applicant); if (assignees.error) errors.push(assignees.error);
    const deps = []; for (const id of def.deps) deps.push(...effectiveDeps(id));
    nodes.push({ id: def.id, label: def.label, kind: def.kind, deps: [...new Set(deps)], assignees: assignees.ids, rule: cmCopy(def.assignee), doneBy: [], status: "todo" });
  }
  if (!nodes.length || !nodes.some(cmIsApproval)) errors.push("有效流程至少包含一个审核节点。");
  const applicantUser = cmFind(config.users, applicant);
  const prospective = { applicant, department: applicantUser?.department || "", nodes };
  for (const node of nodes) if (node.kind !== "notice") for (const userId of node.assignees) if (!cmCanRead(config, userId, prospective)) errors.push(node.label + "的受理人数据范围不覆盖本活动。");
  return { nodes, skipped, errors };
}

/**
 * 判断节点是否为审批，用于阻止无审批路线。
 * @param {object} node 流程节点
 * @returns {boolean} 是否为审批节点
 */
function cmIsApproval(node) { return node.kind === "approval"; }

/**
 * 判断实例任务是否已满足全部生效前置。
 * @param {object} record 活动实例
 * @param {object} node 当前任务
 * @returns {boolean} 是否可办理
 */
function cmTaskReady(record, node) { if (record.status !== "approving" || node.status !== "todo") return false; for (const id of node.deps) if (cmFind(record.nodes, id)?.status !== "done") return false; return true; }

/**
 * 检查当前账号办理实例节点的权限、归属、组织资格与自审条件。
 * @param {object} config 当前身份配置
 * @param {string} userId 当前员工
 * @param {object} record 活动实例
 * @param {object} node 实例任务
 * @returns {boolean} 是否允许办理
 */
function cmCanAct(config, userId, record, node) {
  if (!cmCanRead(config, userId, record) || !cmTaskReady(record, node) || !node.assignees.includes(userId) || node.doneBy.includes(userId)) return false;
  if (node.kind === "approval" && userId === record.applicant) return false;
  if (node.rule.type === "role" && !cmFind(config.users, userId).roles.includes(node.rule.value)) return false;
  return cmHas(config, userId, node.kind === "approval" ? "approval:decide" : "task:complete");
}

/**
 * 检查配置引用、组织、字段条件与流程结构，发布前统一阻止不完整配置。
 * @param {object} config 待发布配置
 * @returns {Array<string>} 校验错误列表
 */
function cmValidateConfig(config) {
  const errors = []; const fields = new Set();
  const titleField = cmFindField(config, "activity_name");
  if (!titleField || titleField.type !== "text" || !titleField.required) errors.push("系统活动名称字段需保留为必填文字。");
  for (const field of config.form.fields) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(field.key) || fields.has(field.key)) errors.push("字段键格式无效或重复：" + field.key);
    fields.add(field.key); if (!field.label.trim()) errors.push("字段标题不能为空。");
    if (!["text", "textarea", "number", "select", "datetime"].includes(field.type)) errors.push("字段类型未注册。");
    if (field.type === "select" && !field.options.length) errors.push(field.label + "缺少下拉选项。");
    if (field.default && field.type === "select" && !field.options.includes(field.default)) errors.push(field.label + "默认值不在下拉选项中。");
    if (field.default && field.type === "number" && !Number.isFinite(cmNumber(field.default))) errors.push(field.label + "默认数字无效。");
  }
  const visibilityNodes = [];
  for (const field of config.form.fields) {
    visibilityNodes.push({ id: field.key, deps: field.visible ? [field.visible.field] : [] });
    if (field.visible && !fields.has(field.visible.field)) errors.push(field.label + "引用了不存在的显示条件字段。");
    if (field.visible) { const source = cmFindField(config, field.visible.field); if (source?.type === "select" && !source.options.includes(field.visible.value)) errors.push(field.label + "显示条件值不在来源选项中。"); }
  }
  if (cmDag(visibilityNodes).error) errors.push("字段显示条件存在循环或缺失引用。");
  if (!config.workflow.nodes.length || !config.workflow.nodes.some(cmIsApproval)) errors.push("流程至少保留一个审核节点。");
  const dag = cmDag(config.workflow.nodes); if (dag.error) errors.push(dag.error);
  for (const node of config.workflow.nodes) {
    if (node.protected && (node.kind !== "approval" || node.condition)) errors.push(node.label + "为必要审核，不能降级或设置跳过条件。");
    if (node.condition) {
      const field = cmFindField(config, node.condition.field);
      if (!field) errors.push(node.label + "引用字段不存在。");
      else if (node.condition.operator === "gte" && (field.type !== "number" || !Number.isFinite(cmNumber(node.condition.value)))) errors.push(node.label + "的金额条件需要数字字段与有效阈值。");
      else if (field.type === "select" && !field.options.includes(node.condition.value)) errors.push(node.label + "条件值不在字段选项中。");
    }
    if (node.assignee.type === "user" && !cmActiveUser(config, node.assignee.value)) errors.push(node.label + "指定员工无效。");
    if (node.assignee.type === "role" && !cmFind(config.roles, node.assignee.value)) errors.push(node.label + "指定角色不存在。");
  }
  for (const dept of config.departments) {
    if (dept.parent && !cmFind(config.departments, dept.parent)) errors.push(dept.name + "上级部门不存在。");
    if (dept.parent && cmWithin(config, dept.parent, dept.id)) errors.push(dept.name + "组织层级存在循环。");
    if (dept.manager) { const user = cmFind(config.users, dept.manager); if (!user || user.department !== dept.id || (dept.active && !cmActiveUser(config, user.id))) errors.push(dept.name + "负责人需是本部门有效成员。"); }
  }
  let admins = 0;
  for (const user of config.users) { if (!cmFind(config.departments, user.department)) errors.push(user.name + "所属部门不存在。"); for (const id of user.roles) if (!cmFind(config.roles, id)) errors.push(user.name + "绑定了不存在的角色。"); if (cmHas(config, user.id, "config:manage")) admins += 1; }
  if (!admins) errors.push("至少保留一名有效配置管理员。");
  for (const page of config.pages) { if (!CM_COMPONENTS[page.component] || !cmFind(config.groups, page.group)) errors.push(page.name + "页面模板或父分组无效。"); if (page.component === "activity_form" && page.formId !== config.form.id) errors.push(page.name + "表单绑定无效。"); }
  for (const role of config.roles) { if (!CM_SCOPES[role.scope]) errors.push(role.name + "数据范围无效。"); for (const id of role.pages) if (!cmFind(config.pages, id)) errors.push(role.name + "授权了不存在的页面。"); }
  return [...new Set(errors)];
}

/**
 * 按稳定字段键取得定义，供条件引用检查。
 * @param {object} config 配置
 * @param {string} key 字段键
 * @returns {object|undefined} 字段定义
 */
function cmFindField(config, key) { for (const field of config.form.fields) if (field.key === key) return field; return undefined; }
