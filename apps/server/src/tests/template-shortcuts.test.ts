import { expect, test } from 'vitest';
import { seedConfig, topological } from '@workflow/domain';
import type { TemplateDefinition } from '@workflow/domain';
import { canRemoveNode, insertNode, removeNode } from '../../../web/src/components/templates/editing';
import { isNodeDeleteShortcut } from '../../../web/src/components/templates/keyboard';

/**
 * 创建无修饰键的删除事件，用于检查快捷键的保护条件。
 * @param key 当前键名
 * @returns 最小键盘事件状态
 */
function deleteKey(key = 'Delete') {
  return {
    key,
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
}

/** 核对两种删除按键均生效，输入控件和其他按键保留原有行为。 */
function keyCase(): void {
  expect(isNodeDeleteShortcut(deleteKey(), false)).toBe(true);
  expect(isNodeDeleteShortcut(deleteKey('Backspace'), false)).toBe(true);
  expect(isNodeDeleteShortcut(deleteKey(), true)).toBe(false);
  expect(isNodeDeleteShortcut(deleteKey('Backspace'), true)).toBe(false);
  expect(isNodeDeleteShortcut(deleteKey('Enter'), false)).toBe(false);
}
test('Delete 和 Backspace 可删除节点，输入控件不触发', keyCase);

/** 核对组合键、输入法、长按和已处理事件不会连续误删节点。 */
function guardCase(): void {
  for (const key of [
    'ctrlKey',
    'metaKey',
    'altKey',
    'shiftKey',
    'repeat',
    'isComposing',
    'defaultPrevented',
  ] as const) {
    expect(isNodeDeleteShortcut({ ...deleteKey(), [key]: true }, false)).toBe(false);
    expect(isNodeDeleteShortcut({ ...deleteKey('Backspace'), [key]: true }, false)).toBe(false);
  }
}
test('输入法、修饰键、长按重复和已处理事件均不触发节点删除', guardCase);

/**
 * 构造与设计器一致的模板定义，包含必要审核及并行汇合结构。
 * @returns 可用于删除校验的独立模板
 */
function definition(): TemplateDefinition {
  const config = seedConfig();
  return {
    name: '快捷键删除校验',
    activityTypeIds: ['teaching'],
    defaultForTypeIds: [],
    departmentIds: [],
    roleIds: [],
    nodes: structuredClone(config.workflow.nodes),
    layout: { direction: 'TB', positions: {} },
  };
}

/** 核对业务节点统一可删除，系统边界和无效选择受到保护。 */
function eligibilityCase(): void {
  const value = definition();
  const protectedNode = value.nodes.find((node) => node.protected)!;
  const optional = value.nodes.find((node) => !node.protected)!;
  expect(canRemoveNode(value, optional.id)).toBe(true);
  expect(canRemoveNode(value, protectedNode.id)).toBe(true);
  expect(canRemoveNode(value, 'stage:apply')).toBe(false);
  expect(canRemoveNode(value, 'stage:approved')).toBe(false);
  expect(canRemoveNode(value, '')).toBe(false);
  expect(canRemoveNode(value, 'missing')).toBe(false);
  const next = removeNode(value, protectedNode.id);
  expect(next.nodes.some((node) => node.id === protectedNode.id)).toBe(false);
  expect(value.nodes.some((node) => node.id === protectedNode.id)).toBe(true);
}
test('旧默认业务节点可删除，系统边界和无效选择受到保护', eligibilityCase);

/** 核对删除新增节点会重接后继、清理坐标，原快照保留以支持撤销。 */
function deletionCase(): void {
  const original = definition();
  const result = insertNode(original, original.nodes[0]!.id, 'task', 'after');
  result.definition.layout.positions[result.id] = { x: 200, y: 400 };
  const before = JSON.stringify(result.definition);
  const next = removeNode(result.definition, result.id);
  expect(next.nodes).toEqual(original.nodes);
  expect(next.layout.positions).not.toHaveProperty(result.id);
  expect(topological(next.nodes).error).toBe('');
  expect(JSON.stringify(result.definition)).toBe(before);
  expect(next.nodes.some((node) => node.deps.includes(result.id))).toBe(false);
}
test('新增后可删除，后继继承前置且原定义可用于撤销恢复', deletionCase);
