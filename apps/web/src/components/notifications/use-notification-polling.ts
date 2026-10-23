import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import type { Notification } from '@/typings/api';
import { notificationFeedApi, notificationsApi, readNotificationApi } from '@/api/notifications';

/**
 * 定时增量拉取本人所有类型的站内通知，首次静默建立基线；串行分页并在退出时取消请求。
 * @param actor 当前登录成员
 * @param notify 对本批新增未读消息执行一次声音提醒
 * @returns 消息列表、未读数、连接错误、刷新及标记已读能力
 */
export function useNotificationPolling(actor: Ref<string>, notify: (count: number, ids: string[]) => void) {
  const messages = ref<Notification[]>([]);
  const loading = ref(false);
  const error = ref('');
  const unread = computed(() => messages.value.filter((item) => !item.readAt).length);
  let cursor: string | undefined;
  let baseline = false;
  let generation = 0;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let pending: Promise<void> | null = null;
  const seen = new Set<string>();
  /**
   * 合并消息并限制展示最近100条，游标由服务端候选页推进，不依赖列表排序。
   * @param items 新取得的消息
   */
  function merge(items: Notification[]): void {
    const map = new Map(messages.value.map((item) => [item.id, item]));
    for (const item of items) map.set(item.id, item);
    messages.value = [...map.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, 100);
  }
  /** 清除轮询、取消在途请求并隔离旧账号响应。 */
  function stop(): void {
    generation++;
    clearTimeout(timer);
    controller?.abort();
    controller = null;
    pending = null;
    cursor = undefined;
    baseline = false;
    failures = 0;
    seen.clear();
    messages.value = [];
    loading.value = false;
    error.value = '';
  }
  /**
   * 根据前后台状态和失败次数安排下一次请求，只有前一请求结束后才排队。
   * @param delay 可选的下一页快速补拉间隔
   */
  function schedule(delay?: number): void {
    clearTimeout(timer);
    if (!actor.value) return;
    timer = setTimeout(
      poll,
      delay ?? Math.min(60000, (document.hidden ? 30000 : 10000) * 2 ** Math.min(failures, 3)),
    );
  }
  /**
   * 拉取增量页，首次不播历史；成功后去重聚合提醒，失败保留游标以便补拉。
   * @returns 当前轮询完成信号
   */
  async function poll(): Promise<void> {
    if (!actor.value) return;
    if (pending) return pending;
    const ownGeneration = generation;
    controller = new AbortController();
    const signal = controller.signal;
    /** 拉取最多五页新增通知，积压较多时快速继续，避免长请求占用。 */
    async function load(): Promise<void> {
      const newIds: string[] = [];
      let more = false;
      try {
        for (let page = 0; page < 5; page++) {
          const result = await notificationFeedApi(cursor, signal);
          if (ownGeneration !== generation) return;
          for (const item of result.items) {
            if (baseline && !seen.has(item.id) && !item.readAt) newIds.push(item.id);
            seen.add(item.id);
            if (seen.size > 2000) seen.delete(seen.values().next().value!);
          }
          merge(result.items);
          cursor = result.cursor;
          baseline = true;
          more = result.hasMore;
          if (!more) break;
        }
        failures = 0;
        error.value = '';
      } catch {
        if (ownGeneration !== generation) return;
        failures++;
        error.value = '消息暂时连接失败，正在自动重试';
      } finally {
        if (ownGeneration === generation) {
          if (newIds.length) notify(newIds.length, newIds);
          pending = null;
          loading.value = false;
          schedule(more && !failures ? 500 : undefined);
        }
      }
    }
    loading.value = true;
    pending = load();
    return pending;
  }
  /** 打开抽屉时刷新最近消息及其他页面的已读状态，复用串行轮询避免重复提醒。 */
  async function refresh(): Promise<void> {
    const ownGeneration = generation;
    await poll();
    if (!actor.value || ownGeneration !== generation) return;
    try {
      const items = await notificationsApi();
      if (ownGeneration === generation) messages.value = items;
    } catch {
      if (ownGeneration === generation) error.value = '消息刷新失败，稍后将自动重试';
    }
  }
  /**
   * 标记本人消息已读并更新本地状态。
   * @param id 消息标识
   */
  async function markRead(id: string): Promise<void> {
    const ownGeneration = generation;
    await readNotificationApi(id);
    if (ownGeneration !== generation) return;
    const item = messages.value.find((entry) => entry.id === id);
    if (item) item.readAt = new Date().toISOString();
  }
  /** 切换账号时清除前一账号缓存并立即建立新会话基线。 */
  function start(): void {
    stop();
    if (actor.value) void poll();
  }
  /** 页面重新可见或网络恢复时立即补拉，后台保持较低轮询频率。 */
  function resume(): void {
    if (!document.hidden && actor.value) {
      clearTimeout(timer);
      void poll();
    }
  }
  watch(actor, start, { immediate: true });
  useEventListener(document, 'visibilitychange', resume);
  useEventListener(window, 'online', resume);
  onBeforeUnmount(stop);
  return { messages, loading, error, unread, refresh, markRead };
}
