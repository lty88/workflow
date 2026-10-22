<script setup lang="tsx">
import { computed } from 'vue';
import { NCheckbox, NFormItem, NSelect } from 'naive-ui';
import { SHARED_ACCESS } from '@workflow/domain';
import type { DataAccessRule } from '@workflow/domain';
import type { AccessRuleEditorProps } from './types';
import { clone } from '@/composables/format';
const props = defineProps<AccessRuleEditorProps>();
const emit = defineEmits<{ 'update:modelValue': [value: DataAccessRule | undefined] }>();
const rule = computed(() => props.modelValue || props.fallback || SHARED_ACCESS);
const mode = computed(() => (!props.modelValue && props.inherit ? 'inherit' : rule.value.mode));
const choices = computed(() => [
  ...(props.inherit ? [{ label: props.inheritLabel || '继承查看范围', value: 'inherit' }] : []),
  { label: '活动内共享', value: 'shared' },
  { label: '指定授权', value: 'restricted' },
]);
const roles = computed(() => props.config.roles.map(option));
const users = computed(() => props.config.users.map(option));
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
  };
}
/**
 * 切换共享、指定授权或继承模式，默认保留必要的节点受理人访问。
 * @param value 新模式
 */
function changeMode(value: string): void {
  if (props.disabled) return;
  if (value === 'inherit') {
    emit('update:modelValue', undefined);
    return;
  }
  if (value !== 'shared' && value !== 'restricted') return;
  emit('update:modelValue', {
    ...clone(rule.value),
    mode: value,
    ...(props.node ? { nodeAssignees: props.forceNodeAssignees || rule.value.nodeAssignees || false } : {}),
  });
}
/**
 * 更新受众选项，不直接修改父组件草稿。
 * @param key 授权属性
 * @param value 新值
 */
function update<K extends keyof DataAccessRule>(key: K, value: DataAccessRule[K]): void {
  if (!props.disabled) emit('update:modelValue', { ...clone(rule.value), [key]: value });
}
</script>
<template>
  <section class="access-rule-editor">
    <NFormItem :label="label"
      ><NSelect :value="mode" :options="choices" :disabled="disabled" @update:value="changeMode"
    /></NFormItem>
    <div v-if="mode === 'restricted'" class="access-audience">
      <p>在可访问本活动的人员中，允许以下受众访问：</p>
      <div class="access-identities">
        <NCheckbox
          v-if="node"
          :checked="forceNodeAssignees || !!rule.nodeAssignees"
          :disabled="disabled || forceNodeAssignees"
          @update:checked="update('nodeAssignees', $event)"
          >本节点当前受理人</NCheckbox
        >
        <NCheckbox
          :checked="!!rule.applicant"
          :disabled="disabled"
          @update:checked="update('applicant', $event)"
          >申请人</NCheckbox
        >
        <NCheckbox
          :checked="!!rule.departmentManager"
          :disabled="disabled"
          @update:checked="update('departmentManager', $event)"
          >申请部门负责人</NCheckbox
        >
        <NCheckbox
          :checked="!!rule.executor"
          :disabled="disabled"
          @update:checked="update('executor', $event)"
          >活动执行负责人</NCheckbox
        >
      </div>
      <NFormItem label="指定角色"
        ><NSelect
          :value="rule.roleIds"
          :options="roles"
          multiple
          filterable
          clearable
          :disabled="disabled"
          placeholder="例如财务、分管领导"
          @update:value="update('roleIds', $event)"
      /></NFormItem>
      <NFormItem label="指定人员"
        ><NSelect
          :value="rule.userIds"
          :options="users"
          multiple
          filterable
          clearable
          :disabled="disabled"
          placeholder="可按姓名搜索"
          @update:value="update('userIds', $event)"
      /></NFormItem>
    </div>
    <p v-else class="access-hint">
      {{
        mode === 'inherit'
          ? '随查看权限变化；节点和文件的约束会同时执行。'
          : '对有权查看本活动的人员开放，不会扩大活动访问范围。'
      }}
    </p>
  </section>
</template>
<style scoped>
.access-audience {
  padding: 12px 12px 0;
  margin: -4px 0 18px;
  border: 1px solid #e2e9f4;
  border-radius: 8px;
  background: #f9fbff;
}
.access-audience > p,
.access-hint {
  margin: 0 0 12px;
  color: #718098;
  font-size: 12px;
  line-height: 1.7;
}
.access-identities {
  display: grid;
  gap: 10px;
  margin-bottom: 18px;
}
.access-hint {
  margin: -8px 0 18px;
}
</style>
