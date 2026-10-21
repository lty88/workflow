<script setup lang="tsx">
import { computed } from 'vue';
import { NFormItem, NSelect } from 'naive-ui';
import type { AssigneeRule } from '@workflow/domain';
import type { AssigneeProps } from './types';
const props = defineProps<AssigneeProps>();
const emit = defineEmits<{ 'update:modelValue': [value: AssigneeRule] }>();
const options = computed(() =>
  props.modelValue.type === 'role'
    ? props.config.roles.map(option)
    : props.config.users.filter(active).map(option),
);
/**
 * 筛选有效成员。
 * @param user 成员
 * @returns 是否启用
 */
function active(user: { active: boolean }): boolean {
  return user.active;
}
/**
 * 转换人员或角色下拉项。
 * @param item 配置项
 * @returns 下拉项
 */
function option(item: { id: string; name: string }): { label: string; value: string } {
  return { label: item.name, value: item.id };
}
/**
 * 切换受理规则并清理失配的引用。
 * @param type 受理方式
 */
function setType(type: AssigneeRule['type']): void {
  emit('update:modelValue', { type, value: '' });
}
/**
 * 设置受理角色或成员标识。
 * @param value 标识
 */
function setValue(value: string): void {
  emit('update:modelValue', { ...props.modelValue, value });
}
</script>
<template>
  <NFormItem label="受理规则"
    ><NSelect
      :value="modelValue.type"
      :options="[
        { label: '申请人所在部门负责人', value: 'manager' },
        { label: '指定角色（所有有效成员）', value: 'role' },
        { label: '指定人员', value: 'user' },
      ]"
      @update:value="setType" /></NFormItem
  ><NFormItem v-if="modelValue.type !== 'manager'" label="受理人 / 角色" required
    ><NSelect :value="modelValue.value || null" :options="options" filterable @update:value="setValue"
  /></NFormItem>
</template>
