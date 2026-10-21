"use strict";

const FLOW_STORE = "xingzhi-dynamic-flow-v2";
const SCENARIOS = {
  standard: ["标准办理", "三层审批后安排资源准备，全部开办条件满足后才能进入活动执行。"],
  sign: ["审批中加签", "部门初审后插入预算复核，分管院领导等待该加签完成，再继续原审批路线。"],
  parallel: ["审批与筹备并行", "部门初审后，教研、营销并行审核，协调员同时做低风险资源询期；开办门槛仍要求必要事项全部完成。"],
  execution: ["执行中追加任务", "活动已经开始，结果汇报前新增现场设备复核。新增必办任务接入原后继，完成后才能汇报。"]
};
const PHASES = ["活动申请", "审批确认", "资源筹备", "活动执行", "结果归档"];
const KINDS = { approval: "审批", task: "办理任务", notice: "知会", gate: "阶段门槛" };
let storageEnabled = true;
let saved = readStorage();
let mode = saved.mode || "parallel";
if (!SCENARIOS[mode]) mode = "parallel";
let graph = saved.scenes?.[mode] || createScenario(mode);
let selectedId = "department";
let messageTimer;

/**
 * 安全转义流程节点和办理说明中的 HTML 字符。
 * @param {unknown} value 原始内容
 * @returns {string} 可用于文本或属性的安全内容
 */
function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g,
    /**
     * 将特殊字符替换为 HTML 实体。
     * @param {string} char 单个待替换字符
     * @returns {string} 转义后的实体
     */
    function replaceCharacter(char) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]; });
}

/**
 * 克隆流程图，结构校验成功前不改写当前场景。
 * @param {object} value 可序列化的流程数据
 * @returns {object} 独立数据副本
 */
function copyGraph(value) { return JSON.parse(JSON.stringify(value)); }

/**
 * 构造单个流程实例节点。
 * @param {string} id 节点标识
 * @param {string} title 业务名称
 * @param {string} kind 节点类型
 * @param {number} phase 所属业务阶段序号
 * @param {string} owner 负责人
 * @param {Array<string>} deps 前置节点标识
 * @returns {object} 未完成的必办节点
 */
function makeNode(id, title, kind, phase, owner, deps) { return { id, title, kind, phase, owner, deps, status: "todo", mandatory: true, inserted: false }; }

/**
 * 生成四种业务场景的依赖图，保证开办与归档存在明确汇合点。
 * @param {string} key 场景标识
 * @returns {object} 包含节点、结构版本及调整历史的场景
 */
function createScenario(key) {
  const nodes = [
    makeNode("apply", "提交活动申请", "task", 0, "申请人", []),
    makeNode("department", "部门初审", "approval", 1, "部门领导", ["apply"]),
    makeNode("academic", "教研方案审核", "approval", 1, "分管院领导", ["department"]),
    makeNode("marketing", "营销与校方确认", "approval", 1, "营销负责人", ["academic"]),
    makeNode("assign", "协调与执行指派", "task", 2, "活动协调员", ["marketing"]),
    makeNode("venue", "场地与需求确认", "task", 2, "校方联系人", ["assign"]),
    makeNode("expert", "专家档期与资料准备", "task", 2, "活动安排人", ["assign"]),
    makeNode("start", "开办条件确认", "gate", 3, "活动执行人", ["marketing", "venue", "expert"]),
    makeNode("execute", "开展活动", "task", 3, "活动执行人", ["start"]),
    makeNode("report", "执行结果汇报", "task", 3, "活动执行人", ["execute"]),
    makeNode("archive", "成果整理与档案提交", "task", 4, "申请人", ["report"]),
    makeNode("review", "档案审核", "approval", 4, "归档审核人", ["archive"]),
    makeNode("finish", "活动归档完成", "gate", 4, "系统汇总", ["review"])
  ];
  nodes[0].status = "done";
  if (key === "sign") {
    nodes[1].status = "done";
    nodes[2].deps = ["budget-review"];
    const extra = makeNode("budget-review", "新增：预算复核", "approval", 1, "专项复核人", ["department"]);
    extra.inserted = true; nodes.splice(2, 0, extra);
  }
  if (key === "parallel") {
    nodes[1].status = "done";
    nodes[3].deps = ["department"];
    nodes[4].deps = ["department"];
    nodes[4].title = "协调与拟定执行安排";
    nodes[5].title = "场地询期与需求确认";
    nodes[6].title = "专家询期与资料准备";
    nodes[7].deps = ["academic", "marketing", "venue", "expert"];
  }
  if (key === "execution") {
    for (let index = 0; index <= 8; index += 1) nodes[index].status = "done";
    const extra = makeNode("onsite", "新增：现场设备复核", "task", 3, "现场协调人", ["execute"]);
    extra.inserted = true; nodes[9].deps = ["onsite"]; nodes.splice(9, 0, extra);
  }
  return { nodes, revision: 1, log: [] };
}

/**
 * 读取动态流程场景的本地保存内容，存储不可用时继续内存演示。
 * @returns {object} 已保存场景或空对象
 */
function readStorage() {
  try { const raw = localStorage.getItem(FLOW_STORE); if (raw) { const data = JSON.parse(raw); if (data.schema === 2) return data; } }
  catch { storageEnabled = false; }
  return { schema: 2, scenes: {} };
}

/**
 * 独立保存流程图场景，不触碰原活动工单的数据库。
 */
function saveScene() {
  saved.mode = mode; saved.schema = 2; saved.scenes ||= {}; saved.scenes[mode] = graph;
  try { localStorage.setItem(FLOW_STORE, JSON.stringify(saved)); }
  catch { storageEnabled = false; feedback("本地存储不可用，当前修改仅在本次页面内保留。", true); }
}

/**
 * 从指定场景获取节点。
 * @param {string} id 节点标识
 * @param {object} scene 目标场景，默认当前图
 * @returns {object|undefined} 匹配的节点
 */
function getNode(id, scene = graph) { for (const node of scene.nodes) if (node.id === id) return node; return undefined; }

/**
 * 根据前置完成情况计算节点是否可办理。
 * @param {object} node 待判断节点
 * @param {object} scene 所属场景
 * @returns {boolean} 是否已满足全部前置
 */
function ready(node, scene = graph) { if (node.status !== "todo") return false; for (const id of node.deps) if (getNode(id, scene)?.status !== "done") return false; return true; }

/**
 * 取得节点状态的文字与样式，计算结果不写回业务数据。
 * @param {object} node 节点
 * @returns {Array<string>} 状态标识与中文说明
 */
function stateOf(node) {
  if (node.status === "done") return ["done", "已完成"];
  if (node.status === "closed") return ["closed", "随归档关闭"];
  return ready(node) ? ["ready", "可办理"] : ["waiting", "等前置"];
}

/**
 * 获取依赖某一节点的直接后继。
 * @param {string} id 前置节点标识
 * @param {object} scene 目标流程
 * @returns {Array<object>} 直接后继列表
 */
function successors(id, scene = graph) { const result = []; for (const node of scene.nodes) if (node.deps.includes(id)) result.push(node); return result; }

/**
 * 检查重复标识、悬空依赖、循环和必办节点是否接回归档出口。
 * @param {object} scene 待校验流程图
 * @returns {string} 错误说明，合法时为空字符串
 */
function validateGraph(scene) {
  const ids = new Set(); const resolved = new Set();
  for (const node of scene.nodes) { if (ids.has(node.id)) return "存在重复环节标识。"; ids.add(node.id); if (!node.owner.trim()) return "环节缺少负责人。"; }
  if (!ids.has("start") || !ids.has("finish")) return "必须保留开办与归档门槛。";
  for (const node of scene.nodes) for (const id of node.deps) if (!ids.has(id)) return "存在找不到的前置环节。";
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of scene.nodes) {
      if (resolved.has(node.id)) continue;
      let all = true; for (const id of node.deps) if (!resolved.has(id)) all = false;
      if (all) { resolved.add(node.id); changed = true; }
    }
  }
  if (resolved.size !== ids.size) return "调整会形成循环依赖，请重新选择插入位置。";
  const reachesEnd = new Set(["finish"]); changed = true;
  while (changed) { changed = false; for (const node of scene.nodes) if (reachesEnd.has(node.id)) for (const id of node.deps) if (!reachesEnd.has(id)) { reachesEnd.add(id); changed = true; } }
  for (const node of scene.nodes) if (node.mandatory && !reachesEnd.has(node.id)) return "新增必办任务需要接回归档前的后继环节。";
  return "";
}

/**
 * 渲染五阶段流程、节点详情和调整记录，再请求绘制依赖连线。
 */
function renderFlow() {
  let tabs = "";
  for (const [key, labels] of Object.entries(SCENARIOS)) tabs += `<button data-action="scenario" data-id="${key}" aria-pressed="${key === mode}">${labels[0]}</button>`;
  document.getElementById("scenarios").innerHTML = tabs;
  document.getElementById("scenario-note").textContent = SCENARIOS[mode][1];
  document.getElementById("map-title").textContent = `单场活动流程 · 结构 R${graph.revision}`;
  let columns = "";
  for (let phase = 0; phase < PHASES.length; phase += 1) {
    columns += `<div class="phase-column"><div class="phase-head"><span>${phase + 1}</span>${PHASES[phase]}</div><div class="node-stack">`;
    for (const node of graph.nodes) {
      if (node.phase !== phase) continue;
      const [state, label] = stateOf(node);
      columns += `<button id="node-${node.id}" class="flow-node ${state} ${node.id === selectedId ? "selected" : ""} ${!node.mandatory ? "optional" : ""}" data-action="select" data-id="${node.id}" aria-pressed="${node.id === selectedId}">${node.inserted ? '<span class="inserted">动态新增</span>' : ""}<span class="kind">${KINDS[node.kind]}${node.mandatory ? " · 必办" : " · 非阻塞"}</span>${node.group ? `<span class="group-label">子流程：${escapeText(node.group)}</span>` : ""}<strong>${escapeText(node.title)}</strong><span class="node-foot"><span>${escapeText(node.owner)}</span><span class="node-status">${label}</span></span></button>`;
    }
    columns += "</div></div>";
  }
  document.getElementById("columns").innerHTML = columns;
  if (!getNode(selectedId)) selectedId = "department";
  renderInspector(); renderAudit();
  let active = 0; let complete = 0;
  for (const node of graph.nodes) { if (ready(node)) active += 1; if (node.status === "done") complete += 1; }
  document.getElementById("map-summary").textContent = `${graph.nodes.length} 个环节 · ${active} 个可办理 · ${complete} 个已完成${storageEnabled ? "" : " · 仅本次页面保存"}`;
  requestAnimationFrame(drawEdges);
}

/**
 * 输出依赖节点的可点击引用。
 * @param {Array<object>} nodes 前置或后继节点
 * @returns {string} 引用按钮或无依赖提示
 */
function references(nodes) { let html = ""; for (const node of nodes) html += `<button class="dependency" data-action="select" data-id="${node.id}">${escapeText(node.title)}</button>`; return html || "无"; }

/**
 * 渲染当前环节的前置、后继、责任人与模拟操作。
 */
function renderInspector() {
  const node = getNode(selectedId); const [state, label] = stateOf(node);
  const deps = []; for (const id of node.deps) deps.push(getNode(id));
  let pending = 0; for (const dep of deps) if (dep.status !== "done") pending += 1;
  document.getElementById("inspector").innerHTML = `<div class="kind-label">${KINDS[node.kind]} / ${PHASES[node.phase]}</div><h2>${escapeText(node.title)}</h2><p class="node-state">${label}${state === "waiting" ? ` · 还有 ${pending} 项前置未完成` : ""}</p><dl><div><dt>负责人</dt><dd>${escapeText(node.owner)}</dd></div><div><dt>后续影响</dt><dd>${node.mandatory ? "必办，后继需等待" : "协作知会，不阻塞"}</dd></div><div><dt>前置条件</dt><dd>${references(deps)}</dd></div><div><dt>接回的后继</dt><dd>${references(successors(node.id))}</dd></div></dl><div class="actions"><button class="primary" data-action="complete" data-id="${node.id}" ${ready(node) ? "" : "disabled"}>模拟完成此环节</button><button data-action="add" ${getNode("finish").status === "done" ? "disabled" : ""}>在此处新增环节</button></div><p class="hint">${node.kind === "gate" ? "阶段门槛须等待所有必要前置完成。" : "必办的前加签会暂停本环节；并行新增会在后继汇合。"}已完成环节保留原记录。</p>`;
}

/**
 * 根据实际卡片位置绘制依赖线，桌面使用横向阶段，窄屏使用纵向阶段。
 */
function drawEdges() {
  const canvas = document.getElementById("canvas"); const svg = document.getElementById("edges");
  const root = canvas.getBoundingClientRect(); if (!root.width) return;
  const width = Math.ceil(root.width); const height = Math.ceil(root.height);
  svg.setAttribute("width", width); svg.setAttribute("height", height); svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const vertical = window.innerWidth <= 600;
  let paths = '<defs><marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L6 3 L0 6Z" fill="#a8b8ce"/></marker></defs>';
  for (const node of graph.nodes) {
    const target = document.getElementById("node-" + node.id)?.getBoundingClientRect(); if (!target) continue;
    for (const id of node.deps) {
      const from = getNode(id); const source = document.getElementById("node-" + id)?.getBoundingClientRect(); if (!source) continue;
      let path;
      if (vertical || from.phase === node.phase) {
        const sx = source.right - root.left - 15; const sy = source.bottom - root.top; const tx = target.right - root.left - 15; const ty = target.top - root.top;
        if (ty - sy < 70 && ty > sy) path = `M${sx} ${sy} C${sx} ${sy + 12} ${tx} ${ty - 12} ${tx} ${ty}`;
        else { const rail = Math.max(source.right, target.right) - root.left + 11; path = `M${source.right - root.left} ${source.top - root.top + source.height / 2} C${rail} ${source.top - root.top + source.height / 2} ${rail} ${target.top - root.top + target.height / 2} ${target.right - root.left} ${target.top - root.top + target.height / 2}`; }
      } else {
        const sx = source.right - root.left; const sy = source.top - root.top + source.height / 2; const tx = target.left - root.left; const ty = target.top - root.top + target.height / 2; const bend = Math.max(18, (tx - sx) / 2);
        path = `M${sx} ${sy} C${sx + bend} ${sy} ${tx - bend} ${ty} ${tx} ${ty}`;
      }
      paths += `<path class="edge ${from.status === "done" ? "complete" : ""} ${!node.mandatory ? "optional" : ""}" d="${path}" marker-end="url(#arrow)"/>`;
    }
  }
  svg.innerHTML = paths;
}

/**
 * 追加场景办理记录，结构变更与任务完成使用不同标题。
 * @param {string} title 操作标题
 * @param {string} reason 原因或说明
 */
function appendLog(title, reason) { graph.log.push({ title, reason, time: new Date().toLocaleString("zh-CN", { hour12: false }) }); }

/**
 * 输出按最新优先排列的结构调整与办理记录。
 */
function renderAudit() {
  let html = "";
  for (const entry of [...graph.log].reverse()) html += `<div class="audit-row"><time>${escapeText(entry.time)}</time><div><strong>${escapeText(entry.title)}</strong><p>${escapeText(entry.reason)}</p></div></div>`;
  document.getElementById("audit-list").innerHTML = html || '<p class="audit-empty">当前是预置流程示例；新增或模拟办理后，记录会显示在这里。</p>';
}

/**
 * 模拟完成一个已满足前置的环节，归档时关闭尚未完成的非阻塞任务。
 * @param {string} id 待完成节点标识
 */
function completeNode(id) {
  const node = getNode(id);
  if (!node || !ready(node)) { feedback("请先完成本环节的所有前置。", true); return; }
  node.status = "done"; let suffix = "";
  if (id === "finish") {
    let count = 0; for (const item of graph.nodes) if (!item.mandatory && item.status === "todo") { item.status = "closed"; count += 1; }
    if (count) suffix = `；${count} 项未完成的非阻塞任务随归档关闭。`;
  }
  appendLog("模拟完成：" + node.title, node.owner + "办理。后继按依赖自动激活" + suffix); saveScene(); renderFlow(); feedback("环节已完成，后继任务已重新计算。" + suffix);
}

/**
 * 打开插入环节表单，默认围绕当前选中的环节调整。
 */
function openInsert() {
  if (getNode("finish").status === "done") { feedback("已归档场景保持只读，可恢复场景重新体验。", true); return; }
  const form = document.getElementById("insert-form"); form.reset();
  let options = "";
  for (const node of graph.nodes) options += `<option value="${node.id}" ${node.id === selectedId ? "selected" : ""}>${escapeText(node.title)} · ${stateOf(node)[1]}</option>`;
  document.getElementById("anchor-select").innerHTML = options;
  if (getNode(selectedId).status === "done") form.elements.position.value = "after";
  document.getElementById("insert-error").hidden = true; refreshInsertHint(); document.getElementById("insert-dialog").showModal();
}

/**
 * 更新插入位置的影响提示，审批与子流程固定必办，知会固定非阻塞。
 */
function refreshInsertHint() {
  const form = document.getElementById("insert-form");
  const notice = form.elements.kind.value === "notice";
  const required = ["approval", "subflow"].includes(form.elements.kind.value);
  if (notice) form.elements.blocking.value = "optional";
  if (required) form.elements.blocking.value = "required";
  form.elements.blocking.disabled = notice || required;
  const nonblocking = form.elements.blocking.value === "optional";
  const tips = { before: "当前环节将等待新增任务完成，原前置改为连接新增任务。", after: "新增任务等待当前环节完成，再激活原后继。", parallel: "新增任务与当前环节共享前置，二者全部完成后才激活后继。" };
  document.getElementById("insert-hint").textContent = nonblocking ? "非阻塞项保留自己的触发条件，不修改必办后继；归档时对未完成协作项作关闭记录。" : tips[form.elements.position.value];
}

/**
 * 在副本中插入单环节或两步子流程，必办环节重接后继依赖，校验通过才返回。
 * @param {object} config 名称、类型、负责人、锚点、位置、阻塞方式与原因
 * @returns {object} 含新图与新节点标识的结果，失败时包含 error
 */
function insertNodes(config) {
  const name = String(config.name || "").trim(); const owner = String(config.owner || "").trim(); const reason = String(config.reason || "").trim();
  if (name.length < 2 || owner.length < 2 || reason.length < 5) return { error: "名称和负责人至少 2 字，调整原因至少 5 字。" };
  if (!["approval", "task", "notice", "subflow"].includes(config.kind) || !["before", "after", "parallel"].includes(config.position) || !["required", "optional"].includes(config.blocking)) return { error: "插入类型或位置无效。" };
  if (getNode("finish").status === "done") return { error: "归档后的场景不再调整。" };
  const next = copyGraph(graph); const anchor = getNode(config.anchor, next);
  if (!anchor) return { error: "请选择有效的关联环节。" };
  if (config.position === "before" && anchor.status !== "todo") return { error: "已完成环节不能前插任务，请选择未完成环节。" };
  if (anchor.id === "finish" && config.position !== "before") return { error: "新增环节需要放在归档完成之前。" };
  const blocking = ["approval", "subflow"].includes(config.kind) || (config.kind === "task" && config.blocking === "required");
  const children = successors(anchor.id, next); const mutable = [];
  for (const child of children) if (child.status === "todo") mutable.push(child);
  if (blocking && config.position !== "before" && !mutable.length) return { error: "此处后继已完成，请选择未完成后继之前的位置。" };
  const id = "extra-" + Date.now() + "-" + next.revision;
  const initialDeps = config.position === "after" ? [anchor.id] : [...anchor.deps];
  const inserted = makeNode(id, name, config.kind === "subflow" ? "task" : config.kind, anchor.phase, owner, initialDeps);
  inserted.inserted = true; inserted.mandatory = blocking;
  const additions = [inserted];
  if (config.kind === "subflow") {
    inserted.title = "资料补充"; inserted.group = name;
    const review = makeNode(id + "-review", "专项审核", "approval", anchor.phase, "专项审核人", [id]);
    review.inserted = true; review.mandatory = blocking; review.group = name; additions.push(review);
  }
  const tail = additions[additions.length - 1].id;
  if (blocking) {
    if (config.position === "before") anchor.deps = [tail];
    else for (const child of mutable) {
      const deps = [];
      for (const dep of child.deps) deps.push(dep === anchor.id && config.position === "after" ? tail : dep);
      if (config.position === "parallel") deps.push(tail);
      child.deps = [...new Set(deps)];
    }
  }
  let index = next.nodes.indexOf(anchor); if (config.position !== "before") index += 1;
  next.nodes.splice(index, 0, ...additions); next.revision += 1;
  const error = validateGraph(next); if (error) return { error };
  return { next, id, name, reason, anchor: anchor.title, blocking, position: config.position, count: additions.length };
}

/**
 * 提交新增环节，保留校验失败时的表单内容，成功后记录结构版本。
 * @param {SubmitEvent} event 新增表单提交事件
 */
function handleInsert(event) {
  event.preventDefault();
  const form = document.getElementById("insert-form"); const data = new FormData(form);
  const config = Object.fromEntries(data.entries()); if (config.kind === "notice") config.blocking = "optional";
  if (["approval", "subflow"].includes(config.kind)) config.blocking = "required";
  const result = insertNodes(config);
  if (result.error) { const error = document.getElementById("insert-error"); error.textContent = result.error; error.hidden = false; return; }
  graph = result.next; selectedId = result.id;
  appendLog(`结构 R${graph.revision}：新增${result.count > 1 ? "子流程" : "环节"}「${result.name}」`, `围绕「${result.anchor}」${{ before: "前插", after: "后插", parallel: "并行" }[result.position]}，${result.blocking ? "必办并接回后继" : "非阻塞协作"}。原因：${result.reason}`);
  saveScene(); document.getElementById("insert-dialog").close(); renderFlow(); feedback("已加入当前活动的流程，依赖已更新。");
}

/**
 * 显示短暂的办理结果或错误反馈。
 * @param {string} message 反馈文本
 * @param {boolean} error 是否为错误
 */
function feedback(message, error = false) {
  const node = document.getElementById("feedback"); node.textContent = message; node.classList.toggle("error", error); node.hidden = false; clearTimeout(messageTimer);
  messageTimer = setTimeout(/** 隐藏已经展示的流程操作提示，无返回值。 */ function hideFeedback() { node.hidden = true; }, 5000);
}

/**
 * 处理场景选择、节点查看、新增、模拟完成与场景恢复。
 * @param {MouseEvent} event 用户点击事件
 */
function handleFlowClick(event) {
  const button = event.target.closest("[data-action]"); if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "select") { selectedId = button.dataset.id; renderFlow(); }
  if (action === "scenario") { saveScene(); mode = button.dataset.id; graph = saved.scenes[mode] || createScenario(mode); selectedId = mode === "execution" ? "onsite" : mode === "sign" ? "budget-review" : "department"; saveScene(); renderFlow(); }
  if (action === "complete") completeNode(button.dataset.id);
  if (action === "add") openInsert();
  if (action === "close") document.getElementById("insert-dialog").close();
  if (action === "reset") { if (!window.confirm("恢复当前场景？本场景新增环节和模拟办理记录会清除。")) return; graph = createScenario(mode); selectedId = mode === "execution" ? "onsite" : "department"; saveScene(); renderFlow(); }
}

/**
 * 在页面尺寸变化后重画依赖线，节点及业务状态保持不变。
 */
function handleFlowResize() { requestAnimationFrame(drawEdges); }

document.addEventListener("click", handleFlowClick);
document.getElementById("insert-form").addEventListener("submit", handleInsert);
document.getElementById("insert-form").addEventListener("change", refreshInsertHint);
window.addEventListener("resize", handleFlowResize);
if (typeof ResizeObserver !== "undefined") new ResizeObserver(handleFlowResize).observe(document.getElementById("columns"));
renderFlow();
