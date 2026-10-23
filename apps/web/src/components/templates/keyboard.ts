/**
 * 识别节点删除快捷键，输入控件、组合键、输入法及长按重复事件保留原生行为。
 * @param event 当前键盘事件及修饰键状态
 * @param editingText 当前焦点是否处于文字输入或选择控件
 * @returns 是否应交给节点删除处理
 */
export function isNodeDeleteShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'defaultPrevented' | 'isComposing' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
  >,
  editingText: boolean,
): boolean {
  return (
    (event.key === 'Delete' || event.key === 'Backspace') &&
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    !editingText
  );
}
