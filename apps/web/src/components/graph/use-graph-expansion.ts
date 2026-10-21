import { nextTick, onBeforeUnmount, ref } from 'vue';
import type { Ref } from 'vue';
import { useEventListener } from '@vueuse/core';

/**
 * 管理页内全屏画布、背景滚动和退出焦点，兼容PC与移动浏览器。
 * @param element 画布区域元素
 * @returns 全屏状态、原位占位高度及切换能力
 */
export function useGraphExpansion(element: Ref<HTMLElement | null>) {
  const expanded = ref(false);
  const placeholderHeight = ref<number>();
  let previousOverflow = '';
  let previousFocus: HTMLElement | null = null;
  let ownsScrollLock = false;

  /** 恢复本画布进入全屏前的页面滚动状态。 */
  function releaseScroll(): void {
    if (!ownsScrollLock) return;
    document.body.style.overflow = previousOverflow;
    ownsScrollLock = false;
  }

  /** 切换页内全屏，保留原位空间并在进入或退出时恢复合适的键盘焦点。 */
  async function toggleExpanded(): Promise<void> {
    if (expanded.value) {
      expanded.value = false;
      releaseScroll();
      await nextTick();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    } else {
      placeholderHeight.value = element.value?.getBoundingClientRect().height;
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousOverflow = document.body.style.overflow;
      ownsScrollLock = true;
      document.body.style.overflow = 'hidden';
      expanded.value = true;
      await nextTick();
      element.value?.querySelector<HTMLButtonElement>('[data-graph-expand]')?.focus();
    }
  }

  /**
   * 从画布内按Esc退出全屏；外部业务抽屉自行处理键盘事件。
   * @param event 键盘事件
   */
  function exitOnEscape(event: KeyboardEvent): void {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      !expanded.value ||
      !(event.target instanceof Node) ||
      (event.target !== document.body && !element.value?.contains(event.target))
    )
      return;
    event.preventDefault();
    void toggleExpanded();
  }

  useEventListener(document, 'keydown', exitOnEscape);
  onBeforeUnmount(releaseScroll);
  return { expanded, placeholderHeight, toggleExpanded };
}
