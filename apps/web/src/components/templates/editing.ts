import { findById, topological } from '@workflow/domain';
import type { NodeDefinition, TemplateDefinition } from '@workflow/domain';
import { clone, newId } from '@/composables/format';
import type { GraphConnection } from '@/components/graph/types';

/**
 * 在模板参考节点前、后或并行插入节点，并重接后继依赖。
 * @param definition 当前模板
 * @param anchorId 参考节点
 * @param kind 新节点类型
 * @param position 接入方向
 * @returns 新定义与选中节点标识
 */
export function insertNode(
  definition: TemplateDefinition,
  anchorId: string,
  kind: NodeDefinition['kind'],
  position: 'before' | 'after' | 'parallel',
): { definition: TemplateDefinition; id: string } {
  const next = clone(definition);
  const anchor = findById(next.nodes, anchorId);
  const atStart = anchorId === 'stage:apply' || (!anchorId && !next.nodes.length);
  if (!anchor && !atStart) throw new Error('请先选择业务节点或开始节点');
  if (next.nodes.length >= 80) throw new Error('每套模板最多80个节点');
  const added: NodeDefinition = {
    id: newId('n'),
    label: { approval: '新增专项审核', task: '新增协作任务', notice: '新增知会' }[kind],
    kind,
    deps: atStart ? [] : position === 'after' ? [anchor!.id] : [...anchor!.deps],
    assignee: kind === 'approval' ? { type: 'manager', value: '' } : { type: 'role', value: 'coordinator' },
  };
  if (atStart) {
    for (const node of next.nodes) if (!node.deps.length) node.deps = [added.id];
    next.nodes.push(added);
    return { definition: next, id: added.id };
  }
  if (!anchor) throw new Error('参考节点不存在');
  for (const child of next.nodes) {
    if (child.id === anchor.id || !child.deps.includes(anchor.id)) continue;
    const deps: string[] = [];
    for (const id of child.deps) deps.push(position === 'after' && id === anchor.id ? added.id : id);
    if (position === 'parallel') deps.push(added.id);
    child.deps = [...new Set(deps)];
  }
  if (position === 'before') anchor.deps = [added.id];
  next.nodes.push(added);
  return { definition: next, id: added.id };
}

/**
 * 判断模板中的节点是否允许删除，系统起止锚点不属于可删除的业务节点。
 * @param definition 当前流程模板
 * @param id 待删除节点标识
 * @returns 业务节点存在时为真，旧版默认保护标记不再限制模板编辑
 */
export function canRemoveNode(definition: TemplateDefinition, id: string): boolean {
  const node = findById(definition.nodes, id);
  return !!node;
}

/**
 * 删除可选节点并让后继继承其前置，同时移除坐标引用。
 * @param definition 当前模板
 * @param id 删除节点标识
 * @returns 删除后的模板
 */
export function removeNode(definition: TemplateDefinition, id: string): TemplateDefinition {
  const next = clone(definition);
  const removed = findById(next.nodes, id);
  if (!removed) throw new Error('节点不存在，无法删除');
  const kept: NodeDefinition[] = [];
  for (const node of next.nodes) {
    if (node.id === id) continue;
    const deps: string[] = [];
    for (const dep of node.deps) deps.push(...(dep === id ? removed.deps : [dep]));
    node.deps = [...new Set(deps)];
    kept.push(node);
  }
  next.nodes = kept;
  delete next.layout.positions[id];
  return next;
}

/**
 * 创建或移除业务依赖连线，拒绝自环、重复边和环路。
 * @param definition 当前模板
 * @param connection 源节点与目标节点
 * @param remove 是否删除已有依赖
 * @returns 修改后的模板
 */
export function changeConnection(
  definition: TemplateDefinition,
  connection: GraphConnection,
  remove = false,
): TemplateDefinition {
  const next = clone(definition);
  const source = findById(next.nodes, connection.source);
  const target = findById(next.nodes, connection.target);
  if (!source || !target) throw new Error('只能连接真实流程节点');
  if (source.id === target.id) throw new Error('节点不能依赖自身');
  if (remove) {
    const kept = [];
    for (const id of target.deps) if (id !== source.id) kept.push(id);
    target.deps = kept;
  } else {
    if (target.deps.includes(source.id)) throw new Error('该依赖连线已存在');
    target.deps.push(source.id);
  }
  const checked = topological(next.nodes);
  if (checked.error) throw new Error(checked.error);
  return next;
}
