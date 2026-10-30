<script setup lang="tsx">
  import { computed, shallowRef, toRaw } from 'vue'
  import { NCheckbox, NFormItem, NSelect } from 'naive-ui'
  import { SHARED_ACCESS, NODE_PRIVATE_ACCESS } from '@workflow/domain'
  import { accessRuleMode } from './access-rule-mode'
  import { accessScopeCopy } from './access-scope-copy'
  import PermissionHint from './PermissionHint.vue'
  import type { DataAccessRule } from '@workflow/domain'
  import type { AccessRuleEditorProps } from './types'
  import { clone } from '@/composables/format'
  const props = defineProps<AccessRuleEditorProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: DataAccessRule | undefined] }>()
  const specificRule = shallowRef<DataAccessRule>()
  const rule = computed(() => props.modelValue || props.fallback || SHARED_ACCESS)
  const mode = computed(() => {
    if (!props.modelValue && props.inherit) return 'inherit'
    if (specificRule.value && toRaw(props.modelValue) === specificRule.value) return 'restricted'
    return accessRuleMode(rule.value, props.node)
  })
  const selectedCopy = computed(() => accessScopeCopy(mode.value, props.node, props.operation, props.inheritedScope))
  const operationLabel = computed(() => props.operation === 'download' ? '下载范围' : props.operation === 'edit' ? '编辑范围' : '谁能查看')
  const choices = computed(() => [
    { label: `${accessScopeCopy('shared', props.node, props.operation).title}（推荐）`, value: 'shared' },
    ...(props.inherit ? [{ label: props.inheritLabel || '沿用查看范围', value: 'inherit' }] : []),
    ...(props.node ? [{ label: '仅本节点办理人', value: 'node_only' }] : []),
    { label: '指定人员或角色', value: 'restricted' },
  ])
  const roles = computed(() => props.config.roles.map(option))
  const users = computed(() => props.config.users.map(option))
  /**
   * 将组织成员或角色转换成授权选项，停用成员保留标识但不可新增选择。
   * @param item 成员或角色
   * @returns 下拉项
   */
  function option(item: { id: string; name: string; active?: boolean }) {
    return {
      label: item.name + (item.active === false ? '（已停用）' : ''),
      value: item.id,
      disabled: item.active === false,
    }
  }
  /**
   * 切换共享、仅本节点、指定人员或继承模式，并保留节点办理人必要资格。
   * @param value 新模式
   */
  function changeMode(value: string): void {
    if (props.disabled) return
    if (value === 'inherit') {
      emit('update:modelValue', undefined)
      return
    }
    if (value === 'node_only' && props.node) {
      emit('update:modelValue', clone(NODE_PRIVATE_ACCESS))
      return
    }
    if (value !== 'shared' && value !== 'restricted') return
    const next: DataAccessRule = {
      ...clone(rule.value),
      mode: value,
      ...(props.node ? { nodeAssignees: props.forceNodeAssignees || rule.value.nodeAssignees || false } : {}),
    }
    specificRule.value = value === 'restricted' ? next : undefined
    emit('update:modelValue', next)
  }
  /**
   * 更新指定受众并保持编辑区域展开，不直接修改父组件草稿。
   * @param key 授权属性
   * @param value 新值
   */
  function update<K extends keyof DataAccessRule>(key: K, value: DataAccessRule[K]): void {
    if (props.disabled) return
    const next = { ...clone(rule.value), [key]: value }
    specificRule.value = next
    emit('update:modelValue', next)
  }
</script>
<template>
  <section class="access-rule-editor">
    <NFormItem>
      <template #label>
        <span class="access-field-label">
          {{ label }}
          <PermissionHint :label="`${label}说明`">
            <p><strong>{{ operationLabel }}：</strong>{{ selectedCopy.audience }}</p>
            <p><strong>适用：</strong>{{ selectedCopy.scenario }}</p>
            <p v-if="node">本节点指资料所属节点，不是整个部门或下一节点。</p>
            <p v-if="mode === 'inherit' && inheritHint">{{ inheritHint }}</p>
            <p>{{ operation === 'edit' ? '编辑仍需申请编辑资格和字段阅读权限。' : '下载还需角色下载权限；独立敏感资料授权仍生效。' }}</p>
          </PermissionHint>
        </span>
      </template>
      <NSelect :value="mode" :options="choices" :disabled="disabled" @update:value="changeMode" />
    </NFormItem>
    <div v-if="mode === 'restricted'" class="access-audience">
      <div class="access-identities">
        <NCheckbox
          v-if="node"
          :checked="forceNodeAssignees || !!rule.nodeAssignees"
          :disabled="disabled || forceNodeAssignees"
          @update:checked="update('nodeAssignees', $event)"
        >
          本节点当前受理人
        </NCheckbox>
        <NCheckbox :checked="!!rule.applicant" :disabled="disabled" @update:checked="update('applicant', $event)">申请人</NCheckbox>
        <NCheckbox :checked="!!rule.departmentManager" :disabled="disabled" @update:checked="update('departmentManager', $event)">申请部门负责人</NCheckbox>
        <NCheckbox :checked="!!rule.executor" :disabled="disabled" @update:checked="update('executor', $event)">活动执行负责人</NCheckbox>
      </div>
      <NFormItem label="指定角色">
        <NSelect
          :value="rule.roleIds"
          :options="roles"
          multiple
          filterable
          clearable
          :disabled="disabled"
          placeholder="例如财务、分管领导"
          @update:value="update('roleIds', $event)"
        />
      </NFormItem>
      <NFormItem label="指定人员">
        <NSelect
          :value="rule.userIds"
          :options="users"
          multiple
          filterable
          clearable
          :disabled="disabled"
          placeholder="可按姓名搜索"
          @update:value="update('userIds', $event)"
        />
      </NFormItem>
    </div>
  </section>
</template>
<style scoped>
  .access-field-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .access-audience {
    padding: 12px 12px 0;
    margin: -4px 0 16px;
    border: 1px solid #e2e9f4;
    border-radius: 8px;
    background: #f9fbff;
  }
  .access-identities {
    display: grid;
    gap: 10px;
    margin-bottom: 18px;
  }
</style>
