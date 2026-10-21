"use strict";

const CC_KEY = "xingzhi-configuration-center-v3";
const CC_ADMIN = "u-xu";
let ccStorageAvailable = true;
let ccDb = ccLoad();
const ccView = { tab: "overview", department: "d1", role: "applicant", source: "published", previewUser: "u-lin", workflowApplicant: "u-lin", runtimePage: "", record: "", values: {}, formErrors: [], dialog: "", editId: "" };
let ccToastTimer;

/**
 * 创建配置中心独立数据，示例活动用于验证本人和部门范围。
 * @returns {object} 草案、发布版本、活动实例与配置审计
 */
function ccSeed() {
  const published = cmSeedConfig();
  return { schema: 3, published, draft: cmCopy(published), records: [
    { id: "sample-1", name: "阅读教学与表达研讨", department: "d1", applicant: "u-lin", status: "archived", configVersion: 1, version: 1, nodes: [] },
    { id: "sample-2", name: "秋季课程教研分享", department: "d1", applicant: "u-lin", status: "approved", configVersion: 1, version: 1, nodes: [] },
    { id: "sample-3", name: "整本书阅读专题培训", department: "d2", applicant: "u-qiao", status: "archived", configVersion: 1, version: 1, nodes: [] }
  ], audit: [{ title: "初始化配置 C1", at: new Date().toLocaleString("zh-CN"), note: "五项配置已建立引用。示例账户与活动用于本地评审。" }] };
}

/**
 * 读取配置中心本地数据，无法读取时使用内存中的示例配置。
 * @returns {object} 独立配置数据库
 */
function ccLoad() { try { const raw = localStorage.getItem(CC_KEY); if (raw) { const data = JSON.parse(raw); if (data.schema === 3 && data.published && data.draft && Array.isArray(data.records)) return data; } } catch { ccStorageAvailable = false; } return ccSeed(); }

/**
 * 保存草案与本地演示实例，存储失败时保留当前页面内数据。
 */
function ccPersist() { try { localStorage.setItem(CC_KEY, JSON.stringify(ccDb)); } catch { ccStorageAvailable = false; ccToast("本地存储不可用，修改仅在本次页面内保留。", true); } }

/**
 * 取得联动体验区选择的配置版本。
 * @returns {object} 草案或已发布配置
 */
function ccConfig() { return ccView.source === "draft" ? ccDb.draft : ccDb.published; }

/**
 * 根据当前管理员的已发布授权校验配置写权限。
 * @returns {boolean} 是否允许配置写入
 */
function ccCanConfigure() { if (cmHas(ccDb.published, CC_ADMIN, "config:manage")) return true; ccToast("当前配置账号没有管理权限。", true); return false; }

/**
 * 显示简明操作反馈，不覆盖页面正文。
 * @param {string} text 中文提示
 * @param {boolean} error 是否为错误
 */
function ccToast(text, error = false) { const node = document.getElementById("config-toast"); node.textContent = text; node.hidden = false; node.classList.toggle("error", error); clearTimeout(ccToastTimer); ccToastTimer = setTimeout(/** 隐藏已展示的配置操作反馈，无返回值。 */ function hideConfigToast() { node.hidden = true; }, 4500); }

/**
 * 追加配置审计，记录动作与实际配置工作账号。
 * @param {string} title 配置动作
 * @param {string} note 变更说明
 */
function ccAudit(title, note = "") { ccDb.audit.push({ title, note: "许言 · " + note, at: new Date().toLocaleString("zh-CN", { hour12: false }) }); if (ccDb.audit.length > 200) ccDb.audit.shift(); }

/**
 * 将配置修改保存到草案并刷新当前模块，发布配置保持不变。
 * @param {string} title 修改动作
 */
function ccDraftChanged(title) { ccAudit("草案：" + title, "未影响已发布配置。"); ccPersist(); cvRender(); }

/**
 * 显示实例状态，审核完成不直接代表活动已执行。
 * @param {string} status 实例状态
 * @returns {string} 中文业务状态
 */
function ccStatus(status) { return { approving: "审核中", approved: "审核完成，待安排执行", archived: "已归档" }[status] || status; }

/**
 * 关闭配置编辑弹窗并清理编辑上下文。
 */
function ccCloseDialog() { const dialog = document.getElementById("config-dialog"); if (dialog.open) dialog.close(); ccView.dialog = ""; ccView.editId = ""; }

/**
 * 打开统一配置编辑弹窗，不直接写入草案。
 * @param {string} kind 编辑类型
 * @param {string} title 弹窗标题
 * @param {string} body 已转义的字段 HTML
 * @param {string} id 现有对象标识
 * @param {string} confirm 确认按钮文案
 */
function ccDialog(kind, title, body, id = "", confirm = "保存到草案") {
  ccView.dialog = kind; ccView.editId = id;
  document.getElementById("config-dialog-title").textContent = title;
  document.getElementById("config-dialog-body").innerHTML = '<div class="dialog-error" id="config-dialog-error" role="alert" hidden></div><div class="config-dialog-body">' + body + "</div>";
  document.getElementById("config-dialog-confirm").textContent = confirm;
  document.getElementById("config-dialog").showModal();
}

/**
 * 在弹窗内显示局部校验错误，保留用户填写内容。
 * @param {string} message 中文错误说明
 */
function ccDialogError(message) { const el = document.getElementById("config-dialog-error"); el.textContent = message; el.hidden = false; }

/**
 * 将列表转换为原生选择控件选项。
 * @param {Array<object>} list 配置对象列表
 * @param {string} label 显示属性
 * @returns {Array<Array<string>>} 选项键值对
 */
function ccOptions(list, label = "name") { const result = []; for (const item of list) result.push([item.id, item[label]]); return result; }

/**
 * 输出多角色或页面授权选择框。
 * @param {string} name 提交字段名
 * @param {Array<object>} list 角色对象
 * @param {Array<string>} selected 已选标识
 * @returns {string} 多选复选框组
 */
function ccChecks(name, list, selected) { let html = '<div class="grant-grid">'; for (const item of list) html += `<label><input type="checkbox" name="${name}" value="${item.id}" ${selected.includes(item.id) ? "checked" : ""}>${cvEsc(item.name)}</label>`; return html + "</div>"; }

/**
 * 打开字段配置，已有字段键保持稳定，显示条件引用当前 schema。
 * @param {string} id 已有字段标识，空值表示新建
 */
function ccEditField(id = "") {
  if (!ccCanConfigure()) return;
  const field = cmFind(ccDb.draft.form.fields, id) || { key: "", label: "", type: "text", required: false, default: "", options: [] };
  const refs = [["", "始终显示"]]; for (const other of ccDb.draft.form.fields) if (other.id !== id) refs.push([other.key, other.label]);
  const types = Object.entries(CV_FIELD_TYPES);
  let body = '<p class="config-dialog-hint">字段键供条件与提交快照引用，现有字段不修改键。下拉选项按逗号或换行分隔。</p><div class="form-grid">';
  body += cvField("label", "中文标题", field.label, { required: true }) + cvField("key", "字段键（英文）", field.key, { required: true, readonly: !!id, pattern: "[a-z][a-z0-9_]{1,39}" });
  body += cvField("type", "字段类型", field.type, { options: types }) + cvField("required", "是否必填", field.required ? "yes" : "no", { options: [["yes", "必填"], ["no", "选填"]] });
  body += cvField("default", "默认值", field.default, { textarea: true, full: true }) + cvField("options", "下拉选项", field.options.join("\n"), { textarea: true, full: true });
  body += cvField("visible_field", "显示条件字段", field.visible?.field || "", { options: refs }) + cvField("visible_operator", "比较方式", field.visible?.operator || "eq", { options: [["eq", "等于"], ["neq", "不等于"]] }) + cvField("visible_value", "条件值", field.visible?.value || "", { full: true });
  ccDialog("field", id ? "编辑动态字段" : "新增动态字段", body + "</div>", id);
}

/**
 * 打开流程节点配置，新增可选择前插、后插或并行。
 * @param {string} id 已有节点标识
 */
function ccEditNode(id = "") {
  if (!ccCanConfigure()) return;
  const c = ccDb.draft; const node = cmFind(c.workflow.nodes, id) || { label: "", kind: "approval", deps: [], assignee: { type: "manager", value: "" } };
  let body = '<p class="config-dialog-hint">角色命中多人时全部办理后汇合。条件未命中的节点会被跳过，后继继承原前置。</p><div class="form-grid">';
  body += cvField("label", "节点名称", node.label, { required: true }) + cvField("kind", "节点类型", node.kind, { options: [["approval", "审核"], ["task", "办理任务"], ["notice", "非阻塞知会"]] });
  body += cvField("assignee_type", "受理规则", node.assignee.type, { options: [["manager", "申请部门负责人"], ["role", "指定角色"], ["user", "指定员工"]], full: true });
  body += cvField("assignee_role", "受理角色", node.assignee.type === "role" ? node.assignee.value : c.roles[0].id, { options: ccOptions(c.roles) });
  body += cvField("assignee_user", "受理员工", node.assignee.type === "user" ? node.assignee.value : c.users[0].id, { options: ccOptions(c.users) });
  if (!id) { body += cvField("anchor", "插入位置参照", c.workflow.nodes[0]?.id || "", { options: ccOptions(c.workflow.nodes, "label") }) + cvField("position", "插入方式", "after", { options: [["before", "节点之前"], ["after", "节点之后"], ["parallel", "与节点并行"]] }); }
  else { const deps = []; for (const dep of node.deps) deps.push(cmFind(c.workflow.nodes, dep)?.label || dep); body += `<p class="config-dialog-hint full">当前前置：${cvEsc(deps.join(" ＋ ") || "提交申请")}。调整顺序可通过插入新节点完成。</p>`; }
  const fields = [["", "所有申请生效"]]; for (const field of c.form.fields) fields.push([field.key, field.label]);
  body += cvField("condition_field", "生效条件字段", node.condition?.field || "", { options: fields }) + cvField("condition_operator", "条件比较", node.condition?.operator || "gte", { options: [["gte", "数字大于等于"], ["eq", "等于"], ["neq", "不等于"]] }) + cvField("condition_value", "条件值", node.condition?.value || "", { full: true });
  ccDialog("node", id ? "编辑流程节点" : "新增流程节点", body + "</div>", id);
}

/**
 * 打开部门配置，负责人选项限定在该部门现有成员。
 * @param {string} id 已有部门标识
 */
function ccEditDepartment(id = "") {
  if (!ccCanConfigure()) return;
  const c = ccDb.draft; const dept = cmFind(c.departments, id) || { name: "", parent: ccView.department, manager: "", active: true };
  let body = cvField("name", "部门名称", dept.name, { required: true });
  if (!id) body += cvField("parent", "上级部门", dept.parent, { options: ccOptions(c.departments) });
  else { const members = [["", "暂未配置"]]; for (const user of c.users) if (user.department === id) members.push([user.id, user.name]); body += cvField("manager", "部门负责人", dept.manager, { options: members }); }
  body += cvField("active", "部门状态", dept.active ? "yes" : "no", { options: [["yes", "启用"], ["no", "停用"]] });
  body += '<p class="config-dialog-hint">新部门先添加成员，再设置负责人。部门层级、负责人有效性和最后管理员在发布时校验。</p>';
  ccDialog("department", id ? "编辑部门" : "新增部门", body, id);
}

/**
 * 打开成员编辑，维护主部门、账号状态和多个角色。
 * @param {string} id 成员标识
 */
function ccEditUser(id = "") {
  if (!ccCanConfigure()) return;
  const c = ccDb.draft; const user = cmFind(c.users, id) || { name: "", department: ccView.department, roles: [], active: true };
  let body = cvField("name", "员工姓名", user.name, { required: true }) + cvField("department", "主部门", user.department, { options: ccOptions(c.departments) }) + cvField("active", "账号状态", user.active ? "yes" : "no", { options: [["yes", "启用"], ["no", "停用"]] });
  body += '<h3 class="config-section-title">角色，可多选</h3>' + ccChecks("roles", c.roles, user.roles) + '<p class="config-dialog-hint">主部门用于数据范围和负责人解析，角色决定功能授权。负责人调离部门后需同步调整部门配置。</p>';
  ccDialog("user", id ? "编辑员工" : "新增员工", body, id);
}

/**
 * 打开菜单页面配置，页面只引用已注册模板并授予指定角色。
 * @param {string} id 页面标识
 */
function ccEditPage(id = "") {
  if (!ccCanConfigure()) return;
  const c = ccDb.draft; const page = cmFind(c.pages, id) || { name: "", group: "business", component: "activity_list", active: true };
  const selected = []; for (const role of c.roles) if (role.pages.includes(id)) selected.push(role.id);
  const components = []; for (const [key, value] of Object.entries(CM_COMPONENTS)) components.push([key, value[0]]);
  let body = cvField("name", "页面与菜单名称", page.name, { required: true }) + cvField("group", "所属分组", page.group, { options: ccOptions(c.groups) }) + cvField("component", "页面模板", page.component, { options: components }) + cvField("active", "页面状态", page.active ? "yes" : "no", { options: [["yes", "启用"], ["no", "停用"]] });
  body += '<h3 class="config-section-title">授权角色</h3>' + ccChecks("roles", c.roles, selected) + '<p class="config-dialog-hint">申请表单模板自动绑定活动表单。授权入口后仍需对应操作权限，记录仍受角色数据范围过滤。</p>';
  ccDialog("page", id ? "编辑菜单页面" : "新增菜单页面", body, id);
}

/**
 * 分割下拉选项，移除空项并保留初次出现的顺序。
 * @param {string} text 逗号或换行分隔的文本
 * @returns {Array<string>} 去重的选项列表
 */
function ccSplit(text) { const values = []; for (const value of text.split(/[,，\n]/)) { const trimmed = value.trim(); if (trimmed && !values.includes(trimmed)) values.push(trimmed); } return values; }

/**
 * 保存编辑弹窗内容，每类变更先校验局部引用与依赖，再写入草案。
 * @param {SubmitEvent} event 原生表单提交事件
 */
function ccSubmitDialog(event) {
  event.preventDefault();
  const kind = ccView.dialog;
  if (kind === "direct") { const data = new FormData(event.target); ccView.runtimePage = String(data.get("page")); ccView.record = ""; ccCloseDialog(); cvRender(); return; }
  if (!ccCanConfigure()) return;
  if (kind === "publish") { ccPublish(); return; }
  if (kind === "delete-field" || kind === "delete-node" || kind === "reset") { ccConfirmDelete(); return; }
  const form = new FormData(event.target); const values = Object.fromEntries(form.entries()); const c = ccDb.draft; const id = ccView.editId;
  if (kind === "field") {
    const old = cmFind(c.form.fields, id);
    const key = old?.key || String(values.key || "").trim();
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key) || !String(values.label).trim()) { ccDialogError("字段键需为 2—40 位小写英文、数字或下划线，标题不能为空。"); return; }
    for (const field of c.form.fields) if (field.key === key && field.id !== id) { ccDialogError("字段键已存在。"); return; }
    if (old && old.type !== values.type && cmFieldRefs(c, old.key).length) { ccDialogError("该字段被条件引用，需先解除引用再改变类型。"); return; }
    const field = { id: id || cmId("field"), key, label: String(values.label).trim(), type: values.type, required: values.required === "yes", default: values.default || "", options: ccSplit(values.options || "") };
    if (old?.system && (field.type !== "text" || !field.required)) { ccDialogError("活动名称为系统必填文字字段。"); return; }
    if (old?.system) field.system = true;
    if (field.type === "select" && !field.options.length) { ccDialogError("下拉字段至少需要一个选项。"); return; }
    if (values.visible_field) { if (values.visible_field === key) { ccDialogError("字段不能依赖自身的显示条件。"); return; } field.visible = { field: values.visible_field, operator: values.visible_operator, value: values.visible_value || "" }; }
    if (old) c.form.fields[c.form.fields.indexOf(old)] = field; else c.form.fields.push(field);
  }
  if (kind === "node") {
    const old = cmFind(c.workflow.nodes, id); const next = cmCopy(c.workflow.nodes);
    if (!String(values.label || "").trim()) { ccDialogError("请填写节点名称。"); return; }
    if (old?.protected && (values.kind !== "approval" || values.condition_field)) { ccDialogError("必要审核节点需保留审核类型，不能设置跳过条件。"); return; }
    const assignee = { type: values.assignee_type, value: values.assignee_type === "role" ? values.assignee_role : values.assignee_type === "user" ? values.assignee_user : "" };
    const node = { id: id || cmId("node"), label: String(values.label).trim(), kind: values.kind, deps: old ? [...old.deps] : [], assignee };
    if (old?.protected) node.protected = true;
    if (values.condition_field) {
      const field = cmFindField(c, values.condition_field);
      if (!field || (values.condition_operator === "gte" && (field.type !== "number" || !Number.isFinite(cmNumber(values.condition_value))))) { ccDialogError("大于等于条件必须使用数字字段和有效非负阈值。"); return; }
      node.condition = { field: values.condition_field, operator: values.condition_operator, value: values.condition_value || "" };
    }
    if (old) next[c.workflow.nodes.indexOf(old)] = node;
    else {
      const anchor = cmFind(next, values.anchor); if (!anchor) { ccDialogError("请选择参照节点。"); return; }
      node.deps = values.position === "after" ? [anchor.id] : [...anchor.deps];
      if (node.kind !== "notice") {
        if (values.position === "before") anchor.deps = [node.id];
        else for (const child of next) if (child.deps.includes(anchor.id)) { const deps = []; for (const dep of child.deps) deps.push(dep === anchor.id && values.position === "after" ? node.id : dep); if (values.position === "parallel") deps.push(node.id); child.deps = [...new Set(deps)]; }
      }
      next.splice(next.indexOf(anchor) + (values.position === "before" ? 0 : 1), 0, node);
    }
    const checked = cmDag(next); if (checked.error) { ccDialogError(checked.error); return; }
    c.workflow.nodes = next;
  }
  if (kind === "department") {
    const old = cmFind(c.departments, id);
    if (!String(values.name || "").trim()) { ccDialogError("部门名称不能为空。"); return; }
    if (old) Object.assign(old, { name: values.name.trim(), manager: values.manager || "", active: values.active === "yes" });
    else { const dept = { id: cmId("department"), name: values.name.trim(), parent: values.parent, manager: "", active: values.active === "yes" }; c.departments.push(dept); ccView.department = dept.id; }
  }
  if (kind === "user") {
    if (!String(values.name || "").trim()) { ccDialogError("员工姓名不能为空。"); return; }
    const user = { id: id || cmId("user"), name: values.name.trim(), department: values.department, active: values.active === "yes", roles: form.getAll("roles") };
    const old = cmFind(c.users, id); if (old) c.users[c.users.indexOf(old)] = user; else c.users.push(user);
    ccView.department = user.department;
  }
  if (kind === "role") {
    if (!String(values.name || "").trim()) { ccDialogError("角色名称不能为空。"); return; }
    const role = { id: cmId("role"), name: values.name.trim(), permissions: [], pages: [], scope: "self" }; c.roles.push(role); ccView.role = role.id;
  }
  if (kind === "page") {
    if (!String(values.name || "").trim() || !CM_COMPONENTS[values.component]) { ccDialogError("名称或页面模板无效。"); return; }
    const page = { id: id || cmId("page"), name: values.name.trim(), group: values.group, component: values.component, active: values.active === "yes" };
    if (page.component === "activity_form") page.formId = c.form.id;
    const old = cmFind(c.pages, id); if (old) c.pages[c.pages.indexOf(old)] = page; else c.pages.push(page);
    const grants = form.getAll("roles"); for (const role of c.roles) { const pages = []; for (const pageId of role.pages) if (pageId !== page.id) pages.push(pageId); if (grants.includes(role.id)) pages.push(page.id); role.pages = pages; }
  }
  const actionName = { field: "保存字段", node: "保存流程节点", department: "保存部门", user: "保存员工", role: "新增角色", page: "保存菜单页面" }[kind] || "保存配置";
  ccCloseDialog(); ccDraftChanged(actionName + " · " + (values.label || values.name || id)); ccToast("已保存到草案，发布后可在已发布体验中验证。");
}

/**
 * 发布经过全量结构检查的配置，保持所有已提交实例的内容与流程快照。
 */
function ccPublish() {
  if (!ccCanConfigure()) return;
  const errors = cmValidateConfig(ccDb.draft);
  if (!cmHas(ccDb.draft, CC_ADMIN, "config:manage")) errors.push("本演示固定由许言维护配置，请保留该账号配置权限；正式交接需要先切换管理账号。");
  if (errors.length) { ccDialogError(errors.join("；")); return; }
  const next = cmCopy(ccDb.draft); next.version = ccDb.published.version + 1;
  ccDb.published = next; ccDb.draft = cmCopy(next); ccAudit("发布配置 C" + next.version, "表单、流程、角色、组织和菜单同步发布；在途实例保留原快照。");
  ccPersist(); ccCloseDialog(); cvRender(); ccToast("配置 C" + next.version + " 已发布。");
}

/**
 * 确认删除时再次检查字段引用或必要节点，结构删除只修改草案。
 */
function ccConfirmDelete() {
  if (!ccCanConfigure()) return;
  const c = ccDb.draft; const id = ccView.editId;
  if (ccView.dialog === "reset") { ccDb = ccSeed(); ccView.record = ""; ccView.runtimePage = ""; ccView.values = {}; ccView.role = "applicant"; ccView.department = "d1"; ccPersist(); ccCloseDialog(); cvRender(); ccToast("已重置配置中心，其他原型演示保持原样。"); return; }
  if (ccView.dialog === "delete-field") {
    const field = cmFind(c.form.fields, id); if (!field) return;
    const refs = cmFieldRefs(c, field.key); if (field.system || refs.length) { ccDialogError(field.system ? "系统活动名称不可删除。" : "请先解除引用：" + refs.join("、")); return; }
    c.form.fields.splice(c.form.fields.indexOf(field), 1);
  }
  if (ccView.dialog === "delete-node") {
    const node = cmFind(c.workflow.nodes, id); if (!node) return;
    if (node.protected) { ccDialogError("必要审核节点不可删除。"); return; }
    let approvals = 0; for (const item of c.workflow.nodes) if (item.kind === "approval") approvals += 1;
    if (node.kind === "approval" && approvals <= 1) { ccDialogError("流程至少保留一个审核节点。"); return; }
    for (const child of c.workflow.nodes) if (child.deps.includes(id)) { const deps = []; for (const dep of child.deps) deps.push(...(dep === id ? node.deps : [dep])); child.deps = [...new Set(deps)]; }
    c.workflow.nodes.splice(c.workflow.nodes.indexOf(node), 1);
  }
  ccCloseDialog(); ccDraftChanged("移除配置对象"); ccToast("草案已更新。");
}

/**
 * 将当前表单提交为独立演示实例，提交入口二次检查页面、动作和当前身份。
 */
function ccSubmitRuntime() {
  const c = ccConfig(); const userId = ccView.previewUser; const page = cmFind(c.pages, ccView.runtimePage);
  if (ccView.record || !cmPageAllowed(c, userId, ccView.runtimePage) || page?.component !== "activity_form" || page.formId !== c.form.id || !cmHas(c, userId, "activity:submit")) { ccToast("当前页面或身份没有提交权限。", true); return; }
  const checked = cmValidateForm(c.form, ccView.values); const plan = cmResolve(c, checked.payload, userId);
  ccView.formErrors = [...cmValidateConfig(c), ...checked.errors, ...plan.errors]; if (ccView.formErrors.length) { cvRender(); return; }
  const user = cmFind(c.users, userId);
  const record = { id: cmId("activity"), name: checked.payload.activity_name || "动态活动申请", department: user.department, applicant: userId, status: "approving", configVersion: c.version, source: ccView.source, schema: cmCopy(c.form), payload: cmCopy(checked.payload), nodes: cmCopy(plan.nodes), version: 1 };
  ccDb.records.unshift(record); ccView.record = record.id; ccPersist(); cvRender(); ccToast("已生成审核任务。可切换部门负责人查看并办理。");
}

/**
 * 模拟办理实例节点，检查任务归属、当前权限、实例版本和前置条件。
 * @param {string} recordId 实例标识
 * @param {string} nodeId 任务节点
 * @param {number} version 按钮展示时的实例版本
 */
function ccActNode(recordId, nodeId, version) {
  const c = ccConfig(); const record = cmFind(ccDb.records, recordId); const node = record && cmFind(record.nodes, nodeId);
  if (!cmPageAllowed(c, ccView.previewUser, ccView.runtimePage) || !record || !node || record.version !== version || !cmCanAct(c, ccView.previewUser, record, node)) { ccToast("任务已变化，或当前身份不具备办理资格。", true); return; }
  node.doneBy.push(ccView.previewUser); if (node.doneBy.length === node.assignees.length) node.status = "done";
  let complete = true; for (const task of record.nodes) if (task.kind !== "notice" && task.status !== "done") complete = false;
  if (complete) { record.status = "approved"; for (const task of record.nodes) if (task.kind === "notice" && task.status === "todo") task.status = "closed"; }
  record.version += 1; ccPersist(); cvRender(); ccToast(complete ? "必要任务已全部完成，立项审核通过。" : "本任务办理已记录，后继按依赖激活。");
}

/**
 * 调整草案数组顺序，不改变配置对象的稳定标识。
 * @param {Array<object>} list 待排序配置数组
 * @param {string} id 对象标识
 * @param {number} direction 上移为 -1，下移为 1
 */
function ccMove(list, id, direction) { if (!ccCanConfigure()) return; const item = cmFind(list, id); const index = list.indexOf(item); const target = index + direction; if (index < 0 || target < 0 || target >= list.length) return; list.splice(index, 1); list.splice(target, 0, item); ccDraftChanged("调整显示顺序"); }

/**
 * 处理配置导航、编辑、发布及联动体验动作，修改入口统一检查权限。
 * @param {MouseEvent} event 用户点击事件
 */
function ccHandleClick(event) {
  const button = event.target.closest("[data-c-action]"); if (!button || button.disabled) return;
  const action = button.dataset.cAction; const id = button.dataset.id;
  if (action === "close") { ccCloseDialog(); return; }
  if (action === "nav") { ccView.tab = id; ccView.formErrors = []; cvRender(); return; }
  if (action === "runtime-page") { if (!cmPageAllowed(ccConfig(), ccView.previewUser, id)) { ccToast("无页面访问权限。", true); return; } ccView.runtimePage = id; ccView.record = ""; ccView.formErrors = []; cvRender(); return; }
  if (action === "open-record") { const record = cmFind(ccDb.records, id); if (!record || !cmPageAllowed(ccConfig(), ccView.previewUser, ccView.runtimePage) || !cmCanRead(ccConfig(), ccView.previewUser, record)) { ccToast("无此活动的访问权限。", true); return; } ccView.record = id; cvRender(); return; }
  if (action === "back-record") { ccView.record = ""; cvRender(); return; }
  if (action === "submit-runtime") { ccSubmitRuntime(); return; }
  if (action === "act-node") { ccActNode(id, button.dataset.node, Number(button.dataset.version)); return; }
  if (action === "validate-form") { ccView.formErrors = cmValidateForm(ccDb.draft.form, ccView.values).errors; cvRender(); if (!ccView.formErrors.length) ccToast("当前可见字段校验通过，隐藏字段不参与提交。"); return; }
  if (action === "select-department") { ccView.department = id; cvRender(); return; }
  if (action === "select-role") { ccView.role = id; cvRender(); return; }
  if (action === "direct-page") { ccDialog("direct", "验证页面直接访问", cvField("page", "目标页面", ccView.runtimePage, { options: ccOptions(ccConfig().pages) }) + '<p class="config-dialog-hint">可选择当前菜单未展示的页面，验证页面入口是否拒绝访问。</p>', "", "尝试访问"); return; }
  if (!ccCanConfigure()) return;
  if (action === "add-field" || action === "edit-field") { ccEditField(id); return; }
  if (action === "add-node" || action === "edit-node") { ccEditNode(id); return; }
  if (action === "add-department" || action === "edit-department") { ccEditDepartment(id); return; }
  if (action === "add-user" || action === "edit-user") { ccEditUser(id); return; }
  if (action === "add-page" || action === "edit-page") { ccEditPage(id); return; }
  if (action === "add-role") { ccDialog("role", "新增角色", cvField("name", "角色名称", "", { required: true }) + '<p class="config-dialog-hint">新角色默认无操作与页面授权，保存后分别配置。</p>'); return; }
  if (action === "delete-field" || action === "delete-node") { ccDialog(action, action === "delete-field" ? "删除字段？" : "删除流程节点？", '<p class="config-dialog-hint">仅修改草案。字段引用、必要审核与流程依赖会再次检查，已提交实例不受影响。</p>', id, "确认删除"); return; }
  if (action === "field-up" || action === "field-down") { ccMove(ccDb.draft.form.fields, id, action === "field-up" ? -1 : 1); return; }
  if (action === "page-up" || action === "page-down") { ccMove(ccDb.draft.pages, id, action === "page-up" ? -1 : 1); return; }
  if (action === "toggle-user") { const user = cmFind(ccDb.draft.users, id); if (user) { user.active = !user.active; ccDraftChanged("切换成员状态"); } return; }
  if (action === "save-draft") { ccPersist(); ccToast("草案已保存，尚未改变已发布配置。"); return; }
  if (action === "check-config") { const errors = cmValidateConfig(ccDb.draft); ccToast(errors.length ? errors.join("；") : "草案结构与引用校验通过。", !!errors.length); return; }
  if (action === "publish") { ccDialog("publish", "发布配置 C" + (ccDb.published.version + 1) + "？", '<p class="config-dialog-hint">将统一校验字段引用、组织负责人、流程依赖、角色与页面。新提交采用新表单和流程，已有实例保留原快照。当前人员与权限按已发布配置校验。</p>', "", "校验并发布"); return; }
  if (action === "reset-all") ccDialog("reset", "重置配置中心？", '<p class="config-dialog-hint">清除本配置中心的草案、发布和实例体验数据，恢复初始示例。首版工单与动态流程图的演示数据保留。</p>', "", "确认重置");
}

/**
 * 记录动态表单输入并只更新路线预览，输入期间保留光标焦点。
 * @param {Event} event 字段输入事件
 */
function ccHandleInput(event) {
  const input = event.target; const key = input.dataset.runtimeField; if (!key) return;
  ccView.values[key] = input.value;
  const target = document.getElementById("config-live-plan");
  if (target) target.innerHTML = cvPlan(ccView.tab === "workflow" ? ccDb.draft : ccConfig(), ccView.tab === "workflow" ? ccView.workflowApplicant : ccView.previewUser);
}

/**
 * 处理身份、快照来源、角色授权、菜单启停与条件字段变化。
 * @param {Event} event 控件变化事件
 */
function ccHandleChange(event) {
  const input = event.target;
  if (input.id === "runtime-user" || input.id === "runtime-source") { if (input.id === "runtime-user") ccView.previewUser = input.value; else ccView.source = input.value; ccView.runtimePage = ""; ccView.record = ""; ccView.formErrors = []; cvRender(); return; }
  if (input.id === "workflow-applicant") { ccView.workflowApplicant = input.value; cvRender(); return; }
  if (input.dataset.runtimeField) { ccView.values[input.dataset.runtimeField] = input.value; cvRender(); return; }
  if (input.dataset.grant || input.id === "role-scope" || input.dataset.pageEnabled || input.dataset.groupEnabled) {
    if (!ccCanConfigure()) { cvRender(); return; }
    const c = ccDb.draft; const role = cmFind(c.roles, ccView.role);
    if (input.dataset.grant) { const property = input.dataset.grant === "permission" ? "permissions" : "pages"; const list = []; for (const value of role[property]) if (value !== input.value) list.push(value); if (input.checked) list.push(input.value); role[property] = list; }
    if (input.id === "role-scope") role.scope = input.value;
    if (input.dataset.pageEnabled) cmFind(c.pages, input.dataset.pageEnabled).active = input.checked;
    if (input.dataset.groupEnabled) cmFind(c.groups, input.dataset.groupEnabled).active = input.checked;
    ccDraftChanged("更新授权或菜单状态");
  }
}

document.addEventListener("click", ccHandleClick);
document.addEventListener("input", ccHandleInput);
document.addEventListener("change", ccHandleChange);
document.getElementById("config-dialog-form").addEventListener("submit", ccSubmitDialog);
cvRender();
