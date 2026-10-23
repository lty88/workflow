<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NButton, NPopconfirm } from 'naive-ui'
  import type { MemberDeleteButtonProps } from './types'
  import { useAuthStore } from '@/stores/auth'
  import { useFeedback } from '@/composables/use-feedback'
  const props = defineProps<MemberDeleteButtonProps>()
  const auth = useAuthStore()
  const feedback = useFeedback()
  const pending = ref(false)
  const protectedReason = computed(() =>
    props.member.id === auth.profile?.user.id
      ? '不能删除当前登录账号'
      : props.member.id === 'u-admin' || props.member.username === 'admin'
        ? '初始管理员不能删除'
        : ''
  )
  /** 管理员确认后调用父页面删除接口，失败时保留弹层并显示业务引用原因。
   * @returns 是否关闭删除确认弹层
   */
  async function remove(): Promise<boolean> {
    if (!auth.can('config:manage') || protectedReason.value || pending.value || props.saving || !props.remove) return false
    pending.value = true
    try {
      await props.remove(props.member.id)
      return true
    } catch (error) {
      feedback.failure(error)
      return false
    } finally {
      pending.value = false
    }
  }
</script>
<template>
  <NPopconfirm
    v-if="auth.can('config:manage')"
    :disabled="!!protectedReason || saving || pending || !props.remove"
    positive-text="确认删除"
    negative-text="取消"
    @positive-click="remove"
  >
    <template #trigger>
      <NButton
        size="small"
        text
        type="error"
        :title="protectedReason || '删除未使用的成员'"
        :disabled="!!protectedReason || saving || pending || !props.remove"
        :loading="pending"
      >
        删除
      </NButton>
    </template>
    <div style="max-width: 320px; font-size: 14px; line-height: 1.8">
      永久删除 {{ member.name }}（{{ member.username }}）？
      <br />
      仅未被业务引用的成员可删除；有关联时会提示原因。已有业务历史请使用“编辑 → 停用”。
    </div>
  </NPopconfirm>
</template>
