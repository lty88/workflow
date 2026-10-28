<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import type { VNodeChild } from 'vue'
  import { useRouter } from 'vue-router'
  import { useWindowSize } from '@vueuse/core'
  import { NButton, NDropdown } from 'naive-ui'
  import type { DropdownRenderOption, DropdownOption } from 'naive-ui'
  import { APP_PATHS, menuDestination } from '@/navigation'
  import { useAuthStore } from '@/stores/auth'
  import { useFeedback } from '@/composables/use-feedback'
  import type { CreationKind, CreationMenuProps } from './types'
  const props = withDefaults(defineProps<CreationMenuProps>(), { appearance: 'button' })
  const emit = defineEmits<{ navigate: [] }>()
  const auth = useAuthStore()
  const router = useRouter()
  const feedback = useFeedback()
  const { width } = useWindowSize()
  const open = ref(false)
  const navigating = ref(false)
  const allowed = computed(() => auth.can('activity:create') && auth.can('activity:read'))
  const unavailable = computed(() => !!props.disabled || navigating.value || !allowed.value)
  const menuWidth = computed(() => Math.min(350, Math.max(240, width.value - 32)))
  const choices: Array<DropdownOption | DropdownRenderOption> = [
    { key: 'heading', type: 'render', render: renderHeading },
    { key: 'activity', label: '活动申请' },
    { key: 'general', label: '通用审批' },
  ]
  /** 为所有发起入口提供一致的类型说明，避免把业务类型与活动分类混在一起。
   * @returns 下拉菜单标题与提示
   */
  function renderHeading(): VNodeChild {
    return (
      <div class="creation-menu-heading">
        <strong>选择申请类型</strong>
        <span>选择后进入对应表单与流程模板</span>
      </div>
    )
  }
  /** 使用不同图标与颜色标识两类业务，标签保持可被键盘与读屏识别。
   * @param option 当前业务菜单项
   * @returns 带业务图标、名称和用途说明的选项
   */
  function renderLabel(option: DropdownOption): VNodeChild {
    const activity = option.key === 'activity'
    return (
      <div class={['creation-choice', activity ? 'creation-choice--activity' : 'creation-choice--general']}>
        <span class="creation-choice-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            {activity ? (
              <>
                <rect x="4" y="5" width="16" height="15" rx="3" />
                <path d="M8 3v4m8-4v4M4 10h16m-11 4h2m3 0h1m-6 3h2" />
              </>
            ) : (
              <>
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5M9 15l2 2 4-4" />
              </>
            )}
          </svg>
        </span>
        <span class="creation-choice-copy">
          <strong>{activity ? '活动申请' : '通用审批'}</strong>
          <small>{activity ? '填写活动信息与预算，按模板审批办理' : '填写模板专属表单，审批通过后办结'}</small>
        </span>
        <svg class="creation-choice-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </div>
    )
  }
  /** 为挂载到页面外层的菜单添加独立样式，避免影响其他下拉菜单。
   * @returns 菜单容器属性
   */
  function menuProps() {
    return { class: 'creation-menu', 'aria-label': '选择活动申请或通用审批' }
  }
  /** 重新校验发起权限后导航，活动沿用授权菜单入口，通用审批使用独立表单页。
   * @param key 用户选择的业务类型，仅接受内置菜单值
   */
  async function select(key: string | number): Promise<void> {
    if (unavailable.value || (key !== 'activity' && key !== 'general')) return
    const kind: CreationKind = key
    let activityPath = props.activityPath
    if (!activityPath) {
      for (const page of auth.profile?.menus || []) {
        if (page.active && page.component === 'activity_form') {
          activityPath = menuDestination(page)
          break
        }
      }
    }
    navigating.value = true
    open.value = false
    try {
      await router.push(kind === 'general' ? APP_PATHS.requestCreate : activityPath || APP_PATHS.activityCreate)
      emit('navigate')
    } catch (error) {
      feedback.failure(error)
    } finally {
      navigating.value = false
    }
  }
</script>
<template>
  <NDropdown
    v-if="allowed"
    v-model:show="open"
    trigger="click"
    :options="choices"
    :render-label="renderLabel"
    :menu-props="menuProps"
    :width="menuWidth"
    :placement="appearance === 'sidebar' ? 'right-start' : 'bottom-end'"
    :disabled="unavailable"
    @select="select"
  >
    <NButton
      v-if="appearance === 'button'"
      type="primary"
      class="creation-trigger-primary"
      :disabled="unavailable"
      :loading="navigating"
      aria-haspopup="menu"
      :aria-expanded="open"
    >
      <svg class="creation-plus" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
      发起活动
      <svg class="creation-chevron" :class="{ 'is-open': open }" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
        <path d="m5 7.5 5 5 5-5" />
      </svg>
    </NButton>
    <button
      v-else
      type="button"
      :class="['creation-entry', 'creation-entry--' + appearance, { 'is-open': open, 'is-selected': selected }]"
      :disabled="unavailable"
      aria-haspopup="menu"
      :aria-expanded="open"
    >
      <span class="creation-entry-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14" /></svg>
      </span>
      <span class="creation-entry-copy">
        <strong>发起活动</strong>
        <small v-if="appearance === 'shortcut'">选择活动申请或通用审批</small>
      </span>
      <svg class="creation-chevron" :class="{ 'is-open': open }" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
        <path d="m5 7.5 5 5 5-5" />
      </svg>
    </button>
  </NDropdown>
</template>
<style src="./create-request-menu.css"></style>
