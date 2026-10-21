<script setup lang="tsx">
import { computed, ref } from 'vue';
import {
  NButton,
  NCard,
  NCheckbox,
  NCheckboxGroup,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NTag,
  NAlert,
  NPopconfirm,
} from 'naive-ui';
import { PERMISSIONS, SCOPES, PAGE_COMPONENTS } from '@workflow/domain';
import type { CompanyConfig, Permission, Role } from '@workflow/domain';
import type { ConfigPanelProps } from './types';
import { clone, newId } from '../../composables/format';
import { useFeedback } from '../../composables/use-feedback';
const props = defineProps<ConfigPanelProps>();
const emit = defineEmits<{ 'update:modelValue': [value: CompanyConfig] }>();
const feedback = useFeedback();
const selected = ref(props.modelValue.roles[0]?.id || '');
const role = computed(() => props.modelValue.roles.find(isSelected));
const scopeOptions = Object.entries(SCOPES).map(scopeOption);
/**
 * 匹配选择的角色。
 * @param item 角色
 * @returns 是否选中
 */
function isSelected(item: Role): boolean {
  return item.id === selected.value;
}
/**
 * 转换数据范围选项。
 * @param pair 范围键值
 * @returns 下拉项
 */
function scopeOption(pair: [string, string]): { label: string; value: string } {
  return { label: pair[1], value: pair[0] };
}
/**
 * 更新当前角色的一项授权属性。
 * @param key 属性
 * @param value 新值
 */
function update<K extends keyof Role>(key: K, value: Role[K]): void {
  const next = clone(props.modelValue);
  const item = next.roles.find(isSelected);
  if (!item) return;
  item[key] = value;
  emit('update:modelValue', next);
}
/**
 * 修改动作权限列表。
 * @param values 权限码
 */
function setPermissions(values: Array<string | number>): void {
  update('permissions', values as Permission[]);
}
/**
 * 修改页面授权列表。
 * @param values 页面标识
 */
function setPages(values: Array<string | number>): void {
  update('pages', values.map(String));
}
/**
 * 新增没有默认授权的角色。
 */
function add(): void {
  const next = clone(props.modelValue);
  const item: Role = { id: newId('role'), name: '新角色', permissions: [], scope: 'self', pages: [] };
  next.roles.push(item);
  selected.value = item.id;
  emit('update:modelValue', next);
}
/**
 * 删除未被成员或流程引用的角色。
 */
function remove(): void {
  const next = clone(props.modelValue);
  for (const user of next.users)
    if (user.roles.includes(selected.value)) {
      feedback.failure(new Error('请先解除该角色的人员关联'));
      return;
    }
  for (const node of next.workflow.nodes)
    if (node.assignee.type === 'role' && node.assignee.value === selected.value) {
      feedback.failure(new Error('请先替换流程中的角色引用'));
      return;
    }
  const index = next.roles.findIndex(isSelected);
  if (index < 0) return;
  next.roles.splice(index, 1);
  selected.value = next.roles[0]?.id || '';
  emit('update:modelValue', next);
}
</script>
<template>
  <div class="config-grid">
    <NCard title="角色列表"
      ><template #header-extra><NButton text type="primary" @click="add">＋ 新增</NButton></template>
      <div class="config-list">
        <button
          v-for="item in modelValue.roles"
          :key="item.id"
          class="config-select"
          :class="{ active: item.id === selected }"
          @click="selected = item.id"
        >
          {{ item.name
          }}<small class="help-text" style="display: block"
            >{{ SCOPES[item.scope] }} · {{ item.permissions.length }}项权限</small
          >
        </button>
      </div></NCard
    ><NCard v-if="role" title="角色授权"
      ><NForm label-placement="top"
        ><NFormItem label="角色名称"
          ><NInput :value="role.name" :maxlength="50" @update:value="update('name', $event)" /></NFormItem
        ><NFormItem label="数据范围"
          ><NSelect
            :value="role.scope"
            :options="scopeOptions"
            @update:value="update('scope', $event)" /></NFormItem
        ><NAlert type="info" :bordered="false" class="mb"
          >多个角色的有效授权取并集。页面可见、动作权限、数据范围和节点受理资格共同决定可操作事项。</NAlert
        ><NFormItem label="操作权限"
          ><NCheckboxGroup :value="role.permissions" @update:value="setPermissions"
            ><div class="editor-grid" style="gap: 14px">
              <NCheckbox
                v-for="(label, key) in PERMISSIONS"
                :key="key"
                :value="key"
                :label="label"
              /></div></NCheckboxGroup></NFormItem
        ><NFormItem label="页面访问授权"
          ><NCheckboxGroup :value="role.pages" @update:value="setPages"
            ><div class="stack" style="gap: 12px">
              <NCheckbox v-for="page in modelValue.pages" :key="page.id" :value="page.id"
                ><span
                  >{{ page.name }}
                  <small class="muted"
                    >需 {{ PERMISSIONS[PAGE_COMPONENTS[page.component].permission] }} 权限{{
                      page.active ? '' : ' · 已停用'
                    }}</small
                  ></span
                ></NCheckbox
              >
            </div></NCheckboxGroup
          ></NFormItem
        ></NForm
      ><NPopconfirm @positive-click="remove"
        ><template #trigger><NButton text type="error">删除当前角色</NButton></template
        >将删除当前草案中的角色；已关联人员或节点时需先解除引用。</NPopconfirm
      ></NCard
    >
  </div>
</template>
