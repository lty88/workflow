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
  NTree,
  NEmpty,
} from 'naive-ui';
import type { TreeOption } from 'naive-ui';
import type { CompanyConfig, Department, Member } from '@workflow/domain';
import type { ConfigPanelProps } from './types';
import { setMemberPasswordApi } from '../../api';
import { clone, newId } from '../../composables/format';
import { useFeedback } from '../../composables/use-feedback';
import BusinessGraph from '../graph/BusinessGraph.vue';
import { organizationGraph } from '../graph/models';
import type { GraphSelection } from '../graph/types';
const props = defineProps<ConfigPanelProps>();
const emit = defineEmits<{ 'update:modelValue': [value: CompanyConfig] }>();
const feedback = useFeedback();
const mobile = useMediaQuery('(max-width: 850px)');
const selected = ref('');
const q = ref('');
const dept = ref<Department | null>(null);
const member = ref<Member | null>(null);
const deptOpen = ref(false);
const memberOpen = ref(false);
const passwordOpen = ref(false);
const passwordMember = ref<Member | null>(null);
const password = ref('');
const busy = ref(false);
const newMember = ref(false);
const showMembers = ref(false);
const organization = computed(() => organizationGraph(props.modelValue, showMembers.value));
/**
 * 点击组织图部门时筛选成员，点击成员时进入编辑抽屉。
 * @param selection 图节点选择
 */
function selectGraphNode(selection: GraphSelection): void {
  if (selection.kind === 'department') selected.value = selection.id;
  if (selection.kind === 'member') {
    const user = findMember(selection.id);
    if (user) {
      selected.value = user.department;
      editMember(user);
    }
  }
}
/**
 * 根据稳定标识查找成员。
 * @param id 成员标识
 * @returns 成员配置
 */
function findMember(id: string): Member | undefined {
  for (const user of props.modelValue.users) if (user.id === id) return user;
  return undefined;
}
/**
 * 清除图形和成员列表的部门筛选。
 */
function clearDepartment(): void {
  selected.value = '';
}
const tree = computed(() => buildTree(''));
const departments = computed(() => props.modelValue.departments.map(option));
const roles = computed(() => props.modelValue.roles.map(option));
const members = computed(() => props.modelValue.users.filter(visibleMember));
const managers = computed(() => props.modelValue.users.filter(managerCandidate).map(option));
/**
 * 递归构造有循环保护的组织树。
 * @param parent 上级标识
 * @param visited 已访问标识
 * @returns 组织树节点
 */
function buildTree(parent: string, visited = new Set<string>()): TreeOption[] {
  const result: TreeOption[] = [];
  for (const item of props.modelValue.departments)
    if (item.parent === parent && !visited.has(item.id)) {
      const next = new Set(visited);
      next.add(item.id);
      result.push({
        key: item.id,
        label: item.name + (item.active ? '' : '（停用）'),
        children: buildTree(item.id, next),
      });
    }
  return result;
}
/**
 * 选择部门后限定人员列表。
 * @param keys 所选键
 */
function selectDepartment(keys: Array<string | number>): void {
  selected.value = String(keys[0] || '');
}
/**
 * 转换人员、角色或部门选项。
 * @param item 配置项
 * @returns 下拉项
 */
function option(item: { id: string; name: string }): { label: string; value: string } {
  return { label: item.name, value: item.id };
}
/**
 * 按所属部门及姓名账号筛选成员。
 * @param user 成员
 * @returns 是否可见
 */
function visibleMember(user: Member): boolean {
  return (
    (!selected.value || user.department === selected.value) &&
    (!q.value || (user.name + user.username).toLowerCase().includes(q.value.toLowerCase()))
  );
}
/**
 * 负责人只能从本部门有效成员中选择。
 * @param user 成员
 * @returns 是否候选
 */
function managerCandidate(user: Member): boolean {
  return user.active && user.department === dept.value?.id;
}
/**
 * 返回部门显示名。
 * @param id 部门标识
 * @returns 部门名称
 */
function departmentName(id: string): string {
  return (
    props.modelValue.departments.find(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param item 当前集合项
       * @returns 是否符合筛选条件
       */ function match(item) {
        return item.id === id;
      },
    )?.name || '未设置'
  );
}
/**
 * 返回成员的角色名称。
 * @param user 成员
 * @returns 角色名称
 */
function roleNames(user: Member): string {
  const names: string[] = [];
  for (const role of props.modelValue.roles) if (user.roles.includes(role.id)) names.push(role.name);
  return names.join('、') || '未分配角色';
}
/**
 * 新增或编辑部门。
 * @param item 已有部门
 */
function editDepartment(item?: Department): void {
  dept.value = item
    ? clone(item)
    : { id: newId('dept'), name: '', parent: selected.value || '', manager: '', active: true };
  deptOpen.value = true;
}
/**
 * 编辑当前树选中的部门。
 */
function editSelected(): void {
  const item = props.modelValue.departments.find(
    /**
     * 按当前目标标识查找配置项或参与人。
     * @param candidate 当前集合项
     * @returns 是否符合筛选条件
     */ function match(candidate) {
      return candidate.id === selected.value;
    },
  );
  if (item) editDepartment(item);
}
/**
 * 保存部门配置，循环和负责人引用由发布环节再校验。
 */
function saveDepartment(): void {
  if (!dept.value || dept.value.name.trim().length < 2) {
    feedback.failure(new Error('部门名称至少2字'));
    return;
  }
  if (dept.value.parent === dept.value.id) {
    feedback.failure(new Error('上级部门不能是自身'));
    return;
  }
  const next = clone(props.modelValue);
  const index = next.departments.findIndex(
    /**
     * 按当前目标标识查找配置项或参与人。
     * @param item 当前集合项
     * @returns 是否符合筛选条件
     */ function match(item) {
      return item.id === dept.value?.id;
    },
  );
  if (index < 0) next.departments.push(clone(dept.value));
  else next.departments[index] = clone(dept.value);
  emit('update:modelValue', next);
  deptOpen.value = false;
}
/**
 * 新增或编辑成员，保留已有成员稳定标识。
 * @param item 已有成员
 */
function editMember(item?: Member): void {
  newMember.value = !item;
  member.value = item
    ? clone(item)
    : {
        id: newId('u'),
        name: '',
        username: '',
        department: selected.value || props.modelValue.departments[0]?.id || '',
        roles: [],
        active: true,
      };
  memberOpen.value = true;
}
/**
 * 校验登录账号后保存成员草案。
 */
function saveMember(): void {
  const item = member.value;
  if (!item || item.name.trim().length < 2 || !/^[a-zA-Z0-9_.-]{3,50}$/.test(item.username)) {
    feedback.failure(new Error('请填写至少2字姓名和3至50位有效登录账号'));
    return;
  }
  for (const user of props.modelValue.users)
    if (user.id !== item.id && user.username === item.username) {
      feedback.failure(new Error('登录账号已存在'));
      return;
    }
  const next = clone(props.modelValue);
  const index = next.users.findIndex(
    /**
     * 按当前目标标识查找配置项或参与人。
     * @param user 当前集合项
     * @returns 是否符合筛选条件
     */ function match(user) {
      return user.id === item.id;
    },
  );
  if (index < 0) next.users.push(clone(item));
  else next.users[index] = clone(item);
  emit('update:modelValue', next);
  memberOpen.value = false;
}
/**
 * 打开已发布成员的密码设置抽屉。
 * @param item 成员
 */
function openPassword(item: Member): void {
  passwordMember.value = item;
  password.value = '';
  passwordOpen.value = true;
}
/**
 * 调用真实密码接口，立即撤销该成员旧会话。
 */
async function savePassword(): Promise<void> {
  if (!passwordMember.value || password.value.length < 12) {
    feedback.failure(new Error('密码至少12位'));
    return;
  }
  busy.value = true;
  try {
    await setMemberPasswordApi(passwordMember.value.id, password.value);
    feedback.success('密码已设置，旧会话已撤销');
    passwordOpen.value = false;
    password.value = '';
  } catch (error) {
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <NCard title="组织架构图 · G6" class="mb"
    ><template #header-extra
      ><div class="gap">
        <span class="help-text">显示成员节点</span
        ><NSwitch v-model:value="showMembers" size="small" /></div></template
    ><BusinessGraph
      :model="organization"
      :selected-key="selected ? 'dept:' + selected : ''"
      :height="mobile ? 360 : 440"
      label="公司部门与成员组织架构图"
      @select="selectGraphNode"
      @clear="clearDepartment"
  /></NCard>
  <div class="config-grid">
    <NCard title="组织架构"
      ><template #header-extra
        ><NButton text type="primary" @click="editDepartment()">＋ 部门</NButton></template
      ><NButton size="small" quaternary class="mb" @click="selected = ''">查看全部成员</NButton
      ><NTree
        :data="tree"
        default-expand-all
        :selected-keys="selected ? [selected] : []"
        block-line
        @update:selected-keys="selectDepartment"
      /><NButton v-if="selected" size="small" class="mb" style="margin-top: 20px" @click="editSelected"
        >编辑所选部门</NButton
      >
      <p class="help-text">部门可停用。已有人员使用停用保留历史身份。</p></NCard
    ><NCard :title="selected ? departmentName(selected) + ' · 成员' : '全部成员'"
      ><template #header-extra
        ><NButton type="primary" size="small" @click="editMember()">＋ 新增成员</NButton></template
      ><NInput v-model:value="q" placeholder="搜索姓名或登录账号" clearable class="mb" />
      <div class="config-list">
        <div v-for="user in members" :key="user.id" class="config-item">
          <div>
            <strong>{{ user.name }}</strong>
            <NTag size="small" :bordered="false" :type="user.active ? 'success' : 'default'">{{
              user.active ? '启用' : '停用'
            }}</NTag
            ><small
              >{{ user.username }} · {{ departmentName(user.department) }}<br />{{ roleNames(user) }}</small
            >
          </div>
          <div class="gap">
            <NButton size="small" text type="primary" @click="editMember(user)">编辑</NButton
            ><NButton size="small" text @click="openPassword(user)">设置密码</NButton>
          </div>
        </div>
      </div>
      <NEmpty v-if="!members.length" description="当前部门暂无成员"
    /></NCard>
  </div>
  <NDrawer v-model:show="deptOpen" :width="mobile ? '100%' : 500"
    ><NDrawerContent title="部门配置" closable
      ><NForm v-if="dept" label-placement="top"
        ><NFormItem label="部门名称" required><NInput v-model:value="dept.name" :maxlength="60" /></NFormItem
        ><NFormItem label="上级部门"
          ><NSelect
            v-model:value="dept.parent"
            :options="[{ label: '无（顶级部门）', value: '' }, ...departments]" /></NFormItem
        ><NFormItem label="部门负责人"
          ><NSelect
            v-model:value="dept.manager"
            :options="[{ label: '暂不设置', value: '' }, ...managers]"
            filterable /></NFormItem
        ><NFormItem label="启用"><NSwitch v-model:value="dept.active" /></NFormItem
        ><NAlert type="info">先建立部门并添加成员，再将本部门有效成员设为负责人。</NAlert></NForm
      ><template #footer
        ><NButton type="primary" @click="saveDepartment">应用到草案</NButton></template
      ></NDrawerContent
    ></NDrawer
  ><NDrawer v-model:show="memberOpen" :width="mobile ? '100%' : 500"
    ><NDrawerContent :title="newMember ? '新增成员' : '编辑成员'" closable
      ><NForm v-if="member" label-placement="top"
        ><NFormItem label="姓名" required><NInput v-model:value="member.name" :maxlength="50" /></NFormItem
        ><NFormItem label="登录账号" required
          ><NInput
            v-model:value="member.username"
            :maxlength="50"
            placeholder="英文、数字、下划线、点或连字符" /></NFormItem
        ><NFormItem label="主部门" required
          ><NSelect v-model:value="member.department" :options="departments" filterable /></NFormItem
        ><NFormItem label="角色"
          ><NSelect v-model:value="member.roles" :options="roles" multiple filterable /></NFormItem
        ><NFormItem label="启用"><NSwitch v-model:value="member.active" /></NFormItem
        ><NAlert type="info"
          >新成员需先发布配置，再设置登录密码。停用后现有待办保留，重新分配前无法由该成员办理。</NAlert
        ></NForm
      ><template #footer
        ><NButton type="primary" @click="saveMember">应用到草案</NButton></template
      ></NDrawerContent
    ></NDrawer
  ><NDrawer v-model:show="passwordOpen" :width="mobile ? '100%' : 460"
    ><NDrawerContent title="设置成员密码" closable
      ><NAlert type="warning" class="mb"
        >立即修改 {{ passwordMember?.name }} 的登录密码并撤销旧会话。新成员需先完成配置发布。</NAlert
      ><NInput
        v-model:value="password"
        type="password"
        show-password-on="click"
        autocomplete="new-password"
        placeholder="至少12位"
      /><template #footer
        ><NButton type="primary" :loading="busy" @click="savePassword">立即设置密码</NButton></template
      ></NDrawerContent
    ></NDrawer
  >
</template>
