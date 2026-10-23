import { onScopeDispose, ref, watch } from 'vue';
import type { ComputedRef } from 'vue';
import type { PageDefinition } from '@workflow/domain';
import { pageApi } from '@/api/workspace';

/**
 * 随菜单标识读取服务端授权页面，清除旧页面并忽略过期请求，离开页面后停止写入状态。
 * @param pageKey 当前动态菜单标识
 * @returns 授权页面、读取状态、错误提示及重新读取能力
 */
export function useWorkspacePage(pageKey: ComputedRef<string>) {
  const page = ref<PageDefinition | null>(null);
  const busy = ref(false);
  const errorText = ref('');
  let requestId = 0;

  /** 请求失效后递增序号，使卸载前发起的响应不再更新页面。 */
  function invalidateRequests(): void {
    requestId += 1;
  }

  /** 重新读取当前菜单授权，失败时清空旧视图，只接受最近一次请求的结果。 */
  async function load(): Promise<void> {
    const current = ++requestId;
    page.value = null;
    errorText.value = '';
    busy.value = true;
    try {
      const result = await pageApi(pageKey.value);
      if (current === requestId) page.value = result;
    } catch (error) {
      if (current === requestId) errorText.value = error instanceof Error ? error.message : '页面加载失败';
    } finally {
      if (current === requestId) busy.value = false;
    }
  }

  watch(pageKey, load, { immediate: true });
  onScopeDispose(invalidateRequests);
  return { page, busy, errorText, load };
}
