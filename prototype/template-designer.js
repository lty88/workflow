'use strict';

const STORAGE_KEY = 'workflow-template-review-v04';
const PEOPLE = {
  manager: '申请人部门负责人', academic: '周岚 · 教研审核', marketing: '赵明 · 营销审核',
  director: '刘文 · 院负责人', coordinator: '王舟 · 流程负责人', executor: '苏禾 · 任务执行',
};
let state;
let currentId = '';
let selectedId = '';
let graph = null;
let rendering = false;
let queued = false;
let observer;
let toastTimer;
let lastPreview = null;

/**
 * 读取指定页面元素，缺失时指出原型结构问题。
 * @param {string} id 元素标识
 * @returns {HTMLElement} 页面元素
 */
function byId(id) {
  const target = document.getElementById(id);
  if (!target) throw new Error(`页面元素缺失：${id}`);
  return target;
}

/**
 * 创建只使用文本内容的元素，避免把模板名称作为HTML执行。
 * @param {string} tag HTML标签
 * @param {string} text 可见文本
 * @param {string} className 可选样式类
 * @returns {HTMLElement} 新元素
 */
function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

/**
 * 生成原型专用标识，不与服务端工单编号混用。
 * @param {string} prefix 标识前缀
 * @returns {string} 唯一标识
 */
function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * 复制模板定义，隔离草稿、已发布版本和活动实例。
 * @param {object} value 待复制对象
 * @returns {object} 独立对象
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 创建演示审批节点。
 * @param {string} id 节点标识
 * @param {string} label 节点名称
 * @param {string} owner 受理规则
 * @param {string[]} deps 前置标识
 * @param {string} kind 节点类型
 * @returns {object} 节点定义
 */
function node(id, label, owner, deps = [], kind = 'approval') {
  return { id, label, owner, deps, kind, threshold: null, protected: id === 'department' };
}

/**
 * 生成4套相互独立的常用模板与空实例列表。
 * @returns {object} 原型初始状态
 */
function seed() {
  const department = node('department', '部门初审', 'manager');
  const academic = node('academic', '教研方案审核', 'academic', ['department']);
  const marketing = node('marketing', '营销与校方确认', 'marketing', ['department']);
  const director = node('director', '院负责人复核', 'director', ['academic', 'marketing']);
  const standard = [department, academic, marketing, { ...director, threshold: 10000 }];
  const definitions = [
    ['standard', '标准教研活动', '教研交流', standard],
    ['online', '线上公益研讨', '线上研讨', [department, academic]],
    ['paid', '收费培训', '收费培训', [department, academic, marketing, director]],
    ['internal', '内部分享', '内部分享', [department, node('materials', '分享资料准备', 'coordinator', ['department'], 'task')]],
  ];
  const templates = [];
  for (const [id, name, type, nodes] of definitions) {
    const definition = { name, type, departments: ['教研一部', '教研二部'], nodes: clone(nodes) };
    templates.push({ id, active: true, currentVersion: 1, dirty: false, draft: clone(definition), releases: [{ version: 1, definition: clone(definition) }] });
  }
  return { templates, instances: [] };
}

/** 将当前原型状态保存到浏览器；失败时保留内存状态并提示。 */
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (error) { toast('浏览器禁止本地存储，当前改动仅在本页打开期间保留。'); }
}

/**
 * 展示短暂的操作结果。
 * @param {string} message 提示文本
 */
function toast(message) {
  byId('toast').textContent = message;
  byId('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

/** 隐藏操作结果提示。 */
function hideToast() { byId('toast').hidden = true; }

/**
 * 将图形或交互异常展示给评审人员。
 * @param {unknown} error 捕获到的异常
 */
function reportError(error) {
  toast(error instanceof Error ? error.message : '原型操作失败，请重试。');
}

/**
 * 查找当前设计中的模板。
 * @returns {object} 当前模板
 */
function current() {
  for (const template of state.templates) if (template.id === currentId) return template;
  throw new Error('未选择模板');
}

/**
 * 读取模板当前发布定义；无发布版本返回空。
 * @param {object} template 模板
 * @returns {object|null} 发布版本
 */
function release(template) {
  for (const item of template.releases) if (item.version === template.currentVersion) return item;
  return null;
}

/**
 * 检查依赖并得到拓扑顺序。
 * @param {object[]} nodes 节点定义
 * @returns {object[]} 合法的拓扑节点顺序
 */
function topological(nodes) {
  const ids = new Set();
  for (const item of nodes) {
    if (ids.has(item.id)) throw new Error('节点标识重复');
    ids.add(item.id);
  }
  for (const item of nodes) for (const dep of item.deps) if (!ids.has(dep)) throw new Error(`${item.label}缺少前置节点`);
  const order = [];
  const visited = new Set();
  while (order.length < nodes.length) {
    let changed = false;
    for (const item of nodes) {
      if (visited.has(item.id)) continue;
      let ready = true;
      for (const dep of item.deps) if (!visited.has(dep)) ready = false;
      if (!ready) continue;
      visited.add(item.id);
      order.push(item);
      changed = true;
    }
    if (!changed) throw new Error('节点依赖形成环路，请修正前置节点');
  }
  return order;
}

/**
 * 校验发布所需的模板结构与示例角色资格。
 * @param {object} definition 草稿定义
 * @returns {object[]} 排序后的节点
 */
function validate(definition) {
  if (definition.name.trim().length < 2) throw new Error('模板名称至少2个字');
  const order = topological(definition.nodes);
  let protectedCount = 0;
  for (const item of order) {
    if (item.label.trim().length < 2) throw new Error('节点名称至少2个字');
    if (!PEOPLE[item.owner]) throw new Error(`${item.label}未配置受理人`);
    if (item.kind === 'approval' && ['executor', 'coordinator'].includes(item.owner)) throw new Error(`${item.label}受理人没有审批权限`);
    if (item.kind === 'task' && !['coordinator', 'executor'].includes(item.owner)) throw new Error(`${item.label}受理人没有任务办理权限`);
    if (item.threshold !== null && (!Number.isFinite(item.threshold) || item.threshold < 0)) throw new Error(`${item.label}预算阈值无效`);
    if (item.protected && item.kind === 'approval' && item.owner === 'manager' && item.threshold === null) protectedCount++;
  }
  if (!protectedCount) throw new Error('必须保留无条件的部门初审节点');
  return order;
}

/**
 * 切换页面，刷新模板库或申请选择并更新画布。
 * @param {string} view 页面标识
 */
function showView(view) {
  for (const name of ['library', 'designer', 'application', 'instances']) byId(name).hidden = name !== view;
  if (view === 'library') renderLibrary();
  if (view === 'application') renderApplication();
  if (view === 'instances') renderInstances();
  if (view === 'designer') void refreshGraph();
}

/**
 * 创建带委托操作的按钮。
 * @param {string} text 按钮文案
 * @param {string} action 操作名
 * @param {string} id 模板标识
 * @returns {HTMLButtonElement} 按钮
 */
function actionButton(text, action, id) {
  const button = element('button', text);
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

/** 根据类型和部门筛选，渲染已发布信息与草稿标记。 */
function renderLibrary() {
  const cards = byId('template-cards');
  cards.replaceChildren();
  for (const template of state.templates) {
    const published = release(template);
    const def = published ? published.definition : template.draft;
    if (byId('filter-type').value && def.type !== byId('filter-type').value) continue;
    if (byId('filter-department').value && !def.departments.includes(byId('filter-department').value)) continue;
    const card = element('article', '', 'card');
    card.append(element('h2', def.name));
    const badges = element('div', '', 'badges');
    badges.append(element('span', def.type, 'badge'), element('span', published ? `已发布 V${template.currentVersion}` : '未发布', 'badge'));
    if (template.id === 'standard') badges.append(element('span', '默认模板', 'badge'));
    if (template.dirty) badges.append(element('span', '有草稿', 'badge draft'));
    if (!template.active) badges.append(element('span', '已停用', 'badge off'));
    card.append(badges, element('p', `可用部门：${def.departments.join('、')}`, 'muted'));
    const labels = [];
    for (const item of def.nodes) labels.push(item.label + (item.threshold !== null ? `（≥${item.threshold}元）` : ''));
    card.append(element('div', labels.join(' · '), 'route'));
    const actions = element('div', '', 'actions');
    actions.append(actionButton('设计模板', 'edit', template.id), actionButton('复制', 'copy', template.id), actionButton(template.active ? '停用' : '启用', 'toggle', template.id));
    card.append(actions);
    cards.append(card);
  }
  if (!cards.childElementCount) cards.append(element('p', '该筛选条件下没有模板。'));
}

/**
 * 打开草稿设计器并恢复属性表单。
 * @param {string} id 模板标识
 */
function editTemplate(id) {
  currentId = id;
  const template = current();
  byId('designer-title').textContent = template.draft.name;
  byId('version-label').textContent = `当前发布 ${template.currentVersion ? `V${template.currentVersion}` : '无'} · 编辑草稿，发布后用于后续申请`;
  byId('template-name').value = template.draft.name;
  byId('template-type').value = template.draft.type;
  byId('template-department').value = template.draft.departments.length === 2 ? 'all' : template.draft.departments[0];
  selectedId = template.draft.nodes[0]?.id || '';
  fillInspector();
  byId('simulation-result').replaceChildren();
  showView('designer');
}

/** 将元信息写入当前内存草稿，发布版本保持独立。 */
function syncMetadata() {
  const template = current();
  template.draft.name = byId('template-name').value.trim();
  template.draft.type = byId('template-type').value;
  template.draft.departments = byId('template-department').value === 'all' ? ['教研一部', '教研二部'] : [byId('template-department').value];
  template.dirty = true;
}

/** 保存浏览器草稿，保留未完成的设计。 */
function saveDraft() {
  syncMetadata();
  persist();
  toast('草稿已保存在当前浏览器，申请人仍使用已发布版本。');
}

/** 验证结构后发布不可变新版本，并保存到浏览器。 */
function publish() {
  syncMetadata();
  validate(current().draft);
  const template = current();
  template.currentVersion++;
  template.releases.push({ version: template.currentVersion, definition: clone(template.draft) });
  template.dirty = false;
  persist();
  byId('version-label').textContent = `已发布 V${template.currentVersion} · 已提交活动继续使用原快照`;
  toast(`已发布 V${template.currentVersion}。新申请可用，旧活动不变。`);
}

/**
 * 构建G6展示数据，依赖关系与展示位置分开处理。
 * @returns {object} 图节点和边
 */
function graphData() {
  const nodes = [];
  const edges = [];
  for (const item of current().draft.nodes) {
    const color = item.kind === 'approval' ? '#4d70d9' : item.kind === 'task' ? '#27a57c' : '#c89326';
    nodes.push({ id: item.id, style: { labelText: `${item.label}\n${PEOPLE[item.owner]}${item.threshold !== null ? `\n预算 ≥ ${item.threshold}元` : ''}`, fill: selectedId === item.id ? '#edf2ff' : '#ffffff', stroke: color, lineWidth: selectedId === item.id ? 3 : 1.5 } });
    for (const dep of item.deps) edges.push({ id: `${dep}--${item.id}`, source: dep, target: item.id });
  }
  return { nodes, edges };
}

/** 串行重绘G6画布，兼容全屏尺寸变化和快速编辑。 */
async function refreshGraph() {
  queued = true;
  if (rendering || byId('designer').hidden) return;
  rendering = true;
  try {
    while (queued && !byId('designer').hidden) {
      queued = false;
      const container = byId('graph');
      if (!globalThis.G6?.Graph) throw new Error('未加载G6本地依赖，请先按项目说明安装依赖，再打开原型。');
      if (!graph) {
        graph = new G6.Graph({ container, width: container.clientWidth, height: container.clientHeight, padding: 32, animation: false, zoomRange: [0.2, 2.5], layout: { type: 'dagre', rankdir: 'TB', nodesep: 36, ranksep: 48 }, behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'], node: { type: 'rect', style: { size: [230, 88], radius: 10, labelPlacement: 'center', labelFontSize: 14, labelLineHeight: 21, labelFill: '#25364e', labelWordWrap: true, labelMaxWidth: 212, labelMaxLines: 3, cursor: 'pointer' } }, edge: { type: 'polyline', style: { endArrow: true, lineWidth: 1.5, stroke: '#93a8d5', radius: 8 } } });
        graph.on('node:click', selectGraphNode);
        graph.on('aftertransform', syncZoom);
      }
      graph.resize(container.clientWidth, container.clientHeight);
      graph.setData(graphData());
      await graph.render();
      await fitGraph();
      byId('graph-error').hidden = true;
    }
  } catch (error) {
    byId('graph-error').hidden = false;
    byId('graph-error').textContent = error.message;
  } finally { rendering = false; }
}

/**
 * 从G6节点点击中选择属性对象。
 * @param {object} event G6节点事件
 */
function selectGraphNode(event) {
  if (!event.target?.id) return;
  selectedId = event.target.id;
  fillInspector();
  void refreshGraph();
}

/** 根据当前节点填充属性与依赖选项。 */
function fillInspector() {
  let selected;
  for (const item of current().draft.nodes) if (item.id === selectedId) selected = item;
  byId('node-form').hidden = !selected;
  byId('empty-node').hidden = Boolean(selected);
  if (!selected) return;
  byId('node-label').value = selected.label;
  byId('node-kind').value = selected.kind;
  byId('node-kind').disabled = selected.protected;
  byId('node-owner').value = selected.owner;
  byId('node-owner').disabled = selected.protected;
  byId('node-condition').value = selected.threshold === null ? 'always' : 'budget';
  byId('node-condition').disabled = selected.protected;
  byId('node-threshold').value = selected.threshold ?? 10000;
  byId('threshold-label').hidden = selected.threshold === null;
  byId('delete-node').disabled = selected.protected;
  byId('protected-hint').textContent = selected.protected ? '必要部门审核：保留负责人规则，始终进入。' : '保存属性前会检查环路；多个前置全部完成后才进入。';
  const deps = byId('node-deps');
  deps.replaceChildren();
  for (const item of current().draft.nodes) {
    if (item.id === selectedId) continue;
    const label = element('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.value = item.id; input.checked = selected.deps.includes(item.id);
    label.append(input, document.createTextNode(item.label)); deps.append(label);
  }
  if (!deps.childElementCount) deps.append(element('p', '无其他节点，提交后直接进入。'));
}

/**
 * 应用节点属性，环路时恢复原草稿。
 * @param {SubmitEvent} event 表单提交事件
 */
function applyNode(event) {
  event.preventDefault();
  const candidate = clone(current().draft);
  for (const item of candidate.nodes) {
    if (item.id !== selectedId) continue;
    item.label = byId('node-label').value.trim();
    item.kind = byId('node-kind').value;
    item.owner = byId('node-owner').value;
    item.threshold = byId('node-condition').value === 'budget' ? Number(byId('node-threshold').value) : null;
    item.deps = [];
    for (const checkbox of byId('node-deps').querySelectorAll('input:checked')) item.deps.push(checkbox.value);
  }
  validate(candidate);
  current().draft = candidate;
  current().dirty = true;
  void refreshGraph();
  toast('节点属性已应用，请保存草稿或发布。');
}

/**
 * 在参考节点前后或并行接入新节点，正确重接后继依赖。
 * @param {string} kind 审批、任务或知会
 * @param {string} position 接入方向
 */
function insert(kind, position) {
  if (!['approval', 'task', 'notice'].includes(kind)) return;
  const definition = current().draft;
  let anchor;
  for (const item of definition.nodes) if (item.id === selectedId) anchor = item;
  if (!anchor) throw new Error('请先选择参考节点');
  const labels = { approval: '新增专项审核', task: '新增协作任务', notice: '新增流程知会' };
  const added = node(newId('node'), labels[kind], kind === 'approval' ? 'academic' : 'coordinator', position === 'after' ? [anchor.id] : [...anchor.deps], kind);
  for (const child of definition.nodes) {
    if (child.id === anchor.id || !child.deps.includes(anchor.id)) continue;
    if (position === 'after') {
      const deps = [];
      for (const id of child.deps) deps.push(id === anchor.id ? added.id : id);
      child.deps = deps;
    } else if (position === 'parallel') child.deps.push(added.id);
  }
  if (position === 'before') anchor.deps = [added.id];
  definition.nodes.push(added);
  current().dirty = true;
  selectedId = added.id;
  fillInspector();
  void refreshGraph();
  toast('已接入新节点，请核对右侧受理人和前置关系。');
}

/** 删除可选节点并让其后继继承原前置。 */
function deleteNode() {
  const definition = current().draft;
  let selected;
  for (const item of definition.nodes) if (item.id === selectedId) selected = item;
  if (!selected || selected.protected) return;
  const kept = [];
  for (const item of definition.nodes) {
    if (item.id === selected.id) continue;
    const deps = [];
    for (const id of item.deps) deps.push(...(id === selected.id ? selected.deps : [id]));
    item.deps = [...new Set(deps)]; kept.push(item);
  }
  definition.nodes = kept;
  current().dirty = true;
  selectedId = kept[0]?.id || '';
  fillInspector(); void refreshGraph();
}

/**
 * 生成条件路线演示，跳过节点不创建受理待办。
 * @param {object} definition 模板定义
 * @param {string} applicant 申请人账号
 * @param {number} budget 预算金额
 * @returns {object[]} 冻结的路线摘要
 */
function route(definition, applicant, budget) {
  const result = [];
  for (const item of validate(definition)) {
    const skipped = item.threshold !== null && budget < item.threshold;
    result.push({ label: item.label, kind: item.kind, skipped, owner: skipped ? '不生成待办' : item.owner === 'manager' ? (applicant === 'qiaoan' ? '杜云' : '陈宁') : PEOPLE[item.owner], deps: clone(item.deps), threshold: item.threshold });
  }
  return result;
}

/**
 * 渲染路线摘要，保留跳过原因和节点类型。
 * @param {HTMLElement} container 容器
 * @param {object[]} rows 路线摘要
 */
function renderRoute(container, rows) {
  container.replaceChildren();
  for (const item of rows) {
    const block = element('div', item.label, `route-step${item.skipped ? ' skip' : ''}`);
    const kind = { approval: '审批', task: '任务', notice: '知会·不阻断' }[item.kind];
    block.append(element('small', item.skipped ? `跳过：预算未达到${item.threshold}元` : `${kind} · ${item.owner}`));
    container.append(block);
  }
}

/** 根据草稿、申请人与预算演算条件路线。 */
function simulate() {
  syncMetadata();
  renderRoute(byId('simulation-result'), route(current().draft, byId('simulate-applicant').value, amount('simulate-budget')));
}

/**
 * 校验页面金额，拒绝空值、负数与小数位超限。
 * @param {string} id 金额输入元素
 * @returns {number} 有效金额
 */
function amount(id) {
  const value = byId(id).value;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('请填写非负且最多两位小数的预算');
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('预算金额无效');
  return number;
}

/** 刷新新建活动可选模板，按已发布类型与部门过滤。 */
function renderApplication() {
  const select = byId('activity-template');
  const previous = select.value;
  const department = byId('applicant').value === 'qiaoan' ? '教研二部' : '教研一部';
  select.replaceChildren();
  for (const template of state.templates) {
    const published = release(template);
    if (!template.active || !published || published.definition.type !== byId('activity-type').value || !published.definition.departments.includes(department)) continue;
    const option = element('option', `${published.definition.name} · V${published.version}`);
    option.value = template.id; select.append(option);
  }
  if (!select.childElementCount) {
    const empty = element('option', '当前类型和部门无可用模板'); empty.value = ''; select.append(empty);
  }
  for (const option of select.options) if (option.value === previous) select.value = previous;
  if (previous !== select.value) invalidatePreview();
}

/**
 * 获取当前申请选择并验证可用范围。
 * @returns {object} 模板、发布定义和业务输入
 */
function applicationInput() {
  let template;
  for (const candidate of state.templates) if (candidate.id === byId('activity-template').value) template = candidate;
  if (!template || !template.active || !release(template)) throw new Error('请选择有效的已发布模板');
  const published = release(template);
  const applicant = byId('applicant').value;
  const department = applicant === 'qiaoan' ? '教研二部' : '教研一部';
  if (published.definition.type !== byId('activity-type').value || !published.definition.departments.includes(department)) throw new Error('该申请人无权选择此模板');
  return { template, published, applicant, budget: amount('activity-budget') };
}

/** 预览已发布版本的实际路线并保存提交时的版本凭据。 */
function previewApplication() {
  const input = applicationInput();
  lastPreview = { templateId: input.template.id, version: input.published.version, applicant: input.applicant, budget: input.budget };
  byId('route-preview').replaceChildren(element('p', `${input.published.definition.name} / V${input.published.version}`));
  const rows = element('div');
  renderRoute(rows, route(input.published.definition, input.applicant, input.budget));
  byId('route-preview').append(rows);
  byId('application-feedback').textContent = '路线已预览。模拟提交将生成独立快照。';
}

/** 清除修改选择后的旧预览，要求重新确认实际路线。 */
function invalidatePreview() {
  lastPreview = null;
  byId('route-preview').textContent = '选择已变化，请重新预览。';
  byId('application-feedback').textContent = '';
}

/**
 * 校验预览版本并生成离线活动快照，不发送业务请求。
 * @param {SubmitEvent} event 申请提交事件
 */
function submitApplication(event) {
  event.preventDefault();
  const input = applicationInput();
  if (!lastPreview || lastPreview.templateId !== input.template.id || lastPreview.applicant !== input.applicant || lastPreview.budget !== input.budget) throw new Error('请先预览当前选择的审批路线');
  if (lastPreview.version !== input.published.version) {
    invalidatePreview(); throw new Error('模板已发布新版本，请重新预览并确认后提交');
  }
  const name = byId('activity-name').value.trim();
  if (name.length < 2) throw new Error('活动名称至少2个字');
  const instance = { id: newId('demo'), name, applicant: input.applicant, budget: input.budget, templateId: input.template.id, templateName: input.published.definition.name, templateVersion: input.published.version, definition: clone(input.published.definition), rows: route(input.published.definition, input.applicant, input.budget), createdAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) };
  state.instances.push(instance);
  persist();
  invalidatePreview();
  byId('application-feedback').textContent = `演示活动已创建，固定为${instance.templateName} V${instance.templateVersion}。可前往“实例对比”查看。`;
  toast('已保存独立快照，未创建真实审批待办。');
}

/** 展示活动冻结版本与模板最新版本的对比。 */
function renderInstances() {
  const container = byId('instance-cards');
  container.replaceChildren();
  for (const instance of state.instances) {
    const card = element('article', '', 'card');
    let latest = 0;
    for (const template of state.templates) if (template.id === instance.templateId) latest = template.currentVersion;
    card.append(element('h2', instance.name), element('p', `申请人 ${instance.applicant} · 预算 ${instance.budget.toFixed(2)}元`), element('span', `冻结 V${instance.templateVersion} / 模板最新 V${latest}`, 'badge'), element('p', `${instance.templateName} · ${instance.createdAt}`, 'muted'));
    const rows = element('div'); renderRoute(rows, instance.rows); card.append(rows); container.append(card);
  }
  if (!container.childElementCount) container.append(element('p', '还没有演示活动。先到“新建活动”预览并模拟提交。'));
}

/** 将画布适配容器，避免少量节点被自动放大。 */
async function fitGraph() {
  if (!graph) return;
  await graph.fitView({ when: 'always' }, false);
  if (graph.getZoom() > 1) { await graph.zoomTo(1, false); await graph.fitCenter(false); }
  syncZoom();
}

/** 同步画布实际缩放比例。 */
function syncZoom() { if (graph) byId('zoom-label').textContent = `${Math.round(graph.getZoom() * 100)}%`; }

/**
 * 调整画布缩放或返回100%。
 * @param {number} factor 缩放倍数，0表示100%
 */
async function zoom(factor) {
  if (!graph) return;
  const next = factor === 0 ? 1 : Math.min(2.5, Math.max(0.2, graph.getZoom() * factor));
  await graph.zoomTo(next, false); await graph.fitCenter(false); syncZoom();
}

/** 切换画布全屏，尺寸由观察器重新计算。 */
function expand() {
  const expanded = byId('graph-panel').classList.toggle('expanded');
  byId('expand').textContent = expanded ? '退出全屏' : '全屏';
}

/**
 * 响应Esc，退出画布全屏。
 * @param {KeyboardEvent} event 键盘事件
 */
function keydown(event) { if (event.key === 'Escape' && byId('graph-panel').classList.contains('expanded')) expand(); }

/**
 * 开始拖动节点库类型。
 * @param {DragEvent} event 拖动事件
 */
function dragStart(event) {
  const target = event.target.closest('[data-kind]');
  if (!target) return;
  event.dataTransfer.setData('text/plain', target.dataset.kind);
  event.dataTransfer.effectAllowed = 'copy';
}

/**
 * 激活参考节点接入区。
 * @param {DragEvent} event 拖过事件
 */
function dragOver(event) {
  const target = event.target.closest('[data-position]');
  if (!target) return;
  event.preventDefault(); target.classList.add('drag-over'); event.dataTransfer.dropEffect = 'copy';
}

/**
 * 退出接入区时清除高亮。
 * @param {DragEvent} event 离开事件
 */
function dragLeave(event) { event.target.closest('[data-position]')?.classList.remove('drag-over'); }

/**
 * 松开拖动时接入对应类型节点。
 * @param {DragEvent} event 放置事件
 */
function drop(event) {
  const target = event.target.closest('[data-position]');
  if (!target) return;
  event.preventDefault(); target.classList.remove('drag-over');
  try { insert(event.dataTransfer.getData('text/plain'), target.dataset.position); } catch (error) { reportError(error); }
}

/**
 * 集中分发原型操作，阻止异常静默丢失。
 * @param {MouseEvent} event 点击事件
 */
function click(event) {
  try {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.view) { showView(target.dataset.view); return; }
    if (target.dataset.position) { insert('approval', target.dataset.position); return; }
    if (target.dataset.action) {
      const id = target.dataset.id;
      if (target.dataset.action === 'edit') { editTemplate(id); return; }
      for (const template of state.templates) if (template.id === id) {
        if (target.dataset.action === 'toggle') { template.active = !template.active; persist(); renderLibrary(); toast(template.active ? '模板已启用' : '模板已停用；旧活动仍保留快照。'); }
        if (target.dataset.action === 'copy') {
          const definition = clone((release(template)?.definition) || template.draft); definition.name += '（副本）';
          const added = { id: newId('template'), active: true, currentVersion: 0, dirty: true, draft: definition, releases: [] };
          state.templates.push(added); persist(); editTemplate(added.id);
        }
        return;
      }
    }
    switch (target.id) {
      case 'new-template': {
        const added = { id: newId('template'), active: true, currentVersion: 0, dirty: true, draft: { name: '新活动流程', type: '教研交流', departments: ['教研一部', '教研二部'], nodes: [node('department', '部门初审', 'manager')] }, releases: [] };
        state.templates.push(added); persist(); editTemplate(added.id); break;
      }
      case 'save-draft': saveDraft(); break;
      case 'validate': syncMetadata(); validate(current().draft); toast('结构、必要审核、预算条件与示例受理权限校验通过。正式发布还需服务端校验组织和数据范围。'); break;
      case 'publish': publish(); break;
      case 'delete-node': deleteNode(); break;
      case 'simulate': simulate(); break;
      case 'preview-route': previewApplication(); break;
      case 'expand': expand(); break;
      case 'fit': void fitGraph().catch(reportError); break;
      case 'zoom-in': void zoom(1.2).catch(reportError); break;
      case 'zoom-out': void zoom(1 / 1.2).catch(reportError); break;
      case 'reset-zoom': void zoom(0).catch(reportError); break;
      case 'reset-demo': if (window.confirm('清空本原型的模板改动和演示活动？业务数据库不会被访问。')) { state = seed(); persist(); showView('library'); lastPreview = null; toast('已恢复4套演示模板。'); } break;
    }
  } catch (error) { reportError(error); }
}

/**
 * 处理筛选、模板选择和条件显示变化。
 * @param {Event} event 控件变更事件
 */
function change(event) {
  const id = event.target.id;
  if (['filter-type', 'filter-department'].includes(id)) renderLibrary();
  if (['applicant', 'activity-type'].includes(id)) { invalidatePreview(); renderApplication(); }
  if (['activity-template', 'activity-budget'].includes(id)) invalidatePreview();
  if (id === 'node-condition') byId('threshold-label').hidden = event.target.value !== 'budget';
}

/**
 * 捕获两个表单的提交并统一展示校验错误。
 * @param {SubmitEvent} event 表单事件
 */
function submit(event) {
  try {
    if (event.target.id === 'node-form') applyNode(event);
    if (event.target.id === 'application-form') submitApplication(event);
  } catch (error) { event.preventDefault(); reportError(error); }
}

/** 画布尺寸变化时排队刷新，隐藏页面不触发渲染。 */
function resize() { if (!byId('designer').hidden) void refreshGraph(); }

/** 初始化原型存储、受理规则选项及事件，损坏缓存时使用默认状态。 */
function boot() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    state = saved ? JSON.parse(saved) : seed();
    if (!Array.isArray(state.templates) || !Array.isArray(state.instances)) state = seed();
  } catch (error) { state = seed(); }
  for (const [value, label] of Object.entries(PEOPLE)) {
    const option = element('option', label); option.value = value; byId('node-owner').append(option);
  }
  document.addEventListener('click', click);
  document.addEventListener('change', change);
  document.addEventListener('submit', submit);
  document.addEventListener('keydown', keydown);
  document.addEventListener('dragstart', dragStart);
  document.addEventListener('dragover', dragOver);
  document.addEventListener('dragleave', dragLeave);
  document.addEventListener('drop', drop);
  observer = new ResizeObserver(resize); observer.observe(byId('graph'));
  renderLibrary();
}

boot();
