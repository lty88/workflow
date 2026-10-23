<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NAlert, NButton, NModal, NSpace } from 'naive-ui'
  import type { MemberBatchAction } from '@/typings/api/settings'
  import type { MemberBatchActionsProps } from './types'
  import { useAuthStore } from '@/stores/auth'
  import { errorMessages } from '@/api/http'
  const props = defineProps<MemberBatchActionsProps>()
  const emit = defineEmits<{ clear: [] }>()
  const auth = useAuthStore()
  const open = ref(false)
  const pending = ref(false)
  const action = ref<MemberBatchAction>('enable')
  const ids = ref<string[]>([])
  const errors = ref<string[]>([])
  const labels: Record<MemberBatchAction, string> = { delete: '删除', enable: '启用', disable: '停用' }
  const names = computed(() => props.members.filter(included).slice(0, 5).map(memberName).join('、'))
  /** 查找本次确认弹窗中固定选择的人员。
   * @param member 当前人员
   * @returns 是否属于此次提交
   */
  function included(member: MemberBatchActionsProps['members'][number]): boolean {
    return ids.value.includes(member.id)
  }
  /** 生成用户可以核对的姓名和账号。
   * @param member 待处理人员
   * @returns 姓名与账号
   */
  function memberName(member: MemberBatchActionsProps['members'][number]): string {
    return `${member.name}（${member.username}）`
  }
  /** 打开确认弹窗并固定选择，防止确认时选中范围发生变化。
   * @param value 批量操作类型
   */
  function confirm(value: MemberBatchAction): void {
    if (!auth.can('config:manage') || props.saving || pending.value || !props.selected.length || !props.run) return
    ids.value = [...props.selected]
    action.value = value
    errors.value = []
    open.value = true
  }
  /** 提交整批修改；接口返回任何错误时保留弹窗和选择，展示具体原因。
   * @returns 是否允许关闭确认弹窗
   */
  async function submit(): Promise<boolean> {
    if (!auth.can('config:manage') || props.saving || pending.value || !props.run) return false
    pending.value = true
    errors.value = []
    try {
      await props.run(action.value, ids.value)
      open.value = false
      emit('clear')
      return true
    } catch (error) {
      errors.value = errorMessages(error)
      return false
    } finally {
      pending.value = false
    }
  }
</script>
<template>
  <NSpace v-if="auth.can('config:manage')" :size="8">
    <NButton size="small" :disabled="!selected.length || saving || pending || !run" @click="confirm('enable')">批量启用</NButton>
    <NButton size="small" :disabled="!selected.length || saving || pending || !run" @click="confirm('disable')">批量停用</NButton>
    <NButton size="small" type="error" ghost :disabled="!selected.length || saving || pending || !run" @click="confirm('delete')">批量删除</NButton>
    <NButton v-if="selected.length" size="small" quaternary :disabled="saving || pending" @click="emit('clear')">取消选择</NButton>
  </NSpace>
  <NModal
    v-model:show="open"
    preset="dialog"
    :title="'确认批量' + labels[action]"
    :type="action === 'delete' ? 'error' : 'warning'"
    :positive-text="'确认' + labels[action] + ' ' + ids.length + ' 人'"
    negative-text="取消"
    :loading="pending"
    :closable="!pending"
    :mask-closable="!pending"
    :close-on-esc="!pending"
    :negative-button-props="{ disabled: pending }"
    @positive-click="submit"
  >
    <div class="batch-confirm">
      <p>
        本次将{{ labels[action] }}
        <strong>{{ ids.length }}</strong>
        名成员：
      </p>
      <p class="batch-names">{{ names }}{{ ids.length > 5 ? '等' : '' }}</p>
      <NAlert :type="action === 'delete' ? 'warning' : 'info'" :bordered="false">
        {{
          action === 'delete'
            ? '永久删除未引用的账号；负责人和有业务历史的成员需先处理关联。'
            : action === 'disable'
              ? '停用后撤销登录会话，待办保留；部门负责人需先交接。'
              : '只启用所选账号，不修改其密码、角色或所属部门；部门停用时仍无法登录。'
        }}
        <br />
        任意成员校验失败，整批不会执行。
      </NAlert>
      <NAlert v-if="errors.length" type="error" title="本批次未执行" class="batch-errors">
        <ul>
          <li v-for="error in errors" :key="error">{{ error }}</li>
        </ul>
      </NAlert>
    </div>
  </NModal>
</template>
<style scoped>
  .batch-confirm {
    font-size: 14px;
    line-height: 1.8;
  }
  .batch-names {
    color: #65758d;
    overflow-wrap: anywhere;
  }
  .batch-errors {
    margin-top: 14px;
    max-height: 260px;
    overflow: auto;
  }
  .batch-errors ul {
    margin: 0;
    padding-left: 20px;
  }
</style>
