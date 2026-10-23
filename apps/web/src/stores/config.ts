import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CompanyConfig, ConfigState } from '@workflow/domain'
import type { SettingsModule, SettingsChanges, MemberBatchAction } from '@/typings/api/settings'
import { configApi, saveSettingsApi, deleteMemberApi, batchMembersApi } from '@/api/configuration'
/** 管理主数据编辑副本与直接保存接口。
 * @returns 当前设置、编辑状态及读取、保存和清理能力
 */
export const useConfigStore = defineStore(
  'configuration',
  /** 创建设置状态，编辑副本仅存在当前页面，不是服务端草稿。
   * @returns 设置状态及读写方法
   */ function configStore() {
    const state = ref<ConfigState | null>(null)
    const draft = ref<CompanyConfig | null>(null)
    const busy = ref(false)
    const dirty = computed(() => !!state.value && JSON.stringify(draft.value) !== JSON.stringify(state.value.published))
    /** 应用接口真实结果并重置本地编辑副本。
     * @param value 服务端上下文
     */
    function apply(value: ConfigState): void {
      state.value = value
      draft.value = structuredClone(value.published)
    }
    /** 重新请求所有模块的实时主数据。 */
    async function load(): Promise<void> {
      busy.value = true
      try {
        apply(await configApi())
      } finally {
        busy.value = false
      }
    }
    /** 更新页面编辑副本，尚不发送网络请求。
     * @param value 编辑值
     */
    function update(value: CompanyConfig): void {
      draft.value = value
    }
    /** 仅提交当前模块字段，保存即生效并更新技术修订号。
     * @param module 当前设置模块
     */
    async function save(module: SettingsModule): Promise<void> {
      if (!state.value || !draft.value) throw new Error('请先读取设置')
      if (busy.value) throw new Error('正在保存，请稍后再试')
      const value = draft.value
      const changes: SettingsChanges =
        module === 'organization'
          ? { departments: value.departments, users: value.users, roles: value.roles }
          : module === 'permissions'
            ? { roles: value.roles }
            : module === 'menus'
              ? { groups: value.groups, pages: value.pages, roles: value.roles }
              : { form: value.form }
      busy.value = true
      try {
        apply(await saveSettingsApi(module, changes, state.value.revision))
      } finally {
        busy.value = false
      }
    }
    /** 删除未引用成员并应用服务端结果，阻止覆盖当前未保存的编辑。
     * @param id 成员ID
     */
    async function removeMember(id: string): Promise<void> {
      if (!state.value) throw new Error('请先读取人员数据')
      if (busy.value) throw new Error('正在提交，请稍后再试')
      if (dirty.value) throw new Error('请先保存或重新读取当前修改，再删除成员')
      busy.value = true
      try {
        apply(await deleteMemberApi(id, state.value.revision))
      } finally {
        busy.value = false
      }
    }
    /** 提交批量操作，使用服务端修订号防止覆盖未保存或并发修改。
     * @param action 删除、启用或停用
     * @param ids 所选成员ID
     */
    async function batchMembers(action: MemberBatchAction, ids: string[]): Promise<void> {
      if (!state.value) throw new Error('请先读取人员数据')
      if (busy.value) throw new Error('正在提交，请稍后再试')
      if (dirty.value) throw new Error('请先保存或重新读取当前修改，再批量操作')
      busy.value = true
      try {
        apply(await batchMembersApi(action, ids, state.value.revision))
      } finally {
        busy.value = false
      }
    }
    /** 退出登录时清理设置，避免跨账号泄露。 */
    function reset(): void {
      state.value = null
      draft.value = null
    }
    return { state, draft, busy, dirty, load, update, save, removeMember, batchMembers, reset }
  }
)
