"use strict";

const CV_NAV = [["overview", "◫", "配置总览"], ["forms", "▤", "动态表单"], ["workflow", "⑂", "流程节点"], ["organization", "▦", "组织架构"], ["permissions", "◈", "角色权限"], ["pages", "▣", "菜单页面"], ["runtime", "▷", "联动体验"]];
const CV_FIELD_TYPES = { text: "单行文字", textarea: "多行文字", number: "数字", select: "下拉选择", datetime: "日期时间" };

/**
 * 转义动态配置内容，避免节点、字段与成员名称被解释为 HTML。
 * @param {unknown} value 待显示内容
 * @returns {string} 安全 HTML 文本
 */
function cvEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g,
    /**
     * 替换单个 HTML 特殊字符。
     * @param {string} char 特殊字符
     * @returns {string} 安全实体
     */
    function escapeCharacter(char) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]; });
}

/**
 * 输出后台编辑用的有标签字段。
 * @param {string} name 表单键
 * @param {string} label 中文标签
 * @param {unknown} value 当前值
 * @param {object} options 类型、选项、必填和只读设置
 * @returns {string} 字段 HTML
 */
function cvField(name, label, value, options = {}) {
  const attrs = `name="${name}" ${options.required ? "required" : ""} ${options.readonly ? "readonly" : ""}`;
  let input = "";
  if (options.options) { let list = ""; for (const [key, text] of options.options) list += `<option value="${cvEsc(key)}" ${String(value) === key ? "selected" : ""}>${cvEsc(text)}</option>`; input = `<select ${attrs}>${list}</select>`; }
  else if (options.textarea) input = `<textarea ${attrs} maxlength="3000">${cvEsc(value)}</textarea>`;
  else input = `<input ${attrs} type="${options.type || "text"}" value="${cvEsc(value)}" maxlength="200" ${options.pattern ? `pattern="${options.pattern}"` : ""}>`;
  return `<label class="field ${options.full ? "full" : ""}"><span>${cvEsc(label)}${options.required ? "<b>*</b>" : ""}</span>${input}</label>`;
}

/**
 * 输出配置页统一标题与主操作。
 * @param {string} title 页面标题
 * @param {string} description 页面说明
 * @param {string} action 主操作
 * @param {string} label 主操作文案
 * @returns {string} 页面标题区
 */
function cvHeading(title, description, action = "", label = "") { return `<div class="config-page-heading"><div><div class="eyebrow">CONFIGURATION / ${cvEsc(title)}</div><h1>${cvEsc(title)}</h1><p>${cvEsc(description)}</p></div>${action ? `<button class="btn primary" data-c-action="${action}">${cvEsc(label)}</button>` : ""}</div>`; }

/**
 * 渲染配置中心与当前模块，所有配置仍以管理员工作空间为入口。
 */
function cvRender() {
  let nav = ""; for (const [key, icon, label] of CV_NAV) nav += `<button data-c-action="nav" data-id="${key}" class="${ccView.tab === key ? "active" : ""}"><span class="nav-symbol" aria-hidden="true">${icon}</span>${label}</button>`;
  document.getElementById("config-nav").innerHTML = nav;
  const changed = JSON.stringify(ccDb.draft) !== JSON.stringify(ccDb.published);
  document.getElementById("config-version").innerHTML = `<strong>已发布 C${ccDb.published.version}</strong> · ${changed ? "草案待发布" : "草案与发布一致"}`;
  const pages = { overview: cvOverview, forms: cvForms, workflow: cvWorkflow, organization: cvOrganization, permissions: cvPermissions, pages: cvPages, runtime: cvRuntime };
  document.getElementById("config-main").innerHTML = pages[ccView.tab]();
}

/**
 * 渲染五项配置及其关系、发布结果和审计摘要。
 * @returns {string} 总览 HTML
 */
function cvOverview() {
  const c = ccDb.draft;
  const modules = [["forms", "动态表单", "字段、必填、选项、显示条件与提交快照", c.form.fields.length + " 个字段"], ["workflow", "动态流程节点", "串行、并行、条件分支与组织受理人解析", c.workflow.nodes.length + " 个节点"], ["organization", "公司组织架构", "公司、部门、负责人、成员与启停状态", c.departments.length + " 个部门 · " + c.users.length + " 位员工"], ["permissions", "角色与审核权限", "菜单页面、操作、数据范围与任务归属", c.roles.length + " 个角色"], ["pages", "动态菜单页面", "授权导航与已注册页面模板、表单绑定", c.pages.length + " 个页面"], ["runtime", "联动体验", "切换员工、生成菜单、提交表单并验证审核", "按草案／已发布版本体验"]];
  let html = cvHeading("一套配置，串起活动协作", "编辑草案后统一校验发布。表单与流程使用提交快照，办理资格按当前账号和权限判断。") + '<div class="config-page-grid">';
  for (const [id, title, text, count] of modules) html += `<button class="config-module" data-c-action="nav" data-id="${id}"><h2>${title}</h2><p>${text}</p><div class="module-foot"><span>${count}</span><span>进入配置 →</span></div></button>`;
  html += '</div><div class="relation-line"><span>组织与人员</span><i>→</i><span>角色与审核资格</span><i>→</i><span>菜单页面</span><i>→</i><span>业务表单</span><i>→</i><span>流程实例</span></div><p class="config-note">所有示例为本地评审数据。本配置中心独立于首版工单和流程图演示，支持五项配置之间的联动。</p><section class="panel" style="margin-top:24px"><div class="panel-header"><h2>配置发布记录</h2><button class="link-button" data-c-action="check-config">检查当前草案</button></div><div class="panel-body">';
  for (const log of [...ccDb.audit].reverse().slice(0, 5)) html += `<div class="config-audit-row"><strong>${cvEsc(log.title)}</strong><time>${cvEsc(log.at)}</time><p>${cvEsc(log.note)}</p></div>`;
  return html + '</div></section><div class="actions" style="margin-top:20px"><button class="btn ghost" data-c-action="reset-all">重置配置中心演示</button></div>';
}

/**
 * 渲染表单字段列表与由当前草案生成的真实输入预览。
 * @returns {string} 动态表单页面
 */
function cvForms() {
  let html = cvHeading("动态表单", "字段稳定键供流程条件引用。隐藏字段不参与必填校验，也不进入提交内容。", "add-field", "＋ 新增字段") + '<div class="config-layout"><section class="panel"><div class="panel-header"><h2>活动申请表 · 字段配置</h2><small>草案</small></div>';
  for (const field of ccDb.draft.form.fields) html += `<div class="config-field-row"><span class="field-type">${{ text: "文", textarea: "段", number: "数", select: "选", datetime: "时" }[field.type]}</span><div class="field-copy"><strong>${cvEsc(field.label)}${field.required ? '<span class="require">必填</span>' : ""}<span class="key-label">${cvEsc(field.key)}</span></strong><p>${CV_FIELD_TYPES[field.type]}${field.visible ? " · 当 " + cvEsc(cmFindField(ccDb.draft, field.visible.field)?.label || field.visible.field) + (field.visible.operator === "neq" ? " ≠ " : " = ") + cvEsc(field.visible.value) + " 时显示" : " · 始终显示"}</p></div><div class="row-actions"><button data-c-action="field-up" data-id="${field.id}" aria-label="上移${cvEsc(field.label)}">↑</button><button data-c-action="field-down" data-id="${field.id}" aria-label="下移${cvEsc(field.label)}">↓</button><button data-c-action="edit-field" data-id="${field.id}">编辑</button><button class="delete" data-c-action="delete-field" data-id="${field.id}">删除</button></div></div>`;
  html += `</section><section class="panel"><div class="panel-header"><h2>草案实时预览</h2><button class="link-button" data-c-action="validate-form">校验填写内容</button></div><div class="config-form-preview"><div class="preview-context"><span>申请人 林晓 · 教研一部</span><span>${ccDb.draft.form.fields.length} 个配置字段</span></div>${cvErrors(ccView.formErrors)}${cvGeneratedForm(ccDb.draft.form)}<small>切换举办方式，观察地点的显示与必填变化。</small></div></section></div>`;
  return html;
}

/**
 * 根据 schema 生成表单控件，所有业务字段通过统一事件更新模型。
 * @param {object} form 表单模板
 * @param {object} values 当前输入，默认使用联动体验输入
 * @returns {string} 可见表单控件
 */
function cvGeneratedForm(form, values = ccView.values) {
  let html = '<div class="form-grid">';
  for (const field of cmVisibleFields(form, values)) {
    const value = cmValue(field, values); let control;
    const attr = `data-runtime-field="${cvEsc(field.key)}" ${field.required ? 'aria-required="true"' : ""}`;
    if (field.type === "textarea") control = `<textarea ${attr} maxlength="3000">${cvEsc(value)}</textarea>`;
    else if (field.type === "select") { let options = '<option value="">请选择</option>'; for (const option of field.options) options += `<option value="${cvEsc(option)}" ${value === option ? "selected" : ""}>${cvEsc(option)}</option>`; control = `<select ${attr}>${options}</select>`; }
    else control = `<input ${attr} type="${field.type === "datetime" ? "datetime-local" : "text"}" ${field.type === "number" ? 'inputmode="decimal"' : ""} maxlength="3000" value="${cvEsc(value)}">`;
    html += `<label class="field ${field.type === "textarea" ? "full" : ""}"><span>${cvEsc(field.label)}${field.required ? "<b>*</b>" : ""}</span>${control}</label>`;
  }
  return html + "</div>";
}

/**
 * 输出表单和配置校验错误，保留中文错误定位信息。
 * @param {Array<string>} errors 错误列表
 * @returns {string} 错误提示或空字符串
 */
function cvErrors(errors) { if (!errors?.length) return ""; let html = '<div class="preview-errors" role="alert"><strong>请检查以下内容</strong><ul>'; for (const error of errors) html += `<li>${cvEsc(error)}</li>`; return html + "</ul></div>"; }

/**
 * 输出节点受理方式，避免将员工显示名作为业务标识。
 * @param {object} config 当前配置
 * @param {object} node 流程节点
 * @returns {string} 受理规则说明
 */
function cvAssignee(config, node) { if (node.assignee.type === "manager") return "申请部门负责人"; if (node.assignee.type === "role") return "角色：" + (cmFind(config.roles, node.assignee.value)?.name || "角色已失效") + "（多人全部办理）"; return "指定员工：" + (cmFind(config.users, node.assignee.value)?.name || "员工已失效"); }

/**
 * 渲染可配置流程节点与按表单草案生成的实际路线。
 * @returns {string} 流程配置页
 */
function cvWorkflow() {
  const c = ccDb.draft; let html = cvHeading("动态流程节点", "流程引用表单字段选择路线，再从组织与角色中解析受理人。", "add-node", "＋ 新增流程节点") + '<div class="config-layout"><section class="panel"><div class="panel-header"><h2>教研活动审核 · 依赖图</h2><small>默认并行汇合</small></div>';
  const dag = cmDag(c.workflow.nodes);
  for (const node of dag.error ? c.workflow.nodes : dag.order) {
    const deps = []; for (const id of node.deps) deps.push(cmFind(c.workflow.nodes, id)?.label || "无效前置");
    html += `<article class="node-config"><header><h3>${cvEsc(node.label)}${node.protected ? '<span class="protected">必要审核</span>' : ""}</h3><div class="row-actions"><button data-c-action="edit-node" data-id="${node.id}">编辑</button><button class="delete" data-c-action="delete-node" data-id="${node.id}" ${node.protected ? "disabled" : ""}>删除</button></div></header><div class="node-meta">${{ approval: "审批", task: "办理任务", notice: "非阻塞知会" }[node.kind]} · ${cvEsc(cvAssignee(c, node))}<br>${node.condition ? "条件：" + cvEsc(cmFindField(c, node.condition.field)?.label || node.condition.field) + (node.condition.operator === "gte" ? " ≥ " : node.condition.operator === "neq" ? " ≠ " : " = ") + cvEsc(node.condition.value) : "所有申请生效"}</div><div class="node-deps">前置：${cvEsc(deps.join(" ＋ ") || "提交申请")}</div></article>`;
  }
  html += `</section><section class="panel"><div class="panel-header"><h2>路线与人员预览</h2><small>使用表单草案输入</small></div><div class="panel-body"><label class="field">模拟申请人<select id="workflow-applicant">${cvUserOptions(c, ccView.workflowApplicant)}</select></label><label class="field">测试预算（元）<input data-runtime-field="budget" inputmode="decimal" value="${cvEsc(ccView.values.budget ?? cmFindField(c, "budget")?.default ?? "")}"></label><div id="config-live-plan">${cvPlan(c, ccView.workflowApplicant)}</div></div></section></div>`;
  return html;
}

/**
 * 渲染受理路线及条件跳过结果，解析错误显示具体责任节点。
 * @param {object} config 配置版本
 * @param {string} userId 申请人
 * @returns {string} 实际路线 HTML
 */
function cvPlan(config, userId) {
  const validated = cmValidateForm(config.form, ccView.values); const plan = cmResolve(config, validated.payload, userId); let html = cvErrors(plan.errors);
  for (const node of plan.nodes) {
    const owners = []; for (const id of node.assignees) owners.push(cmFind(config.users, id)?.name || "无效成员");
    const deps = []; for (const id of node.deps) deps.push(cmFind(plan.nodes, id)?.label || id);
    html += `<div class="config-plan-node"><strong>${cvEsc(node.label)}</strong><p>${cvEsc(owners.join("、") || "尚无受理人")}<br>前置：${cvEsc(deps.join(" ＋ ") || "提交申请")}${node.kind === "notice" ? " · 非阻塞" : ""}</p></div>`;
  }
  if (plan.skipped.length) html += `<p class="config-note">${cvEsc(plan.skipped.join("；"))}</p>`;
  return html;
}

/**
 * 输出员工选择项，停用员工仍可被选中以演示拒绝访问。
 * @param {object} config 配置版本
 * @param {string} selected 当前员工
 * @returns {string} 原生选项
 */
function cvUserOptions(config, selected) { let html = ""; for (const user of config.users) html += `<option value="${user.id}" ${selected === user.id ? "selected" : ""}>${cvEsc(user.name)} · ${cvEsc(cmFind(config.departments, user.department)?.name || "未分配")}${cmActiveUser(config, user.id) ? "" : "（停用）"}</option>`; return html; }

/**
 * 输出公司部门树，以访问集合防止异常配置导致重复递归。
 * @param {object} config 公司配置
 * @returns {string} 部门树 HTML
 */
function cvOrgTree(config) {
  const seen = new Set();
  /**
   * 按父级遍历部门并计算直接成员数量。
   * @param {string} parent 父部门标识
   * @param {number} depth 展示层级
   * @returns {string} 当前层与子层的树节点
   */
  function branch(parent, depth) {
    let html = "";
    for (const dept of config.departments) if (dept.parent === parent && !seen.has(dept.id)) {
      seen.add(dept.id); let count = 0; for (const user of config.users) if (user.department === dept.id) count += 1;
      html += `<button class="org-row ${dept.id === ccView.department ? "selected" : ""} ${dept.active ? "" : "inactive"}" style="padding-left:${10 + depth * 14}px" data-c-action="select-department" data-id="${dept.id}"><span class="org-icon">▦</span>${cvEsc(dept.name)}<span class="dept-count">${count}</span></button>${branch(dept.id, depth + 1)}`;
    }
    return html;
  }
  return branch("", 0);
}

/**
 * 渲染组织树、部门负责人和成员角色维护入口。
 * @returns {string} 组织配置页面
 */
function cvOrganization() {
  const c = ccDb.draft; const dept = cmFind(c.departments, ccView.department) || c.departments[0];
  let html = cvHeading("公司组织架构", "部门负责人用于流程解析；成员角色控制页面、操作与数据范围。", "add-user", "＋ 新增员工") + `<div class="config-layout org-layout"><section class="panel"><div class="panel-header"><h2>公司与部门</h2><button class="link-button" data-c-action="add-department">＋ 部门</button></div><div class="org-tree">${cvOrgTree(c)}</div></section><section class="panel"><div class="panel-header"><div><h2>${cvEsc(dept.name)}</h2><small>负责人：${cvEsc(cmFind(c.users, dept.manager)?.name || "未配置")} · ${dept.active ? "启用" : "停用"}</small></div><button class="btn small" data-c-action="edit-department" data-id="${dept.id}">编辑部门</button></div><div class="table-wrap"><table class="people-list"><thead><tr><th>成员</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>`;
  let count = 0;
  for (const user of c.users) if (user.department === dept.id) { count += 1; const names = []; for (const id of user.roles) names.push(cmFind(c.roles, id)?.name || id); html += `<tr><td>${cvEsc(user.name)}<small>${user.id}</small></td><td>${cvEsc(names.join("、") || "未分配角色")}</td><td><span class="tag ${cmActiveUser(c, user.id) ? "green" : ""}">${cmActiveUser(c, user.id) ? "有效" : "停用"}</span></td><td><div class="row-actions"><button data-c-action="edit-user" data-id="${user.id}">编辑</button><button data-c-action="toggle-user" data-id="${user.id}">${user.active ? "停用" : "启用"}</button></div></td></tr>`; }
  if (!count) html += '<tr><td colspan="4">此部门暂无直接成员。</td></tr>';
  return html + '</tbody></table></div><div class="panel-body"><small>新配置发布后，新申请解析新负责人。旧实例保留原受理快照，人员停用会阻止继续办理。</small></div></section></div>';
}

/**
 * 渲染角色页面授权、操作权限和数据范围，三个维度独立配置。
 * @returns {string} 角色权限页面
 */
function cvPermissions() {
  const c = ccDb.draft; const role = cmFind(c.roles, ccView.role) || c.roles[0];
  let html = cvHeading("角色与审核权限", "审核必须同时满足动作权限、数据范围、任务归属和业务状态。", "add-role", "＋ 新增角色") + '<div class="config-layout permission-layout"><section class="panel role-list">';
  for (const item of c.roles) { let count = 0; for (const user of c.users) if (user.roles.includes(item.id)) count += 1; html += `<button data-c-action="select-role" data-id="${item.id}" class="${item.id === role.id ? "active" : ""}">${cvEsc(item.name)}<small>${count} 人</small></button>`; }
  html += `</section><section class="panel"><div class="panel-header"><h2>${cvEsc(role.name)}</h2><small>修改记录在草案，发布后用于已发布体验</small></div><div class="panel-body"><section class="grant-section"><h3 class="config-section-title">操作权限</h3><div class="grant-grid">`;
  for (const [code, label] of Object.entries(CM_PERMISSIONS)) html += `<label><input type="checkbox" data-grant="permission" value="${code}" ${role.permissions.includes(code) ? "checked" : ""}>${label}</label>`;
  html += '</div></section><section class="grant-section"><h3 class="config-section-title">菜单与页面授权</h3><div class="grant-grid">';
  for (const page of c.pages) html += `<label><input type="checkbox" data-grant="page" value="${page.id}" ${role.pages.includes(page.id) ? "checked" : ""}>${cvEsc(page.name)}</label>`;
  html += '</div></section><section class="grant-section"><h3 class="config-section-title">业务数据范围</h3><label class="field"><select id="role-scope" aria-label="角色数据范围">';
  for (const [key, label] of Object.entries(CM_SCOPES)) html += `<option value="${key}" ${role.scope === key ? "selected" : ""}>${label}</option>`;
  html += '</select></label><p class="scope-help">多角色取有效授权并集。全公司范围仍需活动读取权限，配置管理员身份不自动获得业务权限。</p></section><section><h3 class="config-section-title">拥有此角色的员工</h3><div class="grant-members">';
  for (const user of c.users) if (user.roles.includes(role.id)) html += `<span>${cvEsc(user.name)}${cmActiveUser(c, user.id) ? "" : " · 停用"}</span>`;
  return html + '</div></section></div></section></div>';
}

/**
 * 渲染动态菜单、分组与已注册页面模板绑定。
 * @returns {string} 页面管理界面
 */
function cvPages() {
  const c = ccDb.draft; let html = cvHeading("动态菜单页面", "通过页面模板生成业务页面，再按角色授权。所有页面访问仍校验权限与数据范围。", "add-page", "＋ 新增菜单页面") + '<div class="config-layout"><section class="panel"><div class="panel-header"><h2>导航入口与业务页面</h2><small>已注册模板</small></div><div class="group-switches">';
  for (const group of c.groups) html += `<label><input type="checkbox" data-group-enabled="${group.id}" ${group.active ? "checked" : ""}>${cvEsc(group.name)}分组启用</label>`;
  html += "</div>";
  for (const page of c.pages) { const roles = []; for (const role of c.roles) if (role.pages.includes(page.id)) roles.push(role.name); html += `<article class="page-config-row"><input type="checkbox" aria-label="启用${cvEsc(page.name)}" data-page-enabled="${page.id}" ${page.active ? "checked" : ""}><div class="page-copy"><strong>${cvEsc(page.name)}</strong><p>${cvEsc(CM_COMPONENTS[page.component]?.[0] || "未注册")} · ${cvEsc(cmFind(c.groups, page.group)?.name)}<br>授权：${cvEsc(roles.join("、") || "尚未授权")}</p></div><div class="row-actions"><button data-c-action="page-up" data-id="${page.id}" aria-label="上移页面">↑</button><button data-c-action="page-down" data-id="${page.id}" aria-label="下移页面">↓</button><button data-c-action="edit-page" data-id="${page.id}">编辑</button></div></article>`; }
  return html + '</section><section class="panel"><div class="panel-header"><h2>页面与授权关系</h2></div><div class="panel-body"><div class="notice">菜单有效 → 父分组有效 → 角色有页面授权 → 有模板所需权限 → 过滤业务数据。</div><p class="config-note">新增页面复用活动列表、申请表单、待办等模板。表单页面绑定当前活动表单；多模板管理可在后续扩展。</p><button class="btn primary" data-c-action="nav" data-id="runtime" style="margin-top:20px">切换员工验证菜单 →</button></div></section></div>';
}

/**
 * 根据选择的配置快照和员工生成运行菜单，并在页面内部继续鉴权。
 * @returns {string} 五项配置联动体验
 */
function cvRuntime() {
  const c = ccConfig(); const user = cmFind(c.users, ccView.previewUser); const menus = cmPages(c, ccView.previewUser);
  if (!ccView.runtimePage && menus.length) ccView.runtimePage = menus[0].id;
  let html = cvHeading("配置联动体验", "选择员工，查看当前菜单、数据与任务。新申请保存提交时的表单及流程快照。") + `<section class="panel runtime-controls"><label>配置来源<select id="runtime-source"><option value="published" ${ccView.source === "published" ? "selected" : ""}>已发布 C${ccDb.published.version}</option><option value="draft" ${ccView.source === "draft" ? "selected" : ""}>当前草案（仅预览）</option></select></label><label>体验员工<select id="runtime-user">${cvUserOptions(c, ccView.previewUser)}</select></label><span class="source-tag">${ccView.source === "draft" ? "草案体验，不代表已发布" : "使用已发布配置"}</span></section><div class="runtime-shell"><nav class="runtime-nav" aria-label="按员工生成的业务菜单"><div class="runtime-person">${cvEsc(user?.name || "成员不存在")}<small>${cvEsc(cmFind(c.departments, user?.department)?.name || "无有效部门")}</small></div>`;
  for (const group of c.groups) { let found = false; for (const page of menus) if (page.group === group.id) found = true; if (!found) continue; html += `<div class="runtime-group">${cvEsc(group.name)}</div>`; for (const page of menus) if (page.group === group.id) html += `<button data-c-action="runtime-page" data-id="${page.id}" class="${ccView.runtimePage === page.id ? "active" : ""}">${cvEsc(page.name)}</button>`; }
  if (!menus.length) html += '<p class="config-note">当前身份无可用菜单。</p>';
  html += `<button class="text-button" data-c-action="direct-page" style="margin-top:25px">验证直接访问页面</button></nav><div class="runtime-content">`;
  if (!cmPageAllowed(c, ccView.previewUser, ccView.runtimePage)) html += '<div class="runtime-empty"><strong>当前身份无页面访问权限</strong><p>菜单启停、父分组、页面授权和操作权限共同生效。</p></div>';
  else if (ccView.record) html += cvRuntimeRecord(c, ccView.record);
  else html += cvRuntimePage(c, cmFind(c.pages, ccView.runtimePage));
  return html + '</div></div><p class="config-note">体验身份与配置管理员分开。本区的身份切换仅用于评审，真实登录身份由服务端会话决定。</p>';
}

/**
 * 渲染已授权的页面模板，列表与摘要使用同一数据范围过滤。
 * @param {object} config 当前配置
 * @param {object} page 页面定义
 * @returns {string} 页面内容
 */
function cvRuntimePage(config, page) {
  const userId = ccView.previewUser; const records = []; for (const record of ccDb.records) if (cmCanRead(config, userId, record)) records.push(record);
  let html = `<div class="runtime-title"><div><h2>${cvEsc(page.name)}</h2><p>${cvEsc(CM_COMPONENTS[page.component][0])} · ${cvEsc(page.id)}</p></div></div>`;
  if (page.component === "config_overview") return html + `<div class="notice">拥有配置管理权限。当前可查看配置 C${config.version}，业务数据需另外授权。</div>`;
  if (page.component === "activity_form") {
    if (page.formId !== config.form.id) return html + '<div class="notice error">页面绑定的表单不存在。</div>';
    const user = cmFind(config.users, userId);
    html += `<div class="runtime-identity-inline"><span>申请人：${cvEsc(user.name)}</span><span>申请部门：${cvEsc(cmFind(config.departments, user.department)?.name)}</span></div><div class="runtime-form-layout"><div class="config-form-preview">${cvErrors(ccView.formErrors)}${cvGeneratedForm(config.form)}${cmHas(config, userId, "activity:submit") ? '<button class="btn primary" data-c-action="submit-runtime">提交并生成审核任务</button>' : '<div class="notice warning">当前角色可以填写，尚未获得提交权限。</div>'}</div><aside class="runtime-side"><h3>根据填写内容生成审核路线</h3><div id="config-live-plan">${cvPlan(config, userId)}</div></aside></div>`;
    return html;
  }
  if (page.component === "summary") {
    let tasks = 0; for (const record of records) for (const node of record.nodes || []) if (cmCanAct(config, userId, record, node)) tasks += 1;
    html += `<div class="metric-inline"><div><strong>${records.length}</strong><span>可见活动</span></div><div><strong>${tasks}</strong><span>可办理任务</span></div></div><div class="runtime-access">`;
    for (const role of cmUserRoles(config, userId)) html += `<span>${cvEsc(role.name)} · ${CM_SCOPES[role.scope]}</span>`;
    html += '</div><div style="margin-top:22px">';
  }
  let shown = 0;
  for (const record of records) {
    if (page.component === "archive_list" && record.status !== "archived") continue;
    if (page.component === "task_list") { let mine = false; for (const node of record.nodes || []) if (cmCanAct(config, userId, record, node)) mine = true; if (!mine) continue; }
    shown += 1; html += `<article class="runtime-record"><div><strong>${cvEsc(record.name)}</strong><p>${cvEsc(cmFind(config.departments, record.department)?.name)} · ${cvEsc(cmFind(config.users, record.applicant)?.name)} · ${cvEsc(ccStatus(record.status))} · C${record.configVersion}${record.source === "draft" ? "草案体验" : ""}</p></div><button class="btn small" data-c-action="open-record" data-id="${record.id}">查看</button></article>`;
  }
  if (!shown) html += '<p class="runtime-empty">当前范围没有匹配记录。可切换为申请人提交一个活动，再切换审核人办理。</p>';
  if (page.component === "summary") html += "</div>";
  return html;
}

/**
 * 渲染实例原始表单快照与多个审核任务，按钮按当前资格单独计算。
 * @param {object} config 当前账号与权限配置
 * @param {string} id 实例标识
 * @returns {string} 详情内容
 */
function cvRuntimeRecord(config, id) {
  const record = cmFind(ccDb.records, id);
  if (!record || !cmCanRead(config, ccView.previewUser, record)) return '<div class="runtime-empty">当前身份无此活动的数据访问权限。</div>';
  let html = `<button class="back" data-c-action="back-record">← 返回当前页面</button><div class="runtime-detail"><div class="runtime-title"><div><h2>${cvEsc(record.name)}</h2><p>提交配置 C${record.configVersion}${record.source === "draft" ? "草案体验" : ""} · ${cvEsc(ccStatus(record.status))} · 实例版本 ${record.version}</p></div></div><div class="notice">实例展示提交时的字段与任务快照。人员启停和审核权限按当前选择的配置检查。</div>`;
  if (record.schema) { html += '<section class="schema-summary"><dl>'; for (const field of record.schema.fields) if (Object.hasOwn(record.payload, field.key)) html += `<div><dt>${cvEsc(field.label)}</dt><dd>${cvEsc(record.payload[field.key])}</dd></div>`; html += "</dl></section>"; }
  else html += '<p class="config-note">预置数据仅用于展示部门与本人数据范围。</p>';
  html += '<h3 style="margin-top:25px;font-size:13px">审核与办理任务</h3>';
  for (const node of record.nodes || []) {
    const ready = cmTaskReady(record, node); const owners = []; for (const userId of node.assignees) owners.push(cmFind(config.users, userId)?.name || userId);
    html += `<div class="config-plan-node ${node.status === "done" ? "done" : ready ? "active" : ""}"><strong>${cvEsc(node.label)}</strong><p>${cvEsc(owners.join("、"))} · ${node.status === "done" ? "已完成" : node.status === "closed" ? "随流程关闭" : ready ? "待办理" : "等待前置"}${node.assignees.length > 1 ? " · 全部受理人完成后汇合" : ""}<br>已办理 ${node.doneBy.length}／${node.assignees.length}</p>${cmCanAct(config, ccView.previewUser, record, node) ? `<button class="btn primary small" data-c-action="act-node" data-id="${record.id}" data-node="${node.id}" data-version="${record.version}">${node.kind === "approval" ? "模拟同意并流转" : "模拟完成任务"}</button>` : ""}</div>`;
  }
  return html + "</div>";
}
