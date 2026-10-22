<script setup lang="tsx">
import { computed, ref } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import {
  NAlert,
  NButton,
  NCard,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSwitch,
  NTag,
  NPopconfirm,
} from 'naive-ui';
import { PAGE_COMPONENTS } from '@workflow/domain';
import type { CompanyConfig, MenuGroup, PageDefinition, Role } from '@workflow/domain';
import type { ConfigPanelProps } from './types';
import { clone, newId } from '@/composables/format';
import { useFeedback } from '@/composables/use-feedback';
const props = defineProps<ConfigPanelProps>();
const emit = defineEmits<{ 'update:modelValue': [value: CompanyConfig] }>();
const feedback = useFeedback();
const mobile = useMediaQuery('(max-width: 850px)');
const page = ref<PageDefinition | null>(null);
const open = ref(false);
const pageRoles = ref<string[]>([]);
const group = ref<MenuGroup | null>(null);
const groupOpen = ref(false);
const components = Object.entries(PAGE_COMPONENTS).map(componentOption);
const groups = computed(() => props.modelValue.groups.map(option));
const roles = computed(() => props.modelValue.roles.map(option));
/**
 * 转换页面模板选项。
 * @param entry 模板键值
 * @returns 下拉项
 */
function componentOption(entry: [string, { label: string }]): { label: string; value: string } {
  return { label: entry[1].label, value: entry[0] };
}
/**
 * 转换分组或角色选项。
 * @param item 配置项
 * @returns 下拉项
 */
function option(item: { id: string; name: string }): { label: string; value: string } {
  return { label: item.name, value: item.id };
}
/**
 * 编辑动态页面和角色授权。
 * @param item 已有页面
 */
function edit(item?: PageDefinition): void {
  page.value = item
    ? clone(item)
    : {
        id: newId('p'),
        name: '',
        component: 'activity_list',
        group: props.modelValue.groups[0]?.id || '',
        active: true,
      };
  pageRoles.value = [];
  for (const role of props.modelValue.roles)
    if (role.pages.includes(page.value.id)) pageRoles.value.push(role.id);
  open.value = true;
}
/**
 * 同时保存页面定义与角色页面授权。
 */
function save(): void {
  if (!page.value || page.value.name.trim().length < 2 || !page.value.group) {
    feedback.failure(new Error('请填写至少2字名称并选择分组'));
    return;
  }
  const next = clone(props.modelValue);
  const item = clone(page.value);
  if (item.component === 'activity_form') item.formId = next.form.id;
  else delete item.formId;
  const index = next.pages.findIndex(
    /**
     * 按当前目标标识查找配置项或参与人。
     * @param candidate 当前集合项
     * @returns 是否符合筛选条件
     */ function match(candidate) {
      return candidate.id === item.id;
    },
  );
  if (index < 0) next.pages.push(item);
  else next.pages[index] = item;
  for (const role of next.roles) {
    role.pages = role.pages.filter(
      /**
       * 保留未被删除或替换的关联标识。
       * @param id 当前集合项
       * @returns 是否符合筛选条件
       */ function other(id) {
        return id !== item.id;
      },
    );
    if (pageRoles.value.includes(role.id)) role.pages.push(item.id);
  }
  emit('update:modelValue', next);
  open.value = false;
}
/**
 * 删除页面及对应角色授权。
 * @param id 页面标识
 */
function remove(id: string): void {
  const next = clone(props.modelValue);
  const index = next.pages.findIndex(
    /**
     * 按当前目标标识查找配置项或参与人。
     * @param item 当前集合项
     * @returns 是否符合筛选条件
     */ function match(item) {
      return item.id === id;
    },
  );
  if (index < 0) return;
  next.pages.splice(index, 1);
  for (const role of next.roles)
    role.pages = role.pages.filter(
      /**
       * 保留未被删除或替换的关联标识。
       * @param key 当前集合项
       * @returns 是否符合筛选条件
       */ function other(key) {
        return key !== id;
      },
    );
  emit('update:modelValue', next);
}
/**
 * 调整菜单的展示顺序。
 * @param index 当前索引
 * @param offset 移动方向
 */
function move(index: number, offset: number): void {
  const next = clone(props.modelValue);
  const target = index + offset;
  if (target < 0 || target >= next.pages.length) return;
  const item = next.pages.splice(index, 1)[0]!;
  next.pages.splice(target, 0, item);
  emit('update:modelValue', next);
}
/**
 * 显示页面已授权的角色名。
 * @param id 页面标识
 * @returns 角色名称
 */
function roleNames(id: string): string {
  const names: string[] = [];
  for (const role of props.modelValue.roles) if (role.pages.includes(id)) names.push(role.name);
  return names.join('、') || '尚未授权';
}
/**
 * 显示分组名称。
 * @param id 分组标识
 * @returns 分组名称
 */
function groupName(id: string): string {
  return (
    props.modelValue.groups.find(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param item 当前集合项
       * @returns 是否符合筛选条件
       */ function match(item) {
        return item.id === id;
      },
    )?.name || '缺失分组'
  );
}
/**
 * 打开菜单分组编辑抽屉。
 * @param item 已有分组
 */
function editGroup(item?: MenuGroup): void {
  group.value = item ? clone(item) : { id: newId('group'), name: '', active: true };
  groupOpen.value = true;
}
/**
 * 保存菜单分组。
 */
function saveGroup(): void {
  if (!group.value || group.value.name.trim().length < 2) {
    feedback.failure(new Error('分组名称至少2字'));
    return;
  }
  const next = clone(props.modelValue);
  const item = clone(group.value);
  const index = next.groups.findIndex(
    /**
     * 按当前目标标识查找配置项或参与人。
     * @param candidate 当前集合项
     * @returns 是否符合筛选条件
     */ function match(candidate) {
      return candidate.id === item.id;
    },
  );
  if (index < 0) next.groups.push(item);
  else next.groups[index] = item;
  emit('update:modelValue', next);
  groupOpen.value = false;
}
</script>
<template>
  <div class="stack">
    <NCard title="菜单分组"
      ><template #header-extra><NButton size="small" @click="editGroup()">＋ 新增分组</NButton></template>
      <div class="gap">
        <NButton v-for="item in modelValue.groups" :key="item.id" @click="editGroup(item)"
          >{{ item.name }}{{ item.active ? '' : ' · 停用' }}</NButton
        >
      </div></NCard
    ><NCard title="动态页面"
      ><template #header-extra
        ><NButton type="primary" size="small" @click="edit()">＋ 新增页面</NButton></template
      ><NAlert type="info" :bordered="false" class="mb"
        >页面绑定内置业务模板，可配置名称、分组、顺序和访问角色。发布后按当前用户授权生成菜单。</NAlert
      >
      <div class="config-list">
        <div v-for="(item, index) in modelValue.pages" :key="item.id" class="config-item">
          <div>
            <strong>{{ item.name }}</strong>
            <NTag size="small" :bordered="false" :type="item.active ? 'info' : 'default'">{{
              item.active ? '启用' : '停用'
            }}</NTag
            ><small
              >{{ groupName(item.group) }} / {{ PAGE_COMPONENTS[item.component].label }} ·
              {{ roleNames(item.id) }}</small
            >
          </div>
          <div class="gap">
            <NButton size="tiny" :disabled="index === 0" @click="move(index, -1)">↑</NButton
            ><NButton size="tiny" :disabled="index === modelValue.pages.length - 1" @click="move(index, 1)"
              >↓</NButton
            ><NButton size="small" text type="primary" @click="edit(item)">编辑</NButton
            ><NPopconfirm @positive-click="remove(item.id)"
              ><template #trigger><NButton size="small" text type="error">删除</NButton></template
              >删除菜单页面并解除角色页面关联？</NPopconfirm
            >
          </div>
        </div>
      </div></NCard
    >
  </div>
  <NDrawer v-model:show="open" :width="mobile ? '100%' : 520"
    ><NDrawerContent title="页面配置" closable
      ><NForm v-if="page" label-placement="top"
        ><NFormItem label="页面名称" required><NInput v-model:value="page.name" :maxlength="50" /></NFormItem
        ><NFormItem label="菜单分组" required
          ><NSelect v-model:value="page.group" :options="groups" /></NFormItem
        ><NFormItem label="业务模板"
          ><NSelect v-model:value="page.component" :options="components" /></NFormItem
        ><NFormItem label="授权角色"
          ><NSelect v-model:value="pageRoles" :options="roles" multiple filterable /></NFormItem
        ><NFormItem label="启用"><NSwitch v-model:value="page.active" /></NFormItem
        ><NAlert type="info">角色还需具备模板对应的业务操作权限；页面授权与业务权限共同生效。</NAlert></NForm
      ><template #footer><NButton type="primary" @click="save">应用到草案</NButton></template></NDrawerContent
    ></NDrawer
  ><NDrawer v-model:show="groupOpen" :width="mobile ? '100%' : 440"
    ><NDrawerContent title="菜单分组" closable
      ><NForm v-if="group" label-placement="top"
        ><NFormItem label="分组名称" required><NInput v-model:value="group.name" :maxlength="50" /></NFormItem
        ><NFormItem label="启用"><NSwitch v-model:value="group.active" /></NFormItem></NForm
      ><template #footer
        ><NButton type="primary" @click="saveGroup">应用到草案</NButton></template
      ></NDrawerContent
    ></NDrawer
  >
</template>
