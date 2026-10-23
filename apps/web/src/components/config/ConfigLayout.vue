<script setup lang="tsx">
  import { computed, onMounted, ref } from 'vue'
  import { RouterLink, useRoute, onBeforeRouteLeave } from 'vue-router'
  import { NAlert, NButton, NCard, NPopconfirm, NSpin, NTag } from 'naive-ui'
  import type { CompanyConfig } from '@workflow/domain'
  import type { SettingsModule, MemberBatchAction } from '@/typings/api/settings'
  import { SETTINGS_TABS } from '@/navigation'
  import type { ConfigSlot } from './types'
  import { useConfigStore } from '@/stores/config'
  import { useAuthStore } from '@/stores/auth'
  import { useFeedback } from '@/composables/use-feedback'
  const props = defineProps<{ independent?: boolean }>()
  defineSlots<{ default(props: ConfigSlot): unknown }>()
  const store = useConfigStore()
  const auth = useAuthStore()
  const feedback = useFeedback()
  const route = useRoute()
  const errorText = ref('')
  const module = computed(() => route.path.split('/').at(-1) as SettingsModule)
  const editable = computed(() => !props.independent && ['organization', 'permissions', 'menus', 'forms'].includes(module.value))
  const labels = { organization: '组织与人员', permissions: '角色权限', menus: '菜单页面', forms: '表单' }
  /** 请求数据库实时设置，丢弃本地编辑副本。 */
  async function load(): Promise<void> {
    try {
      await store.load()
      errorText.value = ''
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : '读取失败'
      feedback.failure(error)
    }
  }
  /** 进入设置页面时重新读取主表，避免显示上次页面缓存。 */
  async function initialize(): Promise<void> {
    await load()
  }
  /** 提交当前模块并刷新身份和菜单，保存成功后立即生效。 */
  async function submit(): Promise<void> {
    await store.save(module.value)
    await auth.restore()
    feedback.success('已保存并生效')
  }
  /** 提交编辑副本并向抽屉返回保存结果，失败时由抽屉保持打开。
   * @param value 当前模块修改后的上下文
   */
  async function persist(value: CompanyConfig): Promise<void> {
    store.update(value)
    await submit()
  }
  /** 页面保存按钮提交模块并展示接口错误。 */
  async function save(): Promise<void> {
    if (!auth.can('config:manage')) return
    try {
      await submit()
    } catch (error) {
      feedback.failure(error)
    }
  }
  /** 管理员直接提交成员删除，成功后实时刷新列表与图形。
   * @param id 成员稳定ID
   */
  async function removeMember(id: string): Promise<void> {
    if (!auth.can('config:manage')) throw new Error('无成员删除权限')
    await store.removeMember(id)
    feedback.success('成员已永久删除')
  }
  /** 管理员提交所选成员批量操作，成功后实时更新主数据。
   * @param action 删除、启用或停用
   * @param ids 所选成员ID
   */
  async function batchMembers(action: MemberBatchAction, ids: string[]): Promise<void> {
    if (!auth.can('config:manage')) throw new Error('无成员批量管理权限')
    await store.batchMembers(action, ids)
    feedback.success(`批量${action === 'delete' ? '删除' : action === 'enable' ? '启用' : '停用'}完成，共${ids.length}名成员`)
  }
  /** 防止切换模块时静默丢弃本地修改。
   * @returns 是否允许离开
   */
  function canLeave(): boolean {
    return props.independent || !store.dirty || window.confirm('还有未保存修改，确认离开并丢弃？')
  }
  onBeforeRouteLeave(canLeave)
  onMounted(initialize)
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <span class="eyebrow">SETTINGS</span>
        <h1>设置中心</h1>
        <p>
          {{
            independent
              ? '流程修改可以单独保存，启用版本后供新申请使用；在途活动保留快照。'
              : '组织、人员、角色和菜单保存即生效；各模块独立提交，无需发布配置。'
          }}
        </p>
      </div>
      <NTag v-if="editable" :type="store.dirty ? 'warning' : 'success'" :bordered="false">{{ store.dirty ? '有未保存修改' : '已与数据库同步' }}</NTag>
    </div>
    <nav class="config-tabs">
      <RouterLink v-for="tab in SETTINGS_TABS" :key="tab.path" :to="tab.path" :class="{ 'router-link-exact-active': route.path === tab.path }">
        {{ tab.name }}
      </RouterLink>
    </nav>
    <NAlert v-if="errorText" type="error" class="mb">
      {{ errorText }}
      <NButton text @click="load">重试</NButton>
    </NAlert>
    <NSpin :show="store.busy">
      <template v-if="store.draft">
        <NAlert v-if="module === 'forms'" type="info" class="mb">
          保存会立即更新当前表单，并自动保留修订记录。已有活动和已启用流程版本的表单快照保持不变；流程采用新表单时需启用新的流程版本。
        </NAlert>
        <slot
          :config="store.draft"
          :update="store.update"
          :persist="persist"
          :saving="store.busy"
          :remove-member="removeMember"
          :batch-members="batchMembers"
        />
        <div v-if="editable" class="sticky-actions">
          <span class="help-text">{{ labels[module] }} · 编辑完成后直接保存，无需发布</span>
          <div class="gap">
            <NPopconfirm @positive-click="load">
              <template #trigger><NButton :disabled="store.busy">重新读取</NButton></template>
              丢弃未保存修改，读取数据库最新数据？
            </NPopconfirm>
            <NButton type="primary" :loading="store.busy" :disabled="!store.dirty" @click="save">保存{{ labels[module] }}</NButton>
          </div>
        </div>
      </template>
      <NCard v-else-if="!store.busy">暂未读取到数据，请确认数据库已初始化。</NCard>
    </NSpin>
  </div>
</template>
