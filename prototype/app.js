"use strict";

const STORAGE_KEY = "xingzhi-activity-review-v1";
const ROLES = {
  applicant: { name: "林晓", title: "申请人", id: "u-lin" },
  department: { name: "陈宁", title: "部门领导", id: "u-chen" },
  academic: { name: "周岚", title: "分管院领导", id: "u-zhou" },
  marketing: { name: "赵明", title: "营销中心领导", id: "u-zhao" },
  director: { name: "刘文", title: "院负责人", id: "u-liu" },
  coordinator: { name: "王舟", title: "活动协调员", id: "u-wang" },
  executor: { name: "苏禾", title: "执行人", id: "u-su" },
  archivist: { name: "何青", title: "归档审核人", id: "u-he" },
  admin: { name: "许言", title: "系统管理员", id: "u-xu" }
};
const STATUS = {
  draft: ["草稿", ""], approving: ["审批中", "blue"], needs_info: ["待补充", "orange"],
  withdrawn: ["已撤回", ""], rejected: ["已拒绝", "red"], ready_assign: ["待指派", "purple"],
  ready_execute: ["待执行", "blue"], executing: ["执行中", "green"], archive_draft: ["待提交档案", "orange"],
  archive_review: ["待归档审核", "purple"], archived: ["已归档", "green"],
  cancel_review: ["取消审批中", "orange"], cancelled: ["已取消", ""]
};
const NAV = [["home", "◫", "工作台"], ["activities", "▤", "活动工单"], ["tasks", "◷", "我的待办"], ["archives", "▣", "活动档案"], ["rules", "⚙", "流程设置"]];
const MOBILE_NAV = [["home", "◫", "工作台"], ["tasks", "◷", "待办"], ["mine", "▤", "我发起的"], ["me", "○", "我的"]];
const FORMS = ["专题讲座", "课例示范", "课例研磨", "教学视导", "课题指导", "其他"];
const PEOPLE = ["教育局领导", "教科研领导", "学校管理人员", "教研员", "一线教师", "其他"];
let storageAvailable = true;
let toastTimer;
let db = loadDatabase();
const view = { role: "applicant", device: window.innerWidth <= 700 ? "mobile" : "pc", page: "home", query: "", filter: "", detail: null, editing: null, step: 1, errors: [], dialogAction: "", dialogId: "", dialogVersion: 0, revision: "current", leavePage: "activities" };

/**
 * 转义表单、历史与名称中的 HTML 特殊字符，避免把用户输入解释为页面代码。
 * @param {unknown} value 需要展示的原始值
 * @returns {string} 可安全放入 HTML 文本或属性的字符串
 */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g,
    /**
     * 将单个特殊字符替换为安全实体。
     * @param {string} char 待转义字符
     * @returns {string} HTML 实体
     */
    function replaceChar(char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

/**
 * 克隆演示业务数据，避免修改申请快照与原始草稿。
 * @param {unknown} value 可序列化的数据
 * @returns {unknown} 独立的数据副本
 */
function clone(value) { return JSON.parse(JSON.stringify(value)); }

/**
 * 按本地年月日和时间构造输入控件使用的日期字符串。
 * @param {Date} date 需要格式化的日期
 * @returns {string} YYYY-MM-DDTHH:mm 格式的时间
 */
function localDate(date) {
  /**
   * 补齐日期时间分量的前导零。
   * @param {number} n 数值
   * @returns {string} 两位数文本
   */
  function pad(n) { return String(n).padStart(2, "0"); }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 为演示记录生成相对今天的活动时间。
 * @param {number} days 相对今天偏移的自然日
 * @param {number} hour 当天小时
 * @returns {string} 活动计划时间
 */
function dayAt(days, hour) { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return localDate(d); }

/**
 * 格式化金额，演示层统一将分转换成人民币元。
 * @param {number} fen 人民币分
 * @returns {string} 含千分位和两位小数的人民币金额
 */
function money(fen) { return "¥" + (fen / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/**
 * 格式化时间用于详情和办理记录。
 * @param {string} value 时间输入字符串
 * @returns {string} 显示用日期时间或未填写提示
 */
function formatTime(value) { return value ? value.replace("T", " ").slice(0, 16) : "未填写"; }

/**
 * 根据规则快照解析固定串行审批人，并按预算条件追加节点。
 * @param {object} item 活动申请
 * @param {object} rule 需要使用的规则版本
 * @returns {Array<object>} 独立的审批节点快照
 */
function resolveFlow(item, rule) {
  const keys = ["department", "academic", "marketing"];
  if (rule.extraEnabled && budgetTotal(item) >= rule.thresholdFen) keys.push("director");
  const nodes = [];
  for (const key of keys) nodes.push({ role: key, name: ROLES[key].name, label: ROLES[key].title, userId: ROLES[key].id });
  return nodes;
}

/**
 * 创建申请表的初始内容，联系方式均为无真实个人信息的演示内容。
 * @returns {object} 可编辑的活动表单与初始业务状态
 */
function blankActivity() {
  return { id: "", code: "未生成", name: "", org: "教研一部", applicant: "u-lin", mode: "线下", start: dayAt(5, 9), end: dayAt(5, 17), location: "", url: "", nature: "校园立体阅读课程项目", service: "免费课题服务", otherNote: "", background: "", agenda: "", contentForms: ["专题讲座"], forum: "否", people: "", composition: ["一线教师"], personnel: "", training: "", contact: "", contactInfo: "", arranger: "王舟", arrangerInfo: "arranger@example.com", receiver: "", receiverInfo: "", budget: [{ category: "专家费", amount: "0.00", note: "" }], files: [], status: "draft", revision: 0, workflowVersion: null, flow: [], node: 0, history: [], snapshots: [], version: 1, executor: "", assignment: "", report: null, archive: null, archiveAttempts: [], cancel: null, createdAt: localDate(new Date()), updatedAt: localDate(new Date()) };
}

/**
 * 创建全流程演示数据，为不同角色准备可办理的示例工单。
 * @returns {object} 带活动、已发布规则与配置草案的本地数据库
 */
function seedDatabase() {
  const rule = { version: 1, extraEnabled: false, thresholdFen: 1000000, reminderHours: 24, escalationHours: 48 };
  const items = [];
  const specifications = [
    ["阅读教学与表达课例研讨", "approving", 0, 5, "和美实验学校", 520000],
    ["整本书阅读教师研修工作坊", "approving", 1, 7, "青禾小学", 880000],
    ["校园阅读课程建设交流会", "approving", 2, 9, "星河学校", 350000],
    ["新教师课例研磨专题活动", "needs_info", 0, 6, "云杉小学", 0],
    ["区域教研共同体专题培训", "ready_assign", 3, 4, "树人教育研修中心", 760000],
    ["课堂观察与教学视导活动", "ready_execute", 3, 0, "知远实验学校", 280000],
    ["秋季阅读示范课交流", "executing", 3, 0, "锦程小学", 420000],
    ["小学语文教学成果交流", "archive_draft", 3, -2, "明德学校", 600000],
    ["跨学科教研实践分享", "archive_review", 3, -3, "同心实验学校", 320000],
    ["书香校园阅读课程启动会", "archived", 3, -6, "晨光小学", 240000]
  ];
  let index = 0;
  for (const spec of specifications) {
    index += 1;
    const item = blankActivity();
    Object.assign(item, { id: "demo-" + index, code: `HD-${new Date().getFullYear()}-${String(index).padStart(4, "0")}`, name: spec[0], status: spec[1], node: spec[2], start: dayAt(spec[3], 9), end: dayAt(spec[3], 17), location: spec[4], background: "结合本学期教情学情与学校阅读教学诉求，通过课例研讨提升教师的教学设计能力。", agenda: "09:00—09:20 活动介绍与需求交流\n09:20—11:30 课例展示与观察\n14:00—16:30 专题研讨与改进建议", people: "60", composition: ["学校管理人员", "一线教师"], personnel: "需配备一名阅读教学专家及一名现场协调人员。", training: "围绕阅读策略开展示范与研讨，培训时长 6 小时。", contact: "校方联系人（演示）", contactInfo: "contact@example.com", receiver: "校方接收人（演示）", receiverInfo: "receiver@example.com", budget: [{ category: "专家费", amount: (spec[5] / 100 * .6).toFixed(2), note: "专题指导" }, { category: "会务费", amount: (spec[5] / 100 * .25).toFixed(2), note: "场务与资料" }, { category: "差旅费", amount: (spec[5] / 100 * .15).toFixed(2), note: "交通安排" }], revision: 1, workflowVersion: 1 });
    item.flow = resolveFlow(item, rule);
    item.history = [{ title: "演示起始状态", actor: "系统示例", comment: "用于评审本环节，历史未模拟完整办理。", at: localDate(new Date()) }];
    if (index >= 6) { item.executor = "u-su"; item.assignment = "按议程准备现场资料，活动前与接收人确认设备。"; }
    if (item.status === "ready_execute" || item.status === "executing") {
      item.start = localDate(new Date(Date.now() - 2 * 3600000));
      item.end = localDate(new Date(Date.now() + 2 * 3600000));
    }
    if (item.status === "executing") item.actualStart = localDate(new Date(Date.now() - 3600000));
    if (index >= 8) item.report = { start: item.start, end: item.end, people: "56", summary: "完成课例展示和专题交流，教师反馈集中在教学问题设计与课堂观察，已整理改进建议。", spend: "", exception: "", submittedAt: localDate(new Date()) };
    if (index >= 9) item.archive = { summary: "整理课例资料、培训总结与学校反馈，形成后续教研改进建议。", url: "https://example.com/demo-archive", files: [], submittedBy: "u-lin", version: 1 };
    if (index === 10) item.archive.code = `DA-${new Date().getFullYear()}-0010`;
    item.snapshots = [{ revision: 1, data: applicationData(item), rule: 1, flow: clone(item.flow), at: item.createdAt }];
    if (item.status === "needs_info") item.history.push({ title: "退回补充", actor: "陈宁 · 部门领导", comment: "请补充活动人员安排和校方确认情况。", at: localDate(new Date()) });
    items.push(item);
  }
  return { schema: 1, rule, ruleDraft: clone(rule), items };
}

/**
 * 读取本地演示数据库；存储被限制或内容损坏时恢复为示例数据。
 * @returns {object} 当前演示数据库
 */
function loadDatabase() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { const data = JSON.parse(raw); if (data.schema === 1 && Array.isArray(data.items) && data.rule) return data; }
  } catch { storageAvailable = false; }
  return seedDatabase();
}

/**
 * 保存业务演示状态；失败时提示当前页面仍可操作，但刷新后不保留。
 */
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
  catch { storageAvailable = false; showToast("浏览器存储不可用，本次内容保留至页面关闭。", true); }
}

/**
 * 取得当前演示角色对应的员工身份。
 * @returns {object} 员工姓名、标识与职责
 */
function actor() { return ROLES[view.role]; }

/**
 * 将有效元金额转换成分，非法输入返回 NaN，避免缺失值被当作零预算。
 * @param {unknown} amount 用户输入的元金额
 * @returns {number} 整数分或 NaN
 */
function toFen(amount) {
  const text = String(amount ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN;
  const fen = Math.round(Number(text) * 100);
  return Number.isSafeInteger(fen) && fen <= 10000000000 ? fen : NaN;
}

/**
 * 合计预算明细，任一金额无效时保持 NaN 状态以便阻止提交。
 * @param {object} item 活动申请
 * @returns {number} 总预算整数分或 NaN
 */
function budgetTotal(item) { let total = 0; for (const row of item.budget) total += toFen(row.amount); return total; }

/**
 * 提取不可变的申请字段，排除业务状态与历史，供提交快照和旧版本查看。
 * @param {object} item 活动申请
 * @returns {object} 独立的申请内容快照
 */
function applicationData(item) {
  const data = {};
  for (const key of ["name", "org", "applicant", "mode", "start", "end", "location", "url", "nature", "service", "otherNote", "background", "agenda", "contentForms", "forum", "people", "composition", "personnel", "training", "contact", "contactInfo", "arranger", "arrangerInfo", "receiver", "receiverInfo", "budget", "files"]) data[key] = clone(item[key]);
  return data;
}

/**
 * 按活动标识读取记录。
 * @param {string} id 活动标识
 * @returns {object|undefined} 对应活动记录
 */
function findItem(id) { for (const item of db.items) if (item.id === id) return item; return undefined; }

/**
 * 校验当前演示身份的数据访问范围，管理员默认仅管理配置。
 * @param {object} item 目标活动
 * @returns {boolean} 是否可以读取活动
 */
function canRead(item) {
  if (!item || view.role === "admin") return false;
  if (view.role === "applicant") return item.applicant === actor().id;
  if (view.role === "coordinator" || view.role === "archivist") return item.org === "教研一部";
  if (view.role === "executor") return item.executor === actor().id;
  for (const node of item.flow) if (node.userId === actor().id) return true;
  return false;
}

/**
 * 校验业务动作所需身份、归属与当前状态，所有办理入口均调用此函数。
 * @param {object} item 目标活动
 * @param {string} action 业务动作名
 * @returns {boolean} 当前身份是否有权执行动作
 */
function allowed(item, action) {
  if (!canRead(item)) return false;
  const own = item.applicant === actor().id;
  const editable = ["draft", "needs_info", "withdrawn"].includes(item.status);
  const task = item.status === "approving" && item.flow[item.node]?.userId === actor().id && !own;
  if (["edit", "submit"].includes(action)) return own && view.role === "applicant" && editable;
  if (action === "withdraw") return own && item.status === "approving";
  if (["approve", "return", "reject"].includes(action)) return task;
  if (action === "assign") return view.role === "coordinator" && item.status === "ready_assign";
  if (action === "start") return item.executor === actor().id && item.status === "ready_execute";
  if (action === "report") return item.executor === actor().id && item.status === "executing";
  if (action === "archive-submit") return own && view.role === "applicant" && item.status === "archive_draft";
  if (["archive-approve", "archive-return"].includes(action)) return view.role === "archivist" && item.status === "archive_review" && item.archive?.submittedBy !== actor().id;
  if (action === "cancel-request") return (own || view.role === "coordinator") && ["ready_assign", "ready_execute", "executing"].includes(item.status);
  if (["cancel-approve", "cancel-reject"].includes(action)) return item.status === "cancel_review" && view.role === "department" && item.applicant !== actor().id && item.cancel?.requester !== actor().id;
  if (action === "cancel-withdraw") return item.status === "cancel_review" && item.cancel?.requester === actor().id;
  if (action === "copy") return view.role === "applicant" && own;
  return false;
}

/**
 * 返回当前身份的可见活动，待办和列表共用同一访问范围。
 * @returns {Array<object>} 当前可访问活动
 */
function visibleItems() { const items = []; for (const item of db.items) if (canRead(item)) items.push(item); return items; }

/**
 * 判断活动是否存在当前身份可办理的主要任务。
 * @param {object} item 活动记录
 * @returns {boolean} 是否属于我的待办
 */
function isTask(item) {
  for (const action of ["approve", "assign", "start", "report", "archive-submit", "archive-approve", "cancel-approve"]) if (allowed(item, action)) return true;
  return view.role === "applicant" && allowed(item, "edit") && item.status === "needs_info";
}

/**
 * 输出带颜色和文字的状态标签，颜色不作为唯一状态提示。
 * @param {string} status 业务状态
 * @returns {string} 标签 HTML
 */
function badge(status) { const s = STATUS[status] || [status, ""]; return `<span class="tag ${s[1]}">${s[0]}</span>`; }

/**
 * 获取活动当前负责人与下一步，供列表和详情展示。
 * @param {object} item 活动记录
 * @returns {object} 当前负责人和动作说明
 */
function nextStep(item) {
  const map = {
    draft: ["林晓", "填写资料并提交申请"], needs_info: ["林晓", "按退回意见补充后重新提交"], withdrawn: ["林晓", "修改后可重新提交"],
    ready_assign: ["王舟", "审批已完成，请指派执行人"], ready_execute: ["苏禾", "按计划时间开始执行"], executing: ["苏禾", "完成后提交执行汇报"],
    archive_draft: ["林晓", "补齐成果材料并提交档案"], archive_review: ["何青", "核查执行结果与成果后归档"],
    archived: ["已归档", "活动闭环完成，档案只读"], rejected: ["已结束", "查看拒绝原因，可复制为新申请"], cancelled: ["已结束", "活动已取消，可复制为新申请"],
    cancel_review: ["陈宁", "取消审批处理中，执行操作已冻结"]
  };
  if (item.status === "approving") return { owner: item.flow[item.node]?.name || "负责人缺失", text: `等待${item.flow[item.node]?.label || "管理员修复映射"}审批` };
  const result = map[item.status] || ["待确认", "查看办理记录"];
  return { owner: result[0], text: result[1] };
}

/**
 * 渲染统一导航、身份和当前页面，保留演示终端选择。
 */
function render() {
  document.body.classList.toggle("mobile-mode", view.device === "mobile");
  document.getElementById("pc-switch").setAttribute("aria-pressed", String(view.device === "pc"));
  document.getElementById("mobile-switch").setAttribute("aria-pressed", String(view.device === "mobile"));
  const roleSelect = document.getElementById("role-select");
  let roleOptions = "";
  for (const [key, role] of Object.entries(ROLES)) roleOptions += `<option value="${key}" ${key === view.role ? "selected" : ""}>${role.name} · ${role.title}</option>`;
  roleSelect.innerHTML = roleOptions;
  let nav = "";
  for (const [key, symbol, label] of NAV) {
    if (key === "rules" && view.role !== "admin") continue;
    if (view.role === "admin" && key !== "rules") continue;
    let count = 0;
    if (key === "tasks") for (const item of visibleItems()) if (isTask(item)) count += 1;
    nav += `<button data-action="nav" data-id="${key}" class="${view.page === key ? "active" : ""}"><span class="nav-symbol" aria-hidden="true">${symbol}</span>${label}${count ? `<span class="nav-count">${count}</span>` : ""}</button>`;
  }
  document.getElementById("desktop-nav").innerHTML = nav;
  let mobileNav = "";
  for (const [key, symbol, label] of MOBILE_NAV) mobileNav += `<button data-action="nav" data-id="${key}" class="${view.page === key ? "active" : ""}"><span class="nav-symbol" aria-hidden="true">${symbol}</span>${label}</button>`;
  document.getElementById("mobile-nav").innerHTML = mobileNav;
  const titles = { home: "工作台", activities: "活动工单", tasks: "我的待办", archives: "活动档案", rules: "流程设置", detail: "工单详情", form: "活动申请", mine: "我发起的", me: "我的" };
  document.getElementById("breadcrumb").innerHTML = `${view.device === "mobile" ? "行知 · " : "活动协作 / "}${titles[view.page]}<span>${view.device === "mobile" ? "" : "树人教育研究院"}</span>`;
  document.getElementById("identity").innerHTML = `<span class="avatar">${esc(actor().name.slice(-1))}</span><span>${esc(actor().name)}<small>${esc(actor().title)}</small></span>`;
  let html = "";
  if (!storageAvailable) html += `<div class="notice warning">当前浏览器未开放本地存储，内容在本次页面内保留。</div>`;
  if (view.page === "home") html += homePage();
  if (["activities", "tasks", "archives", "mine"].includes(view.page)) html += listPage();
  if (view.page === "detail") html += detailPage();
  if (view.page === "form") html += formPage();
  if (view.page === "rules") html += rulesPage();
  if (view.page === "me") html += mePage();
  document.getElementById("main").innerHTML = html;
}

/**
 * 输出列表或待办的无数据提示。
 * @param {string} title 空状态标题
 * @param {string} text 下一步说明
 * @returns {string} 空状态 HTML
 */
function empty(title, text) { return `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`; }

/**
 * 渲染工作台，以真实演示记录计算指标和待办。
 * @returns {string} 工作台页面 HTML
 */
function homePage() {
  if (view.role === "admin") return `<div class="page-heading"><div><h1>配置工作空间</h1><p>管理员负责流程规则，业务审批按独立角色授权。</p></div><button class="btn primary" data-action="nav" data-id="rules">进入流程设置</button></div>`;
  const items = visibleItems();
  const tasks = []; const upcoming = [];
  let unassigned = 0; let unarchived = 0; let inProgress = 0;
  for (const item of items) {
    if (isTask(item)) tasks.push(item);
    if (item.status === "ready_assign") unassigned += 1;
    if (["archive_draft", "archive_review"].includes(item.status)) unarchived += 1;
    if (!["draft", "archived", "cancelled", "rejected", "withdrawn"].includes(item.status)) inProgress += 1;
    if (["ready_assign", "ready_execute", "executing"].includes(item.status)) upcoming.push(item);
  }
  const dateLabel = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  let html = `<div class="page-heading"><div><div class="eyebrow">WORKSPACE / 工作台</div><h1>${esc(actor().name)}，工作顺利</h1><p>${esc(dateLabel)} · 从待办开始，跟进每一场活动。</p></div>${view.role === "applicant" ? '<button class="btn primary" data-action="new">＋ 发起活动</button>' : ""}</div><div class="stats">`;
  const metrics = [["我的待办", tasks.length, "需要我处理的事项", "tasks", "◷", ""], ["进行中的工单", inProgress, "当前权限范围内的在途活动", "activities", "▤", ""], ["待指派", unassigned, "审批通过后安排执行人", "activities", "↗", "ready_assign"], ["待归档", unarchived, "结果已提交，待完成闭环", "activities", "▣", "archive_pending"]];
  for (const [label, value, note, target, icon, filter] of metrics) html += `<button class="stat" data-action="metric" data-id="${target}" data-filter="${filter}"><span class="stat-icon" aria-hidden="true">${icon}</span><span class="stat-label">${label}</span><span class="stat-number number">${value}<small> 项</small></span><span class="stat-note">${note}</span></button>`;
  html += `</div><div class="dashboard-grid"><section class="panel"><div class="panel-header"><h2>需要我处理 <span class="count-tag">${tasks.length}</span></h2><button class="link-button" data-action="nav" data-id="tasks">全部待办 →</button></div>`;
  for (const item of tasks.slice(0, 5)) html += `<div class="task-row"><span class="task-icon" aria-hidden="true">▤</span><div class="task-copy"><button data-action="open" data-id="${item.id}">${esc(item.name)}</button><p>${esc(nextStep(item).text)} · ${money(budgetTotal(item))}</p></div>${badge(item.status)}<button class="btn small" data-action="open" data-id="${item.id}">处理</button></div>`;
  if (!tasks.length) html += empty("当前暂无待办", "有新的办理任务时会出现在这里。");
  html += `</section><div class="stack"><section class="panel"><div class="panel-header"><h2>已批准的活动安排</h2><small>可见范围</small></div><div class="panel-body">`;
  for (const item of upcoming.slice(0, 3)) html += `<div class="schedule-item"><div class="date-block">${item.start.slice(8, 10)}<small>${Number(item.start.slice(5, 7))} 月</small></div><div><button class="link-button" data-action="open" data-id="${item.id}" style="text-align:left;color:#465c7b">${esc(item.name)}</button><p>${esc(item.location)} · ${STATUS[item.status][0]}</p></div></div>`;
  if (!upcoming.length) html += `<p class="muted">暂无待开展的活动</p>`;
  html += `</div></section><section class="panel"><div class="panel-body"><h3>一张工单，全程跟进</h3><p class="muted" style="font-size:11px;margin-top:9px;line-height:1.9">申请审批后，依次完成执行指派、结果汇报和档案审核。每个阶段都有明确负责人。</p><div class="flow-inline"><span class="flow-chip">申请</span><span>→</span><span class="flow-chip">审批</span><span>→</span><span class="flow-chip">执行</span><span>→</span><span class="flow-chip">归档</span></div></div></section></div></div>`;
  return html;
}

/**
 * 根据当前页、关键词和状态筛选活动，所有条件叠加生效。
 * @returns {Array<object>} 过滤后的可见记录
 */
function filteredItems() {
  const items = [];
  for (const item of visibleItems()) {
    if (view.page === "tasks" && !isTask(item)) continue;
    if (view.page === "archives" && item.status !== "archived") continue;
    if (view.page === "mine" && item.applicant !== actor().id) continue;
    if (view.filter === "archive_pending") { if (!["archive_draft", "archive_review"].includes(item.status)) continue; }
    else if (view.filter && item.status !== view.filter) continue;
    if (view.query && !`${item.name} ${item.code} ${item.location}`.toLowerCase().includes(view.query.toLowerCase())) continue;
    items.push(item);
  }
  return items;
}

/**
 * 渲染桌面表格与 H5 卡片列表，关键词筛选使用同一结果。
 * @returns {string} 列表页面 HTML
 */
function listPage() {
  const items = filteredItems();
  const title = { activities: "活动工单", tasks: "我的待办", archives: "活动档案", mine: "我发起的" }[view.page];
  let options = `<option value="">全部状态</option><option value="archive_pending" ${view.filter === "archive_pending" ? "selected" : ""}>待归档（全部）</option>`;
  for (const [key, status] of Object.entries(STATUS)) options += `<option value="${key}" ${view.filter === key ? "selected" : ""}>${status[0]}</option>`;
  let html = `<div class="page-heading"><div><div class="eyebrow">ACTIVITIES / ${title}</div><h1>${title}</h1><p>${view.page === "tasks" ? "按当前身份展示可办理事项，处理后自动更新。" : "在权限范围内查找活动与办理进度。"}</p></div>${view.role === "applicant" ? '<button class="btn primary" data-action="new">＋ 发起活动</button>' : ""}</div><section class="panel"><div class="table-tools"><input id="search-input" aria-label="搜索活动名称、编号或学校" placeholder="搜索活动名称、编号或学校" value="${esc(view.query)}"><select id="status-filter" aria-label="按活动状态筛选">${options}</select><button class="btn small" data-action="clear-filter">清空条件</button><small id="result-count">共 ${items.length} 项</small></div><div id="list-content">${listContent(items)}</div></section>`;
  return html;
}

/**
 * 输出查询结果内容，搜索时只替换结果以保留输入焦点。
 * @param {Array<object>} items 已过滤记录
 * @returns {string} 表格与移动卡片 HTML
 */
function listContent(items) {
  if (!items.length) return empty("暂无符合条件的活动", view.page === "tasks" ? "当前身份没有匹配的办理任务，可调整筛选条件。" : "调整条件，或从发起活动开始。");
  let rows = ""; let cards = "";
  for (const item of items) {
    const next = nextStep(item);
    rows += `<tr><td class="name-col"><button data-action="open" data-id="${item.id}">${esc(item.name)}</button><small>${item.code} · ${esc(item.mode)}</small></td><td>${esc(item.start.slice(0, 10))}<small>${esc(item.location || "线上会议")}</small></td><td>${esc(item.org)}</td><td class="number no-break">${money(budgetTotal(item))}</td><td>${badge(item.status)}</td><td>${esc(next.owner)}</td><td><button class="link-button" data-action="open" data-id="${item.id}">查看</button></td></tr>`;
    cards += `<article class="mobile-card"><button data-action="open" data-id="${item.id}">${esc(item.name)}</button><p>${esc(item.start.slice(0, 10))} · ${esc(item.location || "线上会议")}<br>${esc(next.text)} · ${esc(next.owner)}</p><div class="mobile-card-foot">${badge(item.status)}<span class="number">${money(budgetTotal(item))}</span></div></article>`;
  }
  return `<div class="table-wrap"><table><thead><tr><th>活动名称 / 编号</th><th>活动时间 / 地点</th><th>申请部门</th><th>总预算</th><th>当前状态</th><th>当前负责人</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div><div class="mobile-cards">${cards}</div><div class="table-foot"><span>共 ${items.length} 项 · 演示数据本地保存</span><span>当前展示全部筛选结果</span></div>`;
}

/**
 * 输出字段控件与明确标签，输入均绑定到当前编辑模型。
 * @param {string} name 字段名称
 * @param {string} label 字段中文含义
 * @param {object} options 控件类型、必填、选项与提示
 * @returns {string} 字段控件 HTML
 */
function field(name, label, options = {}) {
  const value = view.editing[name] ?? "";
  let input;
  const attrs = `name="${name}" data-field="${name}" ${options.required ? 'aria-required="true"' : ""}`;
  if (options.options) {
    let list = "";
    for (const option of options.options) list += `<option value="${esc(option)}" ${value === option ? "selected" : ""}>${esc(option)}</option>`;
    input = `<select ${attrs}>${list}</select>`;
  } else if (options.textarea) input = `<textarea ${attrs} maxlength="${options.max || 3000}" placeholder="${esc(options.placeholder || "")}">${esc(value)}</textarea>`;
  else input = `<input ${attrs} type="${options.type || "text"}" value="${esc(value)}" ${options.max ? `maxlength="${options.max}"` : ""} ${options.type === "number" ? 'min="1" max="100000" step="1"' : ""} placeholder="${esc(options.placeholder || "")}">`;
  return `<label class="field ${options.full ? "full" : ""}"><span>${label}${options.required ? "<b>*</b>" : ""}</span>${input}${options.hint ? `<small>${esc(options.hint)}</small>` : ""}</label>`;
}

/**
 * 渲染内容形式和人员构成的多选控件。
 * @param {string} name 申请字段名
 * @param {Array<string>} options 允许选择的中文选项
 * @returns {string} 原生复选框组
 */
function checkGroup(name, options) {
  let html = '<div class="checks">';
  for (const option of options) html += `<label><input type="checkbox" data-check="${name}" value="${esc(option)}" ${view.editing[name].includes(option) ? "checked" : ""}>${esc(option)}</label>`;
  return html + "</div>";
}

/**
 * 渲染三步申请页，PC 与 H5 使用相同字段和提交流程。
 * @returns {string} 申请编辑页面 HTML
 */
function formPage() {
  if (!view.editing || view.role !== "applicant") return empty("当前身份无申请权限", "切换到申请人后填写。");
  const item = view.editing;
  let html = `<div class="form-width"><button class="back" data-action="leave-form">← 返回活动工单</button><div class="page-heading"><div><div class="eyebrow">NEW ACTIVITY / 活动申请</div><h1>${item.id ? "编辑活动申请" : "发起一场活动"}</h1><p>分三步填写，提交前可随时保存草稿。</p></div></div><section class="panel"><div class="steps">`;
  const stepNames = ["基本信息", "方案与人员", "预算与提交"];
  for (let i = 0; i < 3; i += 1) html += `<div class="step ${i + 1 === view.step ? "active" : i + 1 < view.step ? "done" : ""}"><span>${i + 1 < view.step ? "✓" : i + 1}</span>${stepNames[i]}</div>`;
  html += `</div><div class="form-section">`;
  if (view.errors.length) { html += '<div class="notice error" role="alert"><strong>请补充以下内容</strong><ul>'; for (const error of view.errors) html += `<li>${esc(error)}</li>`; html += "</ul></div>"; }
  if (view.step === 1) {
    html += `<h2 class="section-title">先确定活动的时间与方式</h2><div class="form-grid">`;
    html += field("name", "活动名称", { required: true, full: true, max: 80, placeholder: "例如：阅读教学与表达课例研讨" });
    html += `<label class="field">申请部门<input value="教研一部" readonly><small>根据当前申请人自动带出</small></label><label class="field">申请人<input value="林晓" readonly></label>`;
    html += field("start", "开始时间", { type: "datetime-local", required: true }) + field("end", "结束时间", { type: "datetime-local", required: true });
    html += field("mode", "举办方式", { required: true, options: ["线下", "线上", "混合"] });
    html += field("nature", "业务性质", { required: true, options: ["校园立体阅读课程项目", "整本书项目", "实验区", "实验校", "其他"] });
    if (item.mode !== "线上") html += field("location", "活动地点／学校", { required: true, full: true, max: 150 });
    if (item.mode !== "线下") html += field("url", "线上会议链接", { required: true, full: true, placeholder: "https://", hint: "仅接受 HTTPS 链接" });
    html += field("service", "服务类型", { required: true, options: ["免费课题服务", "收费课题培训", "其他"] });
    html += field("forum", "是否附带三峡大讲坛", { required: true, options: ["否", "是"] });
    html += "</div>";
  } else if (view.step === 2) {
    html += `<h2 class="section-title">把活动方案与协作人员说清楚</h2><div class="form-grid">`;
    html += field("background", "活动背景与诉求", { required: true, full: true, textarea: true, max: 2000, placeholder: "可从征订情况、教情学情、前期培训基础和本次诉求展开。" });
    html += field("agenda", "活动议程及内容", { required: true, full: true, textarea: true, placeholder: "按时间段描述环节、内容与负责人。" });
    html += `<div class="full"><label class="field"><span>内容形式<b>*</b></span></label>${checkGroup("contentForms", FORMS)}</div>`;
    html += field("people", "预计参会人数", { required: true, type: "number" });
    html += field("personnel", "专家及人员要求", { max: 1000 });
    html += `<div class="full"><label class="field"><span>人员构成<b>*</b></span></label>${checkGroup("composition", PEOPLE)}</div>`;
    html += field("training", "培训要求：内容、形式与时长", { full: true, required: item.service === "收费课题培训", textarea: true, max: 1000 });
    html += field("otherNote", "其他分类补充说明", { full: true, max: 500, hint: "业务性质、服务类型、内容形式或人员构成选择“其他”时必填。" });
    html += field("contact", "活动联系人", { required: true, max: 50 }) + field("contactInfo", "联系人方式", { required: true, placeholder: "手机、座机或邮箱" });
    html += field("arranger", "活动安排人", { required: true, max: 50 }) + field("arrangerInfo", "安排人联系方式", { required: true });
    html += field("receiver", "活动接收人", { required: true, max: 50 }) + field("receiverInfo", "接收人联系方式", { required: true });
    html += "</div>";
  } else {
    html += `<h2 class="section-title">确认预算，预览审批路径</h2><div class="notice">无费用也可申请，保留一条 0.00 元预算明细即可。总额由明细自动合计。</div>`;
    for (let i = 0; i < item.budget.length; i += 1) {
      let categories = "";
      for (const category of ["专家费", "会务费", "差旅费", "其他"]) categories += `<option ${item.budget[i].category === category ? "selected" : ""}>${category}</option>`;
      html += `<div class="budget-row"><select data-budget="category" data-index="${i}" aria-label="第${i + 1}项费用类别">${categories}</select><input data-budget="amount" data-index="${i}" aria-label="第${i + 1}项费用金额（元）" type="text" inputmode="decimal" value="${esc(item.budget[i].amount)}" placeholder="0.00 元"><input class="budget-note" data-budget="note" data-index="${i}" maxlength="300" aria-label="第${i + 1}项费用说明" placeholder="费用说明" value="${esc(item.budget[i].note)}"><button class="btn ghost budget-remove" data-action="budget-remove" data-id="${i}" aria-label="删除第${i + 1}项费用" ${item.budget.length === 1 ? "disabled" : ""}>×</button></div>`;
    }
    html += `<button class="link-button" data-action="budget-add">＋ 添加费用明细</button><div class="budget-total">预算总额<strong id="budget-total" class="number">${Number.isFinite(budgetTotal(item)) ? money(budgetTotal(item)) : "金额待修正"}</strong></div><div class="divider"></div><label class="field">相关附件<input type="file" id="application-files" multiple accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"><small>演示仅记录文件名称，不上传。单个≤20MB，最多10个。</small></label>`;
    html += fileRows(item.files);
    html += `<div class="divider"></div><h3>提交后将依次审批</h3><small>使用已发布规则 V${db.rule.version}；申请人：林晓</small><div class="flow-inline" id="form-flow">${flowChips(resolveFlow(item, db.rule))}</div><div class="notice warning">提交后申请内容锁定。退回或撤回后可修改并重新提交，新版本从第一层开始审批。</div>`;
  }
  html += `</div><div class="form-footer"><button class="btn" data-action="save-draft">保存${item.status === "needs_info" ? "修改" : "草稿"}</button><div class="actions">${view.step > 1 ? '<button class="btn" data-action="previous-step">上一步</button>' : ""}${view.step < 3 ? '<button class="btn primary" data-action="next-step">下一步 →</button>' : '<button class="btn primary" data-action="submit-form">提交申请</button>'}</div></div></section></div>`;
  return html;
}

/**
 * 输出审批路径标签。
 * @param {Array<object>} flow 审批节点
 * @returns {string} 审批路径 HTML
 */
function flowChips(flow) { let html = ""; let i = 0; for (const node of flow) { if (i) html += "<span>→</span>"; html += `<span class="flow-chip">${esc(node.label)}</span>`; i += 1; } return html; }

/**
 * 输出仅记录名称的演示附件，避免误认为文件已真实上传。
 * @param {Array<object>} files 文件元数据
 * @returns {string} 文件名称列表 HTML
 */
function fileRows(files) { let html = ""; for (const file of files || []) html += `<div class="file-row"><span>${esc(file.name)}</span><small>本地选择 · 未上传</small></div>`; return html; }

/**
 * 校验申请字段，支持分步骤校验和提交时的全量校验。
 * @param {object} item 申请模型
 * @param {number} step 需要校验的步骤，0 表示全部
 * @returns {Array<string>} 可直接展示的中文错误列表
 */
function validateApplication(item, step = 0) {
  const errors = [];
  if (step === 0 || step === 1) {
    if (item.name.trim().length < 2 || item.name.trim().length > 80) errors.push("基本信息：活动名称需为 2—80 字。");
    if (!item.start || !item.end || new Date(item.end) <= new Date(item.start)) errors.push("基本信息：结束时间必须晚于开始时间。");
    if (item.start && new Date(item.start).getTime() < Date.now()) errors.push("基本信息：普通活动需选择未来的开始时间。");
    if (item.mode !== "线上" && item.location.trim().length < 2) errors.push("基本信息：请填写活动地点或学校。");
    if (item.mode !== "线下" && !isHttps(item.url)) errors.push("基本信息：线上或混合活动需填写有效 HTTPS 会议链接。");
  }
  if (step === 0 || step === 2) {
    if (item.background.trim().length < 10) errors.push("方案与人员：背景与诉求至少填写 10 字。");
    if (item.agenda.trim().length < 10) errors.push("方案与人员：议程及内容至少填写 10 字。");
    if (!item.contentForms.length) errors.push("方案与人员：至少选择一种内容形式。");
    if (!item.composition.length) errors.push("方案与人员：至少选择一种人员构成。");
    if (!/^\d+$/.test(String(item.people)) || Number(item.people) < 1 || Number(item.people) > 100000) errors.push("方案与人员：预计人数需为 1—100000 的整数。");
    if (item.service === "收费课题培训" && !item.training.trim()) errors.push("方案与人员：收费培训需填写内容、形式与时长。");
    const other = item.nature === "其他" || item.service === "其他" || item.contentForms.includes("其他") || item.composition.includes("其他");
    if (other && !item.otherNote.trim()) errors.push("方案与人员：选择“其他”时请填写分类补充说明。");
    for (const [key, label] of [["contact", "活动联系人"], ["arranger", "活动安排人"], ["receiver", "活动接收人"]]) {
      if (item[key].trim().length < 2) errors.push(`方案与人员：请填写${label}姓名，至少 2 字。`);
      if (!validContact(item[key + "Info"])) errors.push(`方案与人员：请填写有效的${label}手机、座机或邮箱。`);
    }
  }
  if (step === 0 || step === 3) {
    if (!item.budget.length || !Number.isFinite(budgetTotal(item))) errors.push("预算与提交：金额必须非负、至多两位小数，单项不超过一亿元。");
    const flow = resolveFlow(item, db.rule);
    for (const node of flow) if (node.userId === item.applicant) errors.push(`预算与提交：${node.label}与申请人相同，请先配置替代审批人。`);
  }
  return errors;
}

/**
 * 校验公司内部常见联系方式。
 * @param {string} value 手机、座机或邮箱
 * @returns {boolean} 联系方式是否满足演示格式要求
 */
function validContact(value) { const text = value.trim(); return /^1\d{10}$/.test(text) || /^\+?[\d -]{7,20}$/.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text); }

/**
 * 校验链接协议及主机名，拒绝可执行脚本与非加密链接。
 * @param {string} value 输入链接
 * @returns {boolean} 是否为有效 HTTPS 地址
 */
function isHttps(value) { try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname; } catch { return false; } }

/**
 * 输出键值信息，集中转义详情文本。
 * @param {Array<Array<string>>} pairs 标签和值
 * @returns {string} 语义化详情列表
 */
function infoGrid(pairs) { let html = '<dl class="info-grid">'; for (const [label, value] of pairs) html += `<div><dt>${esc(label)}</dt><dd>${esc(value || "未填写")}</dd></div>`; return html + "</dl>"; }

/**
 * 渲染活动详情、申请版本、当前任务、执行结果与历史。
 * @returns {string} 工单详情 HTML
 */
function detailPage() {
  const item = findItem(view.detail);
  if (!canRead(item)) return empty("当前身份无访问权限", "返回列表，或切换到有权限的演示身份。");
  let data = item; let old = false;
  if (view.revision !== "current") for (const snapshot of item.snapshots) if (String(snapshot.revision) === view.revision) { data = snapshot.data; old = true; }
  const next = nextStep(item);
  let html = `<button class="back" data-action="nav" data-id="activities">← 返回活动工单</button><div class="detail-layout"><div><section class="panel detail-summary"><div class="detail-title"><div><h1>${esc(data.name || "未命名活动")}</h1><p>${item.code} · 申请人 林晓 · 申请 V${item.revision} · 规则 V${item.workflowVersion || "尚未提交"}</p></div>${badge(item.status)}</div><div class="next-step"><div><strong>${esc(next.text)}</strong><span>当前负责人：${esc(next.owner)}</span></div><span>${esc(item.org)}</span></div>`;
  if (item.snapshots.length) {
    html += '<div class="revision" style="margin-top:18px"><label class="field">查看申请版本<select id="revision-select"><option value="current">当前申请内容</option>';
    for (const snapshot of item.snapshots) html += `<option value="${snapshot.revision}" ${view.revision === String(snapshot.revision) ? "selected" : ""}>申请 V${snapshot.revision} · 提交快照 · 规则 V${snapshot.rule}</option>`;
    html += `</select></label></div>`;
  }
  if (old) html += `<div class="notice warning">正在查看历史申请快照 V${view.revision}。如需办理当前任务，请先切换回“当前申请内容”。</div>`;
  if (item.status === "needs_info") {
    for (let i = item.history.length - 1; i >= 0; i -= 1) if (item.history[i].title === "退回补充") { html += `<div class="notice warning">退回意见：${esc(item.history[i].comment)}</div>`; break; }
  }
  if (item.status === "cancel_review") html += `<div class="notice warning">取消原因：${esc(item.cancel.reason)}<br>冻结前状态：${STATUS[item.cancel.previous][0]}${item.cancel.disposal ? `<br>费用处置：${esc(item.cancel.disposal)}` : ""}</div>`;
  html += infoGrid([["举办方式", data.mode], ["开始时间", formatTime(data.start)], ["结束时间", formatTime(data.end)], ["活动地点", data.location || "线上"], ["业务性质", data.nature], ["服务类型", data.service], ["预计参会", `${data.people || "待填"} 人`], ["内容形式", data.contentForms.join("、")], ["附带三峡大讲坛", data.forum]]);
  if (data.url && isHttps(data.url)) html += `<div class="detail-section"><h2>线上会议</h2><a href="${esc(data.url)}" target="_blank" rel="noopener noreferrer">${esc(data.url)}</a></div>`;
  html += `<div class="detail-section"><h2>活动方案</h2><p class="sub-label">活动背景与诉求</p><p>${esc(data.background || "尚未填写")}</p><p class="sub-label">议程及内容</p><p>${esc(data.agenda || "尚未填写")}</p><p class="sub-label">培训要求／人员要求</p><p>${esc(data.training || "无补充要求")}\n${esc(data.personnel)}</p><p class="sub-label">人员构成</p><p>${esc(data.composition.join("、"))}</p>${data.otherNote ? `<p class="sub-label">其他分类说明</p><p>${esc(data.otherNote)}</p>` : ""}</div>`;
  html += `<div class="detail-section"><h2>协作人员</h2>${infoGrid([["活动联系人", data.contact], ["联系人方式", data.contactInfo], ["活动安排人", data.arranger], ["安排人方式", data.arrangerInfo], ["活动接收人", data.receiver], ["接收人方式", data.receiverInfo]])}</div><div class="detail-section"><h2>费用预算 <span class="count-tag number">${money(budgetTotal(data))}</span></h2><table><thead><tr><th>费用类别</th><th>说明</th><th>金额</th></tr></thead><tbody>`;
  for (const row of data.budget) html += `<tr><td>${esc(row.category)}</td><td>${esc(row.note || "—")}</td><td class="number">${money(toFen(row.amount))}</td></tr>`;
  html += `</tbody></table>${data.files.length ? fileRows(data.files) : '<small>未选择申请附件</small>'}</div>`;
  if (!old && item.executor) html += `<div class="detail-section"><h2>执行安排</h2><p>执行人：苏禾\n${esc(item.assignment)}</p></div>`;
  if (!old && item.report) html += `<div class="detail-section"><h2>执行汇报</h2>${infoGrid([["实际开始", formatTime(item.report.start)], ["实际结束", formatTime(item.report.end)], ["实到人数", `${item.report.people} 人`]])}<p style="margin-top:15px">${esc(item.report.summary)}${item.report.exception ? "\n异常说明：" + esc(item.report.exception) : ""}${item.report.spend ? "\n实际支出参考：" + money(toFen(item.report.spend)) : ""}</p></div>`;
  if (!old && item.archive) html += `<div class="detail-section"><h2>活动档案 <small>提交 V${item.archive.version}${item.archive.code ? " · " + item.archive.code : ""}</small></h2><p>${esc(item.archive.summary)}</p>${item.archive.url && isHttps(item.archive.url) ? `<p style="margin-top:10px"><a href="${esc(item.archive.url)}" target="_blank" rel="noopener noreferrer">查看成果链接 ↗</a>${item.archive.url.includes("example.com") ? "（示例地址）" : ""}</p>` : ""}${fileRows(item.archive.files)}</div>`;
  if (!old && item.archiveAttempts?.length) { html += '<div class="detail-section"><h2>历次档案提交</h2>'; for (const attempt of item.archiveAttempts) html += `<div class="history-item"><strong>档案 V${attempt.version} · ${esc(attempt.result || "历史提交")}</strong><p>${esc(attempt.summary)}${attempt.comment ? "\n审核意见：" + esc(attempt.comment) : ""}</p></div>`; html += "</div>"; }
  html += `</section>${old ? "" : detailActions(item)}</div><aside class="stack"><section class="panel"><div class="panel-header"><h2>办理进度</h2><small>申请 V${item.revision}</small></div><div class="timeline">${timeline(item)}</div></section><section class="panel"><div class="panel-header"><h2>办理记录</h2><small>${item.history.length} 条</small></div><div class="history">`;
  for (const entry of [...item.history].reverse()) html += `<div class="history-item"><strong>${esc(entry.title)} · ${esc(entry.actor)}</strong><p>${esc(entry.comment || "无补充意见")}</p><time>${formatTime(entry.at)}</time></div>`;
  html += "</div></section></aside></div>";
  return html;
}

/**
 * 输出按身份可执行的详情操作，拒绝和取消保持可见但降低视觉优先级。
 * @param {object} item 当前活动
 * @returns {string} 业务动作按钮区
 */
function detailActions(item) {
  const definitions = [["edit", "补充／编辑申请", "primary"], ["approve", "同意", "primary"], ["return", "退回补充", ""], ["reject", "拒绝", "danger"], ["withdraw", "撤回申请", ""], ["assign", "指派执行人", "primary"], ["start", "开始执行", "primary"], ["report", "填写执行汇报", "primary"], ["archive-submit", "提交活动档案", "primary"], ["archive-approve", "审核并归档", "primary"], ["archive-return", "退回档案", ""], ["cancel-approve", "同意取消", "primary"], ["cancel-reject", "拒绝取消", ""], ["cancel-withdraw", "撤销取消申请", ""], ["cancel-request", "申请取消", "ghost"], ["copy", "复制新建", "ghost"]];
  let html = '<div class="detail-actions">'; let count = 0;
  for (const [action, label, style] of definitions) {
    if (!allowed(item, action)) continue;
    html += `<button class="btn ${style}" data-action="${action}" data-id="${item.id}">${label}</button>`; count += 1;
  }
  if (!count) html += `<small>当前身份暂无可办理动作，可查看申请与历史记录。</small>`;
  return html + "</div>";
}

/**
 * 渲染审批与执行的纵向流程，终止和取消状态不虚构后续完成。
 * @param {object} item 活动记录
 * @returns {string} 流程时间线 HTML
 */
function timeline(item) {
  if (!item.revision) return `<div class="timeline-row current"><strong>填写申请</strong><p>申请人 林晓</p></div>`;
  let html = '<div class="timeline-row done"><strong>提交申请</strong><p>林晓 · 申请 V' + item.revision + "</p></div>";
  for (let i = 0; i < item.flow.length; i += 1) {
    const current = item.status === "approving" && i === item.node;
    const done = i < item.node || ["ready_assign", "ready_execute", "executing", "archive_draft", "archive_review", "archived", "cancel_review", "cancelled"].includes(item.status);
    const interrupted = i === item.node && ["needs_info", "rejected", "withdrawn"].includes(item.status);
    const label = current ? "待处理" : done ? "已通过" : interrupted ? ({ needs_info: "已退回", rejected: "已拒绝", withdrawn: "已撤回" }[item.status]) : "未流转";
    html += `<div class="timeline-row ${current ? "current" : done ? "done" : ""}"><strong>${esc(item.flow[i].label)}</strong><p>${esc(item.flow[i].name)} · ${label}</p></div>`;
  }
  const stages = [["执行指派", "王舟", ["ready_assign"], ["ready_execute", "executing", "archive_draft", "archive_review", "archived"]], ["执行与汇报", "苏禾", ["ready_execute", "executing"], ["archive_draft", "archive_review", "archived"]], ["档案提交", "林晓", ["archive_draft"], ["archive_review", "archived"]], ["归档审核", "何青", ["archive_review"], ["archived"]]];
  for (const [label, owner, active, finished] of stages) html += `<div class="timeline-row ${active.includes(item.status) ? "current" : finished.includes(item.status) ? "done" : ""}"><strong>${label}</strong><p>${owner} · ${active.includes(item.status) ? "待办理" : finished.includes(item.status) ? "已完成" : "未流转"}</p></div>`;
  if (["withdrawn", "needs_info", "rejected", "cancel_review", "cancelled"].includes(item.status)) html += `<div class="timeline-row current"><strong>${STATUS[item.status][0]}</strong><p>${esc(nextStep(item).text)}</p></div>`;
  return html;
}

/**
 * 渲染规则配置，仅管理员可编辑；已发布规则与配置草稿分开显示。
 * @returns {string} 规则页面 HTML
 */
function rulesPage() {
  if (view.role !== "admin") return empty("需要系统管理员权限", "业务办理身份无法发布流程规则。");
  if (view.device === "mobile") return `<div class="page-heading"><div><h1>流程设置</h1><p>当前已发布 V${db.rule.version}</p></div></div><div class="notice">规则编辑在 PC 管理端完成。请切换顶部“PC 管理端”继续配置。</div>`;
  const rule = db.ruleDraft;
  let html = `<div class="page-heading"><div><div class="eyebrow">WORKFLOW / 流程设置</div><h1>少量配置，清晰流转</h1><p>当前已发布 V${db.rule.version} · 编辑草案只影响之后的新提交。</p></div><div class="actions"><button class="btn" data-action="rule-save">保存草案</button><button class="btn primary" data-action="rule-publish">发布新版本</button></div></div><div class="rules-grid"><div class="stack"><section class="panel"><div class="panel-header"><h2>默认审批路径</h2><span class="tag blue">串行审批</span></div><div class="panel-body">`;
  let index = 0;
  for (const key of ["department", "academic", "marketing"]) { index += 1; html += `<div class="rule-node"><span class="rule-number">${index}</span><div><strong>${ROLES[key].title}</strong><p>教研一部映射：${ROLES[key].name} · 提交时保存快照</p></div></div>`; }
  html += `</div></section><section class="panel"><div class="panel-header"><h2>金额分支 <small>业务假设，默认关闭</small></h2></div><div class="panel-body"><div class="checks"><label><input type="checkbox" id="rule-extra" ${rule.extraEnabled ? "checked" : ""}>预算达到阈值时追加院负责人审批</label></div><div class="form-grid"><label class="field">阈值金额（元）<input id="rule-threshold" inputmode="decimal" value="${esc(rule.thresholdFen / 100)}"></label><label class="field">追加受理人<input readonly value="刘文 · 院负责人"></label></div><small>条件使用“预算总额 ≥ 阈值”。保留默认三层，命中后追加一层。</small></div></section><section class="panel"><div class="panel-header"><h2>提醒与升级</h2></div><div class="panel-body"><div class="form-grid"><label class="field">首次提醒（自然小时）<input id="rule-reminder" type="number" min="1" max="720" value="${rule.reminderHours}"></label><label class="field">升级提醒（自然小时）<input id="rule-escalation" type="number" min="1" max="720" value="${rule.escalationHours}"></label></div><small>原型保留参数与版本，不实际发送提醒。超时始终不自动同意。</small></div></section></div><aside class="stack"><section class="panel"><div class="panel-header"><h2>草案路径预览</h2></div><div class="panel-body"><label class="field">测试预算（元）<input id="preview-amount" inputmode="decimal" value="10000"></label><div id="rule-preview">${rulePreview(1000000)}</div></div></section><div class="notice">发布 V${db.rule.version + 1} 后：<br>新提交使用新规则。<br>在途工单保留原审批链。<br>退回后重新提交使用最新规则。</div><section class="panel"><div class="panel-body"><h3>组织映射说明</h3><p class="muted" style="font-size:12px;margin-top:10px">本原型固定演示人员映射。正式配置需校验在职状态、替代审批人与自审冲突，发布行为写入审计。</p></div></section></aside></div>`;
  return html;
}

/**
 * 根据规则草案与测试金额输出审批节点数量和名称。
 * @param {number} fen 测试预算的整数分
 * @returns {string} 配置预览 HTML
 */
function rulePreview(fen) {
  if (!Number.isFinite(fen)) return '<div class="notice error">请输入有效测试金额。</div>';
  const sample = { budget: [{ amount: (fen / 100).toFixed(2) }] };
  const flow = resolveFlow(sample, db.ruleDraft);
  return `<div class="flow-subtitle">${money(fen)} · 共 ${flow.length} 层审批</div>${flowChips(flow)}`;
}

/**
 * 渲染移动端个人页，解释当前数据范围和管理端入口。
 * @returns {string} 个人页面 HTML
 */
function mePage() {
  return `<section class="panel"><div class="me-card"><span class="avatar">${esc(actor().name.slice(-1))}</span><h2>${esc(actor().name)}</h2><p>${esc(actor().title)} · 教研一部</p></div><button class="me-link" data-action="nav" data-id="tasks">我的待办<span>›</span></button><button class="me-link" data-action="nav" data-id="archives">可查看的活动档案<span>›</span></button>${view.role === "admin" ? '<button class="me-link" data-action="nav" data-id="rules">流程设置<span>›</span></button>' : ""}</section><div class="notice" style="margin-top:20px">当前为交互原型。身份切换用于评审不同职责，正式产品依账号授权。文件仅记录名称，全部操作保存在本地浏览器。</div><button class="btn" data-action="reset">重置演示数据</button>`;
}

/**
 * 显示短暂的操作结果，错误提示使用不同底色。
 * @param {string} message 用户可理解的结果文本
 * @param {boolean} error 是否属于错误
 */
function showToast(message, error = false) {
  const node = document.getElementById("toast");
  node.textContent = message; node.classList.toggle("error", error); node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(/** 隐藏已展示的反馈，无返回值。 */ function hideToast() { node.hidden = true; }, 4500);
}

/**
 * 追加不可覆盖的演示历史，同时更新记录版本与更新时间。
 * @param {object} item 目标活动
 * @param {string} title 办理动作标题
 * @param {string} comment 原因或说明
 */
function logAction(item, title, comment = "") {
  item.history.push({ title, actor: `${actor().name} · ${actor().title}`, comment, at: localDate(new Date()) });
  item.version += 1; item.updatedAt = localDate(new Date());
}

/**
 * 打开新的申请草稿或复制现有申请，不继承原记录的审批历史与终态。
 * @param {object|null} source 需要复制的原申请
 */
function newApplication(source = null) {
  if (view.role !== "applicant") { showToast("请切换到申请人身份发起活动。", true); return; }
  const item = blankActivity();
  if (source) { Object.assign(item, applicationData(source)); item.name += "（复制）"; item.start = dayAt(5, 9); item.end = dayAt(5, 17); item.files = []; }
  view.editing = item; view.step = 1; view.errors = []; view.page = "form"; render();
}

/**
 * 保存申请草稿，修改已有记录时重新检查权限及版本，保留退回或撤回状态。
 * @returns {object|null} 成功保存的活动，失败时返回 null
 */
function saveDraft() {
  if (view.role !== "applicant" || !view.editing) return null;
  const draft = view.editing;
  let item;
  if (draft.id) {
    item = findItem(draft.id);
    if (!allowed(item, "edit") || item.version !== draft.version) { showToast("工单已变化，请返回列表重新打开。", true); return null; }
    Object.assign(item, applicationData(draft));
  } else {
    const index = db.items.length + 1;
    item = clone(draft); item.id = "local-" + Date.now() + "-" + index;
    item.code = `HD-${new Date().getFullYear()}-${String(index).padStart(4, "0")}`;
    db.items.unshift(item);
  }
  logAction(item, "保存申请草稿", "申请内容尚未提交审批。");
  view.editing = clone(item); persist();
  return item;
}

/**
 * 全量校验并提交新申请版本，保存最新规则与审批节点快照。
 */
function submitForm() {
  if (!view.editing || view.role !== "applicant") return;
  view.errors = validateApplication(view.editing);
  if (view.errors.length) {
    const first = view.errors[0]; view.step = first.startsWith("基本") ? 1 : first.startsWith("方案") ? 2 : 3;
    render(); return;
  }
  if (new Date(view.editing.start).getTime() - Date.now() < 3 * 86400000) { openEarlyDialog(); return; }
  completeSubmit("");
}

/**
 * 展示提前不足三天的说明弹窗，保留已填写申请。
 */
function openEarlyDialog() {
  view.dialogAction = "early-submit";
  document.getElementById("dialog-content").innerHTML = dialogShell("申请时间距开始不足 3 天", '<p>可继续提交，请补充临近活动才申报的原因。审批完成后才能安排执行。</p><label class="field">情况说明<textarea id="dialog-comment" minlength="5" maxlength="500"></textarea></label>', "确认提交");
  document.getElementById("action-dialog").showModal();
}

/**
 * 创建审批实例与申请快照，确保同一提交只产生一个当前版本。
 * @param {string} earlyReason 提前三天不足时的说明
 */
function completeSubmit(earlyReason) {
  const item = saveDraft();
  if (!item || !allowed(item, "submit")) return;
  item.revision += 1; item.workflowVersion = db.rule.version; item.flow = resolveFlow(item, db.rule); item.node = 0; item.status = "approving";
  item.snapshots.push({ revision: item.revision, data: applicationData(item), rule: db.rule.version, flow: clone(item.flow), at: localDate(new Date()) });
  logAction(item, `提交申请 V${item.revision}`, `规则 V${db.rule.version}，当前受理人 ${item.flow[0].name}。${earlyReason ? "临近申报说明：" + earlyReason : ""}`);
  view.detail = item.id; view.page = "detail"; view.editing = null; view.revision = "current"; persist(); closeDialog(); render(); showToast("申请已提交，等待部门领导审批。");
}

/**
 * 输出通用业务弹窗外壳，使用原生 dialog 保证键盘焦点隔离。
 * @param {string} title 弹窗中文标题
 * @param {string} body 经过安全拼接的正文
 * @param {string} confirmLabel 确认按钮文本
 * @returns {string} 弹窗内部 HTML
 */
function dialogShell(title, body, confirmLabel) {
  return `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="btn ghost small" data-action="close-dialog" aria-label="关闭弹窗">×</button></div><div class="dialog-body"><div class="dialog-error" id="dialog-error" role="alert" hidden></div>${body}</div><div class="dialog-foot"><button class="btn" data-action="close-dialog">暂不处理</button><button class="btn primary" data-action="confirm-dialog">${esc(confirmLabel)}</button></div>`;
}

/**
 * 打开详情业务动作，进入弹窗前校验当前权限与状态。
 * @param {string} action 需要办理的动作
 * @param {string} id 活动标识
 */
function openAction(action, id) {
  const item = findItem(id);
  if (!allowed(item, action)) { showToast("当前身份或工单状态不允许该操作。", true); return; }
  if (action === "edit") { view.editing = clone(item); view.step = 1; view.errors = []; view.page = "form"; render(); return; }
  if (action === "copy") { newApplication(item); return; }
  view.dialogAction = action; view.dialogId = id; view.dialogVersion = item.version;
  let body = `<p>${esc(item.name)}<br>当前状态：${STATUS[item.status][0]} · 申请 V${item.revision}</p>`;
  let title = "确认办理"; let confirmLabel = "确认";
  const decisionTitles = { approve: ["同意活动申请", "同意并流转"], return: ["退回申请人补充", "确认退回"], reject: ["拒绝活动申请", "确认拒绝"], withdraw: ["撤回活动申请", "确认撤回"], "archive-return": ["退回活动档案", "确认退回"], "cancel-approve": ["同意取消活动", "确认取消活动"], "cancel-reject": ["拒绝取消申请", "恢复原流程"], "cancel-withdraw": ["撤销取消申请", "撤销并恢复"] };
  if (decisionTitles[action]) {
    [title, confirmLabel] = decisionTitles[action];
    const required = ["return", "reject", "archive-return", "cancel-reject"].includes(action);
    if (action === "withdraw") body += '<div class="notice warning">当前未完成审批任务将失效。重新提交将生成新版本，并从第一层重审。</div>';
    if (action.startsWith("cancel-")) body += `<div class="notice warning">取消原因：${esc(item.cancel.reason)}<br>原状态：${STATUS[item.cancel.previous][0]}</div>`;
    body += `<label class="field">${required ? "处理原因（至少 5 字）" : "补充意见（选填）"}<textarea id="dialog-comment" maxlength="500" placeholder="${required ? "请说明需要补充或拒绝的具体原因" : "可补充办理说明"}"></textarea></label>`;
  } else if (action === "assign") {
    title = "指派活动执行人"; confirmLabel = "确认指派";
    body += '<label class="field">主执行人<select id="dialog-executor"><option value="u-su">苏禾 · 教研执行</option></select></label><label class="field">执行安排<textarea id="dialog-instructions" maxlength="1000" placeholder="说明准备事项、协作安排和交付要求"></textarea></label>';
  } else if (action === "start") {
    title = "开始执行活动"; confirmLabel = "确认开始";
    body += `<div class="notice">计划开始：${formatTime(item.start)}<br>开始后记录实际开始时间，后续由你填写结果汇报。</div>`;
  } else if (action === "report") {
    title = "填写执行汇报"; confirmLabel = "提交执行结果";
    body += `<div class="form-grid"><label class="field">实际开始<input type="datetime-local" id="report-start" value="${esc(item.actualStart || item.start)}"></label><label class="field">实际结束<input type="datetime-local" id="report-end" value="${localDate(new Date())}"></label><label class="field">实到人数<input type="number" id="report-people" min="0" max="100000" step="1" value="${esc(item.people)}"></label><label class="field">实际支出参考（元，选填）<input id="report-spend" inputmode="decimal"></label></div><label class="field">执行总结（至少 10 字）<textarea id="report-summary" maxlength="3000"></textarea></label><label class="field">异常说明（0 人时必填）<textarea id="report-exception" maxlength="1000"></textarea></label>`;
  } else if (action === "archive-submit") {
    title = "提交活动档案"; confirmLabel = "提交档案审核";
    body += `<label class="field">成果摘要<textarea id="archive-summary" maxlength="2000">${esc(item.archive?.summary || "")}</textarea></label><label class="field">成果链接（HTTPS）<input id="archive-url" placeholder="https://" value="${esc(item.archive?.url || "")}"><small>原型以成果链接完成可用性演示；正式系统支持真实成果文件上传。</small></label><label class="field">成果文件（演示只记录名称）<input id="archive-files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"></label>`;
  } else if (action === "archive-approve") {
    title = "审核并归档"; confirmLabel = "确认归档";
    body += '<div class="notice">归档后活动与材料锁定，请确认以下检查项。</div><div class="check-list"><label><input type="checkbox" data-archive-check>执行汇报齐全</label><label><input type="checkbox" data-archive-check>成果材料可以访问</label><label><input type="checkbox" data-archive-check>人员和实际时间与记录一致</label></div><label class="field">归档意见（选填）<textarea id="dialog-comment" maxlength="500"></textarea></label>';
  } else if (action === "cancel-request") {
    title = "申请取消活动"; confirmLabel = "提交取消审批";
    body += '<div class="notice warning">取消由部门领导审批。在此期间执行操作冻结，拒绝或撤销取消后恢复原状态。</div><label class="field">取消原因（至少 5 字）<textarea id="dialog-comment" maxlength="500"></textarea></label>';
    if (item.status === "executing") body += '<label class="field">已发生费用的处置说明（至少 5 字）<textarea id="cancel-disposal" maxlength="1000" placeholder="如无费用，请写明尚未发生费用"></textarea></label>';
  }
  document.getElementById("dialog-content").innerHTML = dialogShell(title, body, confirmLabel);
  document.getElementById("action-dialog").showModal();
}

/**
 * 关闭业务弹窗并清除临时办理动作。
 */
function closeDialog() { const dialog = document.getElementById("action-dialog"); if (dialog.open) dialog.close(); view.dialogAction = ""; }

/**
 * 获取弹窗控件文本，缺少可选控件时返回空字符串。
 * @param {string} id 控件标识
 * @returns {string} 去除首尾空格的值
 */
function dialogValue(id) { return document.getElementById(id)?.value.trim() || ""; }

/**
 * 在弹窗内展示字段错误，保留用户填写的内容。
 * @param {string} message 需要用户修正的问题
 */
function dialogError(message) { const el = document.getElementById("dialog-error"); el.textContent = message; el.hidden = false; }

/**
 * 读取并校验演示文件元数据，上传失败或超限时不加入申请。
 * @param {FileList} fileList 用户选择的文件
 * @returns {object} 元数据列表与错误说明
 */
function readFiles(fileList) {
  const files = [];
  if (fileList.length > 10) return { files, error: "最多选择 10 个文件。" };
  for (const file of fileList) {
    if (!/\.(pdf|jpe?g|png|docx|xlsx)$/i.test(file.name)) return { files: [], error: `${file.name}：格式不支持。` };
    if (file.size > 20 * 1024 * 1024) return { files: [], error: `${file.name}：超过 20MB。` };
    files.push({ name: file.name, size: file.size });
  }
  return { files, error: "" };
}

/**
 * 确认弹窗业务动作，二次检查身份、状态和打开时的记录版本，再写入历史。
 */
function confirmDialog() {
  const action = view.dialogAction;
  if (action === "reset") { db = seedDatabase(); persist(); closeDialog(); view.page = view.role === "admin" ? "rules" : "home"; view.editing = null; view.filter = ""; view.query = ""; render(); showToast("已恢复全流程演示数据。"); return; }
  if (action === "early-submit") { const reason = dialogValue("dialog-comment"); if (reason.length < 5) { dialogError("请填写至少 5 字的临近申报说明。"); return; } completeSubmit(reason); return; }
  if (action === "leave-form") { closeDialog(); view.editing = null; navigate(view.leavePage); return; }
  if (action === "rule-publish") { publishRules(); return; }
  const item = findItem(view.dialogId);
  if (!allowed(item, action) || item.version !== view.dialogVersion) { dialogError("任务状态已变化或当前身份无权处理，请关闭后重新打开。"); return; }
  const comment = dialogValue("dialog-comment");
  if (["return", "reject", "archive-return", "cancel-request", "cancel-reject"].includes(action) && comment.length < 5) { dialogError("请填写至少 5 字的具体原因。"); return; }
  let title = ""; let note = comment;
  if (action === "approve") {
    title = item.flow[item.node].label + "同意"; item.node += 1;
    if (item.node >= item.flow.length) { item.status = "ready_assign"; note = `${comment} 审批全部完成，等待协调员指派。`.trim(); }
  } else if (action === "return") { item.status = "needs_info"; title = "退回补充"; }
  else if (action === "reject") { item.status = "rejected"; title = "拒绝活动申请"; }
  else if (action === "withdraw") { item.status = "withdrawn"; title = "撤回申请"; }
  else if (action === "assign") {
    const instructions = dialogValue("dialog-instructions");
    if (instructions.length < 5) { dialogError("请填写至少 5 字的执行安排。"); return; }
    item.executor = dialogValue("dialog-executor"); item.assignment = instructions; item.status = "ready_execute"; title = "指派执行人"; note = "主执行人：苏禾。" + instructions;
  } else if (action === "start") {
    if (new Date(item.start).getTime() > Date.now()) { dialogError(`计划开始时间为 ${formatTime(item.start)}，请到时开始。`); return; }
    item.status = "executing"; item.actualStart = localDate(new Date()); title = "开始执行"; note = "实际开始：" + formatTime(item.actualStart);
  } else if (action === "report") {
    const report = { start: dialogValue("report-start"), end: dialogValue("report-end"), people: dialogValue("report-people"), summary: dialogValue("report-summary"), spend: dialogValue("report-spend"), exception: dialogValue("report-exception"), submittedAt: localDate(new Date()) };
    if (!report.start || !report.end || new Date(report.end) < new Date(report.start)) { dialogError("实际结束时间不得早于开始时间。"); return; }
    if (new Date(report.end).getTime() > Date.now()) { dialogError("实际结束时间不可晚于当前时间。"); return; }
    if (!/^\d+$/.test(report.people) || Number(report.people) > 100000) { dialogError("实到人数需为 0—100000 的整数。"); return; }
    if (Number(report.people) === 0 && !report.exception) { dialogError("实到人数为零时请填写异常说明。"); return; }
    if (report.summary.length < 10) { dialogError("执行总结至少填写 10 字。"); return; }
    if (report.spend && !Number.isFinite(toFen(report.spend))) { dialogError("实际支出需为非负金额，最多两位小数。"); return; }
    item.report = report; item.status = "archive_draft"; title = "提交执行汇报"; note = `${report.people} 人参加。${report.summary}`;
  } else if (action === "archive-submit") {
    const url = dialogValue("archive-url"); const summary = dialogValue("archive-summary");
    const selected = readFiles(document.getElementById("archive-files").files);
    if (selected.error) { dialogError(selected.error); return; }
    if (summary.length < 10) { dialogError("成果摘要至少填写 10 字。"); return; }
    if (!url || !isHttps(url)) { dialogError("原型使用成果链接评审，请填写有效 HTTPS 链接；选中的文件仅记录名称。"); return; }
    const version = (item.archive?.version || 0) + 1;
    item.archive = { summary, url, files: selected.files, submittedBy: actor().id, version };
    item.status = "archive_review"; title = "提交档案 V" + version; note = summary;
  } else if (action === "archive-approve") {
    for (const check of document.querySelectorAll("[data-archive-check]")) if (!check.checked) { dialogError("请逐项确认全部归档检查项。"); return; }
    item.status = "archived"; item.archive.code = "DA-" + item.code.slice(3); title = "审核归档通过";
  } else if (action === "archive-return") {
    item.archiveAttempts.push({ ...clone(item.archive), result: "退回", comment }); item.status = "archive_draft"; title = "退回活动档案";
  } else if (action === "cancel-request") {
    const disposal = dialogValue("cancel-disposal");
    if (item.status === "executing" && disposal.length < 5) { dialogError("执行中取消需填写至少 5 字的已发生费用处置说明。"); return; }
    item.cancel = { previous: item.status, reason: comment, disposal, requester: actor().id }; item.status = "cancel_review"; title = "申请取消活动"; note = comment + (disposal ? " 费用处置：" + disposal : "");
  } else if (action === "cancel-approve") { item.status = "cancelled"; title = "批准取消活动"; }
  else if (action === "cancel-reject") { item.status = item.cancel.previous; title = "拒绝取消，恢复原流程"; }
  else if (action === "cancel-withdraw") { item.status = item.cancel.previous; title = "撤销取消，恢复原流程"; }
  if (!title) return;
  logAction(item, title, note); persist(); closeDialog(); render(); showToast(title + "，工单已更新。");
}

/**
 * 读取规则编辑控件到配置草案，已发布规则保持不变。
 * @returns {boolean} 是否通过阈值与时限校验
 */
function collectRule() {
  if (view.role !== "admin" || !document.getElementById("rule-extra")) return false;
  const thresholdFen = toFen(document.getElementById("rule-threshold").value);
  const reminderHours = Number(document.getElementById("rule-reminder").value);
  const escalationHours = Number(document.getElementById("rule-escalation").value);
  if (!Number.isFinite(thresholdFen) || thresholdFen <= 0) { showToast("阈值金额需大于零，至多两位小数。", true); return false; }
  if (!Number.isInteger(reminderHours) || reminderHours < 1 || !Number.isInteger(escalationHours) || escalationHours <= reminderHours || escalationHours > 720) { showToast("提醒需为正整数小时，升级晚于首次提醒且不超过 720 小时。", true); return false; }
  db.ruleDraft = { version: db.rule.version, extraEnabled: document.getElementById("rule-extra").checked, thresholdFen, reminderHours, escalationHours };
  return true;
}

/**
 * 发布新规则版本；原型仅替换全局已发布规则，不改写活动内已绑定的快照。
 */
function publishRules() {
  if (view.role !== "admin") { dialogError("当前身份无发布权限。"); return; }
  db.rule = { ...clone(db.ruleDraft), version: db.rule.version + 1 };
  db.ruleDraft = clone(db.rule); persist(); closeDialog(); render(); showToast(`规则 V${db.rule.version} 已发布，仅影响之后的新提交。`);
}

/**
 * 导航到主页面，避免从移动端意外进入配置编辑。
 * @param {string} page 目标页面名称
 */
function navigate(page) {
  view.page = page; view.query = ""; view.filter = ""; view.errors = []; view.revision = "current"; render();
}

/**
 * 跳转离开未保存的申请前展示明确选择，允许继续填写或放弃本次修改。
 * @param {string} page 放弃修改后的目标页面
 */
function leaveForm(page = "activities") {
  view.leavePage = page;
  view.dialogAction = "leave-form";
  document.getElementById("dialog-content").innerHTML = dialogShell("离开当前申请？", "<p>未保存的修改会丢弃。可以关闭此提示，先保存草稿再离开。</p>", "放弃修改并离开");
  document.getElementById("action-dialog").showModal();
}

/**
 * 处理页面动作分发，将所有业务变更交给二次鉴权的统一入口。
 * @param {MouseEvent} event 用户点击事件
 */
function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action; const id = button.dataset.id;
  if (action === "device") { view.device = id; render(); return; }
  if (action === "close-dialog") { closeDialog(); return; }
  if (action === "confirm-dialog") { confirmDialog(); return; }
  if (action === "reset") {
    view.dialogAction = "reset";
    document.getElementById("dialog-content").innerHTML = dialogShell("重置本地演示数据？", "<p>本次填写、审批和配置变更将被清除，恢复为准备好的全流程示例。</p>", "确认重置");
    document.getElementById("action-dialog").showModal(); return;
  }
  if (action === "nav") { if (view.page === "form") { leaveForm(id); return; } navigate(id); return; }
  if (action === "metric") { navigate(id); view.filter = button.dataset.filter || ""; render(); return; }
  if (action === "open") { if (!canRead(findItem(id))) { showToast("当前身份无访问权限。", true); return; } view.detail = id; view.page = "detail"; view.revision = "current"; render(); return; }
  if (action === "new") { newApplication(); return; }
  if (action === "leave-form") { leaveForm(); return; }
  if (action === "clear-filter") { view.query = ""; view.filter = ""; render(); return; }
  if (action === "save-draft") { const saved = saveDraft(); if (saved) { render(); showToast("已保存，草稿可继续填写。"); } return; }
  if (action === "next-step") { view.errors = validateApplication(view.editing, view.step); if (!view.errors.length) view.step += 1; render(); return; }
  if (action === "previous-step") { view.step -= 1; view.errors = []; render(); return; }
  if (action === "submit-form") { submitForm(); return; }
  if (action === "budget-add") { if (view.editing.budget.length >= 20) { showToast("演示最多添加 20 项费用。", true); return; } view.editing.budget.push({ category: "其他", amount: "0.00", note: "" }); render(); return; }
  if (action === "budget-remove") { if (view.editing.budget.length > 1) view.editing.budget.splice(Number(id), 1); render(); return; }
  if (action === "rule-save") { if (collectRule()) { persist(); showToast("配置草案已保存，尚未影响新提交。"); } return; }
  if (action === "rule-publish") {
    if (!collectRule()) return;
    view.dialogAction = "rule-publish";
    document.getElementById("dialog-content").innerHTML = dialogShell(`发布规则 V${db.rule.version + 1}？`, `<p>默认串行三层${db.ruleDraft.extraEnabled ? `，总预算达到 ${money(db.ruleDraft.thresholdFen)} 后追加院负责人` : "，金额分支关闭"}。<br>在途工单沿用原版本，之后新提交使用此规则。</p>`, "确认发布");
    document.getElementById("action-dialog").showModal(); return;
  }
  openAction(action, id);
}

/**
 * 同步申请字段、预算和搜索关键词，输入中不整体重绘避免丢失焦点。
 * @param {Event} event 输入事件
 */
function handleInput(event) {
  const target = event.target;
  if (target.id === "search-input") { view.query = target.value; refreshList(); return; }
  if (target.dataset.field && view.editing) view.editing[target.dataset.field] = target.value;
  if (target.dataset.budget && view.editing) {
    view.editing.budget[Number(target.dataset.index)][target.dataset.budget] = target.value;
    const total = budgetTotal(view.editing);
    document.getElementById("budget-total").textContent = Number.isFinite(total) ? money(total) : "金额待修正";
    document.getElementById("form-flow").innerHTML = flowChips(resolveFlow(view.editing, db.rule));
  }
  if (target.id === "preview-amount") document.getElementById("rule-preview").innerHTML = rulePreview(toFen(target.value));
}

/**
 * 处理选择控件、附件、演示身份和历史版本变化，并更新相关页面内容。
 * @param {Event} event 选择变化事件
 */
function handleChange(event) {
  const target = event.target;
  if (target.id === "role-select") {
    if (view.page === "form" && view.editing) { const saved = saveDraft(); if (!saved) { render(); return; } }
    closeDialog(); view.role = target.value; view.page = view.role === "admin" ? "rules" : "home"; view.editing = null; view.filter = ""; view.query = ""; render(); return;
  }
  if (target.id === "status-filter") { view.filter = target.value; refreshList(); return; }
  if (target.id === "revision-select") { view.revision = target.value; render(); return; }
  if (target.dataset.field && view.editing) { view.editing[target.dataset.field] = target.value; if (["mode", "service"].includes(target.dataset.field)) render(); }
  if (target.dataset.check && view.editing) {
    const name = target.dataset.check; const values = [];
    for (const check of document.querySelectorAll(`[data-check="${name}"]`)) if (check.checked) values.push(check.value);
    view.editing[name] = values;
  }
  if (target.dataset.budget && view.editing) view.editing.budget[Number(target.dataset.index)][target.dataset.budget] = target.value;
  if (target.id === "application-files") { const result = readFiles(target.files); if (result.error) { showToast(result.error, true); target.value = ""; return; } view.editing.files = result.files; render(); }
  if (["rule-extra", "rule-threshold", "rule-reminder", "rule-escalation"].includes(target.id) && collectRule()) document.getElementById("rule-preview").innerHTML = rulePreview(toFen(document.getElementById("preview-amount").value));
}

/**
 * 仅更新查询结果和计数，保留搜索输入框的光标位置。
 */
function refreshList() { const items = filteredItems(); document.getElementById("list-content").innerHTML = listContent(items); document.getElementById("result-count").textContent = `共 ${items.length} 项`; }

/**
 * 接收同源其他窗口写入，保留当前弹窗版本用于发现过期操作。
 * @param {StorageEvent} event 浏览器本地存储变更事件
 */
function handleStorage(event) {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const changed = JSON.parse(event.newValue);
    if (changed.schema !== 1 || !Array.isArray(changed.items)) return;
    db = changed;
    if (view.page !== "form") render();
    showToast("另一窗口更新了演示数据，当前任务办理时将重新检查版本。");
  } catch { showToast("其他窗口的数据更新读取失败，请重新打开页面。", true); }
}

document.addEventListener("click", handleClick);
document.addEventListener("input", handleInput);
document.addEventListener("change", handleChange);
window.addEventListener("storage", handleStorage);
render();
