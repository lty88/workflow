'use strict';

let nodes = initialNodes();
let selected = 'dept';
let direction = 'TB';
let positions = {};
let undoStack = [];
let graph = null;
let rendering = false;
let queued = false;
let timer;
const labels = { approval: '审批 · 全员通过', task: '任务 · 全员完成', notice: '知会 · 不阻断' };

/**
 * 创建最小业务流程，系统起止锚点在绘图时生成，不放入业务节点数组。
 * @returns 包含一个受保护部门负责人审批的演示节点数组
 */
function initialNodes() {
  return [{ id: 'dept', label: '申请部门负责人审核', kind: 'approval', deps: [], protected: true }];
}

/**
 * 取得原型元素，缺少元素时给出明确错误。
 * @param id 元素标识
 * @returns 页面元素
 */
function byId(id) {
  const target = document.getElementById(id);
  if (!target) throw new Error('原型元素不存在：' + id);
  return target;
}

/**
 * 创建安全的文本元素，演示输入不会作为 HTML 执行。
 * @param tag HTML 标签
 * @param text 文本
 * @param className 样式类
 * @returns 新元素
 */
function element(tag, text = '', className = '') {
  const target = document.createElement(tag);
  target.textContent = text;
  target.className = className;
  return target;
}

/** 保存当前定义与布局的独立副本，支持最近二十次撤销。 */
function remember() {
  undoStack.push(structuredClone({ nodes, selected, positions, direction }));
  if (undoStack.length > 20) undoStack.shift();
}

/**
 * 展示本地原型操作结果，不发送接口请求。
 * @param text 提示内容
 */
function notify(text) {
  clearTimeout(timer);
  const box = byId('feedback');
  box.textContent = text;
  box.hidden = false;
  timer = setTimeout(hideFeedback, 4000);
}

/** 隐藏已结束的操作提示。 */
function hideFeedback() {
  byId('feedback').hidden = true;
}

/**
 * 按界面顺序计算依赖层次，检查缺失引用、重复标识与循环。
 * @param items 待检查的业务节点
 * @returns 按执行依赖排列的节点，异常时抛出中文原因
 */
function ordered(items = nodes) {
  const map = new Map(items.map((node) => [node.id, node]));
  if (map.size !== items.length) throw new Error('节点标识不能重复');
  const result = [];
  const waiting = new Set(map.keys());
  while (waiting.size) {
    let changed = false;
    for (const id of [...waiting]) {
      const node = map.get(id);
      if (node.deps.some((dep) => !map.has(dep))) throw new Error('存在已删除的前置节点');
      if (node.deps.some((dep) => waiting.has(dep))) continue;
      result.push(node);
      waiting.delete(id);
      changed = true;
    }
    if (!changed) throw new Error('前置关系形成循环，请调整后再应用');
  }
  return result;
}

/**
 * 继承知会节点的实际前置，结束锚点只汇总必办分支。
 * @param id 当前前置节点标识
 * @returns 生效的必办前置标识数组
 */
function blockingParents(id) {
  const node = nodes.find((item) => item.id === id);
  if (!node) return [];
  if (node.kind !== 'notice') return [id];
  return [...new Set(node.deps.flatMap(blockingParents))];
}

/**
 * 创建图形展示边，业务依赖和系统展示连接分开标识。
 * @param source 起点标识
 * @param target 终点标识
 * @param dashed 是否知会弱连接
 * @returns G6 连线数据
 */
function connection(source, target, dashed = false) {
  return {
    id: JSON.stringify([source, target]),
    source,
    target,
    style: { stroke: dashed ? '#bac5d5' : '#9aacc8', lineDash: dashed ? [5, 4] : undefined },
  };
}

/**
 * 构造只读系统锚点与可编辑业务节点，图中位置不改变依赖。
 * @returns 带开始、审批结束和知会虚线的 G6 数据
 */
function graphData() {
  const list = ordered();
  const data = {
    nodes: [
      {
        id: 'system:start',
        style: {
          labelText: '开始 · 提交活动申请\n系统自动触发',
          size: [220, 60],
          radius: 30,
          fill: '#eef4ff',
          stroke: '#c4d5ef',
        },
      },
      {
        id: 'system:end',
        style: {
          labelText: '审批结束\n全部必办分支完成',
          size: [220, 60],
          radius: 30,
          fill: '#eff7f3',
          stroke: '#c1ddd1',
        },
      },
    ],
    edges: [],
  };
  for (const node of list) {
    const owner = node.protected
      ? '申请人所在部门负责人'
      : node.kind === 'task'
        ? '示例办理角色'
        : node.kind === 'notice'
          ? '示例通知对象'
          : '示例审核角色';
    data.nodes.push({
      id: node.id,
      style: {
        labelText: `${node.label}\n${labels[node.kind]}${node.protected ? ' · 必经' : ''}\n${owner}`,
        fill: node.protected ? '#fffdf6' : '#fff',
        stroke: node.protected ? '#e1c88f' : '#b8c9e5',
      },
    });
    if (!node.deps.length) data.edges.push(connection('system:start', node.id, node.kind === 'notice'));
    for (const dep of node.deps)
      data.edges.push(
        connection(
          dep,
          node.id,
          node.kind === 'notice' || nodes.find((item) => item.id === dep)?.kind === 'notice',
        ),
      );
    if (node.kind === 'notice') continue;
    const hasSuccessor = nodes.some(
      (item) => item.kind !== 'notice' && item.deps.flatMap(blockingParents).includes(node.id),
    );
    if (!hasSuccessor) data.edges.push(connection(node.id, 'system:end'));
  }
  return data;
}

/** 更新按钮、方向与选中状态，属性面板输入由独立的选择或应用操作更新。 */
function syncControls() {
  byId('node-count').textContent = `${nodes.length} 个业务节点 · 2 个系统锚点`;
  byId('undo').disabled = !undoStack.length;
  byId('vertical').classList.toggle('active', direction === 'TB');
  byId('horizontal').classList.toggle('active', direction === 'LR');
  for (const button of document.querySelectorAll('[data-add]'))
    button.disabled = !nodes.some((node) => node.id === selected);
}

/** 以当前依赖重新绘图，保持手动坐标；绘图请求串行，避免快速点击覆盖。 */
async function renderGraph() {
  syncControls();
  queued = true;
  if (rendering || !graph) return;
  rendering = true;
  try {
    while (queued) {
      queued = false;
      graph.setOptions({ layout: { type: 'dagre', rankdir: direction, ranksep: 35, nodesep: 28 } });
      graph.setData(graphData());
      await graph.render();
      if (Object.keys(positions).length) {
        await graph.translateElementTo(positions, false);
        graph.updateEdgeData(
          graph.getEdgeData().map((edge) => ({ ...edge, style: { ...edge.style, controlPoints: [] } })),
        );
        await graph.draw();
      }
      await graph.setElementState(
        Object.fromEntries(
          graph.getNodeData().map((node) => [node.id, node.id === selected ? ['selected'] : []]),
        ),
        false,
      );
      await fit();
    }
  } catch (error) {
    notify(error.message || '图形加载失败');
  } finally {
    rendering = false;
  }
}

/**
 * 选择真实业务节点或系统锚点，展示各自的可编辑范围。
 * @param id 图节点标识
 */
async function select(id) {
  selected = id;
  renderInspector();
  syncControls();
  if (graph)
    await graph.setElementState(
      Object.fromEntries(graph.getNodeData().map((node) => [node.id, node.id === id ? ['selected'] : []])),
      false,
    );
  byId('graph').focus({ preventScroll: true });
}

/**
 * 为属性面板添加只读规则，不用灰色下拉框隐藏锁定原因。
 * @param parent 容器元素
 * @param label 属性名称
 * @param text 属性值
 * @param explanation 原因说明
 */
function readonlyField(parent, label, text, explanation = '') {
  parent.append(element('label', label));
  const box = element('div', text, 'readonly-field');
  if (explanation) box.append(element('small', explanation));
  parent.append(box);
}

/** 根据节点类别显示系统说明或业务表单，名称和前置采用明确的应用操作。 */
function renderInspector() {
  const panel = byId('inspector');
  panel.replaceChildren();
  const node = nodes.find((item) => item.id === selected);
  const heading = element('div', '', 'inspector-heading');
  heading.append(element('h2', node ? '节点属性' : '系统节点说明'));
  heading.append(
    element(
      'span',
      node ? (node.protected ? '必经 · 规则锁定' : '可配置') : '系统 · 只读',
      `badge ${node ? (node.protected ? 'locked' : '') : 'system-badge'}`,
    ),
  );
  panel.append(heading, element('p', '选中卡片后，明确看到类型与编辑边界', 'inspector-subtitle'));
  if (!node) {
    const start = selected === 'system:start';
    readonlyField(
      panel,
      '节点类型',
      start ? '系统开始节点' : '系统审批结束节点',
      '不生成个人审批待办，不计入业务节点数',
    );
    readonlyField(panel, '触发时机', start ? '申请人提交活动申请成功' : '全部生效必办节点完成');
    const message = element(
      'div',
      start
        ? '所有没有前置的业务节点会在提交后同时进入。请选中下方业务节点，使用前插、后插或并行设计路线。'
        : '接下来进入指派执行。知会不阻断审批完成；执行、汇报及归档仍需继续完成。',
      'explanation',
    );
    panel.append(
      message,
      element('p', '系统锚点用于说明流程边界，不能修改类型、受理人或删除。', 'inspector-subtitle'),
    );
    return;
  }
  const nameLabel = element('label', '节点名称');
  nameLabel.htmlFor = 'node-name';
  const name = element('input');
  name.id = 'node-name';
  name.value = node.label;
  name.maxLength = 80;
  panel.append(nameLabel, name);
  if (node.protected) {
    readonlyField(panel, '节点类型', '审批 · 全员通过', '公司规则锁定：不能改成任务或知会');
    readonlyField(panel, '受理规则', '申请人所在部门的负责人', '根据申请人实际部门解析，与节点名称无关');
  } else {
    const typeLabel = element('label', '节点类型');
    typeLabel.htmlFor = 'node-type';
    const type = element('select');
    type.id = 'node-type';
    for (const [value, label] of Object.entries(labels)) {
      const option = element('option', label);
      option.value = value;
      option.selected = value === node.kind;
      type.append(option);
    }
    panel.append(typeLabel, type);
    readonlyField(
      panel,
      '受理规则（演示）',
      node.kind === 'task' ? '指定办理角色' : node.kind === 'notice' ? '指定通知对象' : '指定审核角色',
      '真实人员与权限配置沿用正式系统，此原型只演示节点边界',
    );
  }
  const depsLabel = element('label', '前置节点 · 全部完成后进入');
  depsLabel.htmlFor = 'node-deps';
  const deps = element('select');
  deps.id = 'node-deps';
  deps.multiple = true;
  deps.size = Math.max(2, Math.min(4, nodes.length - 1));
  for (const item of ordered()) {
    if (item.id === node.id) continue;
    const option = element('option', item.label);
    option.value = item.id;
    option.selected = node.deps.includes(item.id);
    deps.append(option);
  }
  panel.append(
    depsLabel,
    deps,
    element('small', '不选前置 = 提交后进入。按 Ctrl / ⌘ 可多选或取消。', 'muted'),
  );
  panel.append(
    element(
      'div',
      node.protected
        ? '当前规则要求保留此审核，不能删除或条件跳过。名称、前置和数据权限仍可编辑；“必经”不等于“必须第一个”。'
        : node.kind === 'notice'
          ? '知会按依赖时点通知人员，不作为后续审批的阻断关卡。'
          : '拖动只调整卡片位置。前置关系才决定它何时进入。',
      `explanation ${node.protected ? 'warning' : ''}`,
    ),
  );
  readonlyField(
    panel,
    '数据权限',
    '在正式系统的数据权限页签配置',
    '节点类型、执行先后与资料查看权限分别管理',
  );
  const actions = element('div', '', 'inspector-actions');
  const apply = element('button', '应用修改', 'primary');
  apply.addEventListener('click', applyNode);
  const remove = element('button', '删除节点', 'danger');
  remove.disabled = !!node.protected;
  remove.title = node.protected ? '必要审核节点不能删除' : 'Delete / Backspace；可撤销';
  remove.addEventListener('click', removeSelected);
  actions.append(apply, remove);
  panel.append(actions);
}

/** 将名称、类型和前置应用到演示节点，结构无效时保持原定义与当前输入。 */
function applyNode() {
  const node = nodes.find((item) => item.id === selected);
  if (!node) return;
  const label = byId('node-name').value.trim();
  if (label.length < 2) return notify('节点名称至少两个字');
  const deps = Array.from(byId('node-deps').selectedOptions, (item) => item.value);
  const kind = node.protected ? node.kind : byId('node-type').value;
  const next = nodes.map((item) => (item.id === node.id ? { ...item, label, deps, kind } : item));
  try {
    ordered(next);
  } catch (error) {
    return notify(error.message);
  }
  remember();
  nodes = next;
  positions = {};
  renderInspector();
  void renderGraph();
  notify('属性已应用。名称改变不会把受理人绑定到名称中的部门。');
}

/**
 * 以明确的前插、后插或并行语义新增业务节点，保留必要审核。
 * @param kind 新节点类型
 */
function addNode(kind) {
  const anchor = nodes.find((item) => item.id === selected);
  if (!anchor) return notify('请先选择一个业务节点');
  if (nodes.length >= 12) return notify('原型最多演示十二个业务节点');
  remember();
  const placement = byId('placement').value;
  const id = 'node-' + crypto.randomUUID();
  const added = {
    id,
    label: { approval: '专项审批', task: '资料准备任务', notice: '发送活动通知' }[kind],
    kind,
    deps: placement === 'after' ? [anchor.id] : [...anchor.deps],
  };
  for (const child of nodes) {
    if (child.id === anchor.id || !child.deps.includes(anchor.id)) continue;
    if (placement === 'after') child.deps = child.deps.map((dep) => (dep === anchor.id ? id : dep));
    if (placement === 'parallel') child.deps = [...new Set([...child.deps, id])];
  }
  if (placement === 'before') anchor.deps = [id];
  nodes.push(added);
  selected = id;
  positions = {};
  renderInspector();
  void renderGraph();
  notify(
    kind === 'notice'
      ? '已新增知会。虚线表示通知时点，不阻断后续。'
      : '已按接入位置更新依赖；自动排列只整理位置。',
  );
}

/** 删除普通节点，后继继承原前置；系统锚点与必要审核保持只读。 */
function removeSelected() {
  const node = nodes.find((item) => item.id === selected);
  if (!node || node.protected) return notify('系统锚点及必要审核节点不能删除');
  remember();
  nodes = nodes
    .filter((item) => item.id !== node.id)
    .map((item) => ({
      ...item,
      deps: [...new Set(item.deps.flatMap((dep) => (dep === node.id ? node.deps : [dep])))],
    }));
  selected = 'dept';
  positions = {};
  renderInspector();
  void renderGraph();
  notify('已删除，可撤销恢复。');
}

/** 撤销最近的演示修改，恢复节点、依赖及图形方向。 */
function undo() {
  const value = undoStack.pop();
  if (!value) return;
  ({ nodes, selected, positions, direction } = value);
  renderInspector();
  void renderGraph();
}

/**
 * 载入最小模板或包含串并行及知会的演示模板。
 * @param full 是否展示完整示例
 */
function loadExample(full) {
  remember();
  nodes = initialNodes();
  positions = {};
  selected = 'dept';
  if (full)
    nodes.push(
      { id: 'plan', label: '活动方案审核', kind: 'approval', deps: ['dept'] },
      { id: 'finance', label: '活动预算复核', kind: 'approval', deps: ['dept'] },
      { id: 'notice', label: '同步活动安排', kind: 'notice', deps: ['dept'] },
    );
  renderInspector();
  void renderGraph();
}

/**
 * 切换图形展示方向，保持全部业务前置关系不变。
 * @param value 纵向或横向方向
 */
function changeDirection(value) {
  direction = value;
  positions = {};
  void renderGraph();
}

/** 根据现有依赖重新对齐节点，不更改业务顺序。 */
function arrange() {
  remember();
  positions = {};
  void renderGraph();
  notify('已按依赖整理位置，执行顺序保持不变。');
}

/** 检查原型结构与必要审核标记，演示检查结果不代替真实发布校验。 */
function check() {
  try {
    ordered();
    if (!nodes.some((node) => node.protected && node.kind === 'approval'))
      throw new Error('需要保留必要部门审核');
    notify('原型结构检查通过：必要审核保留，前置关系无环。');
  } catch (error) {
    notify(error.message);
  }
}

/** 适配当前图形，防止少量节点被放大超过原始尺寸。 */
async function fit() {
  if (!graph) return;
  await graph.fitView({ when: 'always' }, false);
  if (graph.getZoom() > 1) {
    await graph.zoomTo(1, false);
    await graph.fitCenter(false);
  }
  updateZoom();
}

/** 将实际缩放值同步到工具栏。 */
function updateZoom() {
  if (graph) byId('zoom').textContent = Math.round(graph.getZoom() * 100) + '%';
}

/**
 * 按按钮调整图形缩放。
 * @param ratio 放大或缩小倍率
 */
async function zoom(ratio) {
  if (graph) {
    await graph.zoomBy(ratio, false);
    updateZoom();
  }
}

/** 拖动完成后保存演示坐标，重算所有连线，保持依赖定义不变。 */
function savePositions() {
  if (!graph) return;
  positions = Object.fromEntries(
    nodes.map((node) => [node.id, graph.getElementPosition(node.id).slice(0, 2)]),
  );
  graph.updateEdgeData(
    graph.getEdgeData().map((edge) => ({ ...edge, style: { ...edge.style, controlPoints: [] } })),
  );
  void graph.draw();
}

/**
 * 在画布内支持删除和撤销，输入控件保留原生编辑。
 * @param event 键盘事件
 */
function keyboard(event) {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    !event.target.closest('.workbench') ||
    event.target.closest('input,textarea,select,[contenteditable]')
  )
    return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo();
  } else if (
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    ['Delete', 'Backspace'].includes(event.key) &&
    nodes.some((node) => node.id === selected && !node.protected)
  ) {
    event.preventDefault();
    removeSelected();
  }
}

/** 初始化本地演示事件和 G6 实例，不访问真实项目接口或数据库。 */
function initialize() {
  for (const button of document.querySelectorAll('[data-add]'))
    button.addEventListener('click', () => addNode(button.dataset.add));
  byId('minimal').addEventListener('click', () => loadExample(false));
  byId('example').addEventListener('click', () => loadExample(true));
  byId('vertical').addEventListener('click', () => changeDirection('TB'));
  byId('horizontal').addEventListener('click', () => changeDirection('LR'));
  byId('arrange').addEventListener('click', arrange);
  byId('check').addEventListener('click', check);
  byId('undo').addEventListener('click', undo);
  byId('fit').addEventListener('click', () => void fit());
  byId('zoom-in').addEventListener('click', () => void zoom(1.2));
  byId('zoom-out').addEventListener('click', () => void zoom(1 / 1.2));
  document.addEventListener('keydown', keyboard);
  renderInspector();
  syncControls();
  if (!window.G6) {
    byId('graph').append(element('p', '未找到本地 G6 资源，请在已安装依赖的项目工作区打开原型。'));
    return;
  }
  const container = byId('graph');
  graph = new G6.Graph({
    container,
    width: container.clientWidth,
    height: container.clientHeight,
    padding: 24,
    animation: false,
    zoomRange: [0.25, 2],
    behaviors: [
      'drag-canvas',
      'zoom-canvas',
      {
        type: 'drag-element',
        enable: (event) => event.targetType === 'node' && !event.target.id.startsWith('system:'),
        onFinish: savePositions,
      },
    ],
    node: {
      type: 'rect',
      style: {
        size: [248, 84],
        radius: 10,
        lineWidth: 1.4,
        labelFontSize: 14,
        labelLineHeight: 20,
        labelFill: '#344866',
        labelPlacement: 'center',
        cursor: 'pointer',
      },
      state: { selected: { stroke: '#235de9', lineWidth: 3, shadowColor: '#235de922', shadowBlur: 12 } },
    },
    edge: {
      type: 'polyline',
      style: {
        controlPoints: [],
        router: { type: 'shortest-path', enableObstacleAvoidance: true, offset: 10, gridSize: 10 },
        endArrow: true,
        lineWidth: 1.4,
        radius: 7,
      },
    },
  });
  graph.on('node:click', (event) => {
    void select(event.target.id);
  });
  graph.on('aftertransform', updateZoom);
  new ResizeObserver(() => {
    if (graph) graph.resize(container.clientWidth, container.clientHeight);
  }).observe(container);
  void renderGraph();
}

initialize();
