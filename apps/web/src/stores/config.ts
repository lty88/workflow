import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { CompanyConfig, ConfigState } from '@workflow/domain';
import { configApi, publishConfigApi, saveConfigApi } from '@/api/configuration';

/**
 * 管理五项配置的同一份草案、版本冲突与发布状态。
 * @returns 加载、更新草案、保存和发布能力
 */
export const useConfigStore = defineStore(
  'configuration',
  /**
   * 管理配置草案与发布版本。
   * @returns 版本状态和保存发布操作
   */ function configStore() {
    const state = ref<ConfigState | null>(null);
    const draft = ref<CompanyConfig | null>(null);
    const busy = ref(false);
    const dirty = computed(
      () => !!state.value && JSON.stringify(draft.value) !== JSON.stringify(state.value.draft),
    );
    const unpublished = computed(
      () => !!state.value && JSON.stringify(draft.value) !== JSON.stringify(state.value.published),
    );
    /**
     * 应用服务端配置状态。
     * @param value 最新配置
     */
    function apply(value: ConfigState): void {
      state.value = value;
      draft.value = structuredClone(value.draft);
    }
    /**
     * 加载配置并替换草案。
     */
    async function load(): Promise<void> {
      busy.value = true;
      try {
        apply(await configApi());
      } finally {
        busy.value = false;
      }
    }
    /**
     * 替换编辑中的草案，不改服务端发布配置。
     * @param value 新草案
     */
    function update(value: CompanyConfig): void {
      draft.value = value;
    }
    /**
     * 按草案版本保存，冲突时由服务端拒绝。
     */
    async function save(): Promise<void> {
      if (!state.value || !draft.value) return;
      busy.value = true;
      try {
        apply(await saveConfigApi(draft.value, state.value.draftRevision));
      } finally {
        busy.value = false;
      }
    }
    /**
     * 先保存本地草案，再发布服务端校验通过的配置。
     */
    async function publish(): Promise<void> {
      await save();
      if (!state.value) return;
      busy.value = true;
      try {
        apply(await publishConfigApi(state.value.draftRevision));
      } finally {
        busy.value = false;
      }
    }
    /**
     * 退出登录时丢弃上个账号配置资料。
     */
    function reset(): void {
      state.value = null;
      draft.value = null;
    }
    return { state, draft, busy, dirty, unpublished, load, update, save, publish, reset };
  },
);
