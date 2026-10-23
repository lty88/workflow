<script setup lang="tsx">
  import { computed, ref, watch } from 'vue'
  import { NButton, NCard, NCheckbox, NEmpty, NInput, NTag } from 'naive-ui'
  import type { Member } from '@workflow/domain'
  import type { OrganizationMembersProps } from './types'
  import { useAuthStore } from '@/stores/auth'
  import { useFeedback } from '@/composables/use-feedback'
  import MemberDeleteButton from './MemberDeleteButton.vue'
  import MemberBatchActions from './MemberBatchActions.vue'
  const props = defineProps<OrganizationMembersProps>()
  const emit = defineEmits<{ add: []; edit: [member: Member]; password: [member: Member]; 'update:query': [value: string] }>()
  const auth = useAuthStore()
  const feedback = useFeedback()
  const checked = ref<string[]>([])
  const eligible = computed(() => props.members.filter(selectable))
  const allChecked = computed(() => !!eligible.value.length && checked.value.length === eligible.value.length)
  const indeterminate = computed(() => checked.value.length > 0 && !allChecked.value)
  /** 仅允许勾选非当前账号与非初始管理员，避免误批量停用。
   * @param member 列表成员
   * @returns 是否允许进入批量操作
   */
  function selectable(member: Member): boolean {
    return member.id !== auth.profile?.user.id && member.id !== 'u-admin' && member.username !== 'admin'
  }
  /** 给出被保护账号的不可选原因。
   * @param member 列表成员
   * @returns 悬浮提示
   */
  function selectionHint(member: Member): string {
    return selectable(member) ? '选择 ' + member.name : '当前账号和初始管理员不参与批量操作'
  }
  /** 勾选单人，单次最多200人。
   * @param id 人员ID
   * @param value 是否选中
   */
  function toggle(id: string, value: boolean): void {
    if (!auth.can('config:manage') || props.saving) return
    if (value && !checked.value.includes(id)) {
      if (checked.value.length >= 200) {
        feedback.failure(new Error('单次最多选择200人，请缩小筛选范围'))
        return
      }
      checked.value = [...checked.value, id]
    } else if (!value) checked.value = checked.value.filter(keepOther)
    /** 移除取消勾选的人。
     * @param existing 已勾选ID
     * @returns 是否保留
     */
    function keepOther(existing: string): boolean {
      return existing !== id
    }
  }
  /** 全选当前筛选结果中的可选成员，最多200人。
   * @param value 是否全选
   */
  function toggleAll(value: boolean): void {
    if (!auth.can('config:manage') || props.saving) return
    checked.value = value ? eligible.value.slice(0, 200).map(memberId) : []
  }
  /** 提取稳定成员ID。
   * @param member 人员
   * @returns 人员ID
   */
  function memberId(member: Member): string {
    return member.id
  }
  /** 筛选、刷新或批量成功后清空选择，避免操作隐藏成员。 */
  function clear(): void {
    checked.value = []
  }
  /** 返回人员所属部门名称。
   * @param member 人员
   * @returns 部门名
   */
  function departmentName(member: Member): string {
    return props.config.departments.find(matches)?.name || '未设置'
    /** 匹配人员主部门。
     * @param department 部门
     * @returns 是否同部门
     */
    function matches(department: OrganizationMembersProps['config']['departments'][number]): boolean {
      return department.id === member.department
    }
  }
  /** 返回人员角色名称。
   * @param member 人员
   * @returns 角色说明
   */
  function roleNames(member: Member): string {
    const names: string[] = []
    for (const role of props.config.roles) if (member.roles.includes(role.id)) names.push(role.name)
    return names.join('、') || '未分配角色'
  }
  watch(() => props.members, clear)
</script>
<template>
  <NCard :title="title">
    <template #header-extra>
      <NButton v-if="auth.can('config:manage')" type="primary" size="small" :disabled="saving" @click="emit('add')">＋ 新增成员</NButton>
    </template>
    <NInput :value="query" placeholder="搜索姓名或登录账号" clearable class="mb" :disabled="saving" @update:value="emit('update:query', $event)" />
    <div v-if="auth.can('config:manage')" class="member-batch-toolbar">
      <div class="member-selection">
        <NCheckbox :checked="allChecked" :indeterminate="indeterminate" :disabled="!eligible.length || saving" @update:checked="toggleAll">
          全选当前可选成员
        </NCheckbox>
        <span>已选 {{ checked.length }} 人 · 当前 {{ members.length }} 人</span>
      </div>
      <MemberBatchActions :selected="checked" :members="members" :saving="saving" :run="batchMembers" @clear="clear" />
      <small>仅处理当前筛选范围，每批最多200人；切换部门或搜索条件后清空勾选。</small>
    </div>
    <div class="config-list">
      <div v-for="user in members" :key="user.id" class="config-item member-row">
        <NCheckbox
          v-if="auth.can('config:manage')"
          :checked="checked.includes(user.id)"
          :disabled="saving || !selectable(user)"
          :title="selectionHint(user)"
          :aria-label="'选择 ' + user.name"
          @update:checked="toggle(user.id, $event)"
        />
        <div class="member-info">
          <strong>{{ user.name }}</strong>
          <NTag size="small" :bordered="false" :type="user.active ? 'success' : 'default'">{{ user.active ? '启用' : '停用' }}</NTag>
          <small>
            {{ user.username }} · {{ departmentName(user) }}
            <br />
            {{ roleNames(user) }}
          </small>
        </div>
        <div v-if="auth.can('config:manage')" class="gap member-actions">
          <NButton size="small" text type="primary" :disabled="saving" @click="emit('edit', user)">编辑</NButton>
          <NButton size="small" text :disabled="saving" @click="emit('password', user)">设置密码</NButton>
          <MemberDeleteButton :member="user" :saving="saving" :remove="removeMember" />
        </div>
      </div>
    </div>
    <NEmpty v-if="!members.length" description="当前筛选条件下暂无成员" />
  </NCard>
</template>
<style scoped>
  .member-batch-toolbar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    margin-bottom: 16px;
    background: #f5f8fe;
    border: 1px solid #e1e9f6;
    border-radius: 10px;
  }
  .member-selection {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .member-selection span,
  .member-batch-toolbar small {
    font-size: 13px;
    color: #6d7f99;
    line-height: 1.6;
  }
  .member-row {
    justify-content: flex-start;
    gap: 14px;
  }
  .member-info {
    min-width: 0;
    flex: 1;
  }
  .member-info small {
    display: block;
    overflow-wrap: anywhere;
  }
  .member-actions {
    flex-shrink: 0;
  }
  @media (max-width: 850px) {
    .member-row {
      flex-wrap: wrap;
    }
    .member-actions {
      margin-left: 32px;
    }
  }
</style>
