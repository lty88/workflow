<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { useMediaQuery } from '@vueuse/core'
  import { NAlert, NButton, NCard, NDrawer, NDrawerContent, NEmpty, NForm, NFormItem, NInput, NPopover, NSelect, NSwitch, NTag, NPopconfirm } from 'naive-ui'
  import { PAGE_COMPONENTS } from '@workflow/domain'
  import type { CompanyConfig, MenuGroup, PageDefinition } from '@workflow/domain'
  import type { ConfigPanelProps } from './types'
  import { clone, newId } from '@/composables/format'
  import { useFeedback } from '@/composables/use-feedback'
  const props = defineProps<ConfigPanelProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: CompanyConfig] }>()
  const feedback = useFeedback()
  const mobile = useMediaQuery('(max-width: 850px)')
  const keyword = ref('')
  const page = ref<PageDefinition | null>(null)
  const open = ref(false)
  const pageRoles = ref<string[]>([])
  const group = ref<MenuGroup | null>(null)
  const groupOpen = ref(false)
  const components = Object.entries(PAGE_COMPONENTS).map(componentOption)
  const groups = computed(() => props.modelValue.groups.map(option))
  const roles = computed(() => props.modelValue.roles.map(option))
  /**
   * 按名称或分组过滤页面，并保留原始顺序索引供上移下移使用。
   * @returns 页面与原始索引的配对集合
   */
  const visible = computed(() => {
    const key = keyword.value.trim().toLowerCase()
    const entries = props.modelValue.pages.map((item, index) => ({ item, index }))
    if (!key) return entries
    return entries.filter(
      /**
       * 匹配页面名称或所属分组名称。
       * @param entry 页面条目
       * @returns 是否命中关键字
       */ function match(entry) {
        return entry.item.name.toLowerCase().includes(key) || groupName(entry.item.group).toLowerCase().includes(key)
      }
    )
  })
  /**
   * 转换页面模板选项。
   * @param entry 模板键值
   * @returns 下拉项
   */
  function componentOption(entry: [string, { label: string }]): { label: string; value: string } {
    return { label: entry[1].label, value: entry[0] }
  }
  /**
   * 转换分组或角色选项。
   * @param item 配置项
   * @returns 下拉项
   */
  function option(item: { id: string; name: string }): { label: string; value: string } {
    return { label: item.name, value: item.id }
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
        }
    pageRoles.value = []
    for (const role of props.modelValue.roles) if (role.pages.includes(page.value.id)) pageRoles.value.push(role.id)
    open.value = true
  }
  /**
   * 同时保存页面定义与角色页面授权。
   */
  async function save(): Promise<void> {
    if (props.saving) return
    if (!page.value || page.value.name.trim().length < 2 || !page.value.group) {
      feedback.failure(new Error('请填写至少2字名称并选择分组'))
      return
    }
    const next = clone(props.modelValue)
    const item = clone(page.value)
    if (item.component === 'activity_form') item.formId = next.form.id
    else delete item.formId
    const index = next.pages.findIndex(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param candidate 当前集合项
       * @returns 是否符合筛选条件
       */ function match(candidate) {
        return candidate.id === item.id
      }
    )
    if (index < 0) next.pages.push(item)
    else next.pages[index] = item
    for (const role of next.roles) {
      role.pages = role.pages.filter(
        /**
         * 保留未被删除或替换的关联标识。
         * @param id 当前集合项
         * @returns 是否符合筛选条件
         */ function other(id) {
          return id !== item.id
        }
      )
      if (pageRoles.value.includes(role.id)) role.pages.push(item.id)
    }
    try {
      if (props.persist) await props.persist(next)
      else emit('update:modelValue', next)
    } catch (error) {
      feedback.failure(error)
      return
    }
    open.value = false
  }
  /**
   * 提交排序或删除后的配置，优先走自动保存，失败时保留草稿由页面按钮兜底。
   * @param next 修改后的配置
   */
  async function apply(next: CompanyConfig): Promise<void> {
    try {
      if (props.persist) await props.persist(next)
      else emit('update:modelValue', next)
    } catch (error) {
      feedback.failure(error)
    }
  }
  /**
   * 删除页面及对应角色授权。
   * @param id 页面标识
   */
  function remove(id: string): void {
    const next = clone(props.modelValue)
    const index = next.pages.findIndex(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param item 当前集合项
       * @returns 是否符合筛选条件
       */ function match(item) {
        return item.id === id
      }
    )
    if (index < 0) return
    next.pages.splice(index, 1)
    for (const role of next.roles)
      role.pages = role.pages.filter(
        /**
         * 保留未被删除或替换的关联标识。
         * @param key 当前集合项
         * @returns 是否符合筛选条件
         */ function other(key) {
          return key !== id
        }
      )
    void apply(next)
  }
  /**
   * 调整菜单的展示顺序。
   * @param index 当前索引
   * @param offset 移动方向
   */
  function move(index: number, offset: number): void {
    const next = clone(props.modelValue)
    const target = index + offset
    if (target < 0 || target >= next.pages.length) return
    const item = next.pages.splice(index, 1)[0]!
    next.pages.splice(target, 0, item)
    void apply(next)
  }
  /**
   * 获取页面已授权的角色名称集合。
   * @param id 页面标识
   * @returns 角色名称数组
   */
  function rolesFor(id: string): string[] {
    const names: string[] = []
    for (const role of props.modelValue.roles) if (role.pages.includes(id)) names.push(role.name)
    return names
  }
  /**
   * 生成角色授权摘要：最多展示前三个名称，其余折叠为数量。
   * @param id 页面标识
   * @returns 摘要文本
   */
  function roleSummary(id: string): string {
    const names = rolesFor(id)
    if (names.length <= 3) return names.join('、')
    return names.slice(0, 3).join('、') + ' 等 ' + names.length + ' 个角色'
  }
  /**
   * 统计分组下的页面数量。
   * @param id 分组标识
   * @returns 页面数量
   */
  function groupCount(id: string): number {
    let count = 0
    for (const item of props.modelValue.pages) if (item.group === id) count += 1
    return count
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
          return item.id === id
        }
      )?.name || '缺失分组'
    )
  }
  /**
   * 打开菜单分组编辑抽屉。
   * @param item 已有分组
   */
  function editGroup(item?: MenuGroup): void {
    group.value = item ? clone(item) : { id: newId('group'), name: '', active: true }
    groupOpen.value = true
  }
  /**
   * 保存菜单分组。
   */
  async function saveGroup(): Promise<void> {
    if (props.saving) return
    if (!group.value || group.value.name.trim().length < 2) {
      feedback.failure(new Error('分组名称至少2字'))
      return
    }
    const next = clone(props.modelValue)
    const item = clone(group.value)
    const index = next.groups.findIndex(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param candidate 当前集合项
       * @returns 是否符合筛选条件
       */ function match(candidate) {
        return candidate.id === item.id
      }
    )
    if (index < 0) next.groups.push(item)
    else next.groups[index] = item
    try {
      if (props.persist) await props.persist(next)
      else emit('update:modelValue', next)
    } catch (error) {
      feedback.failure(error)
      return
    }
    groupOpen.value = false
  }
</script>
<template>
  <div class="stack">
    <NCard title="菜单分组">
      <template #header-extra><NButton size="small" @click="editGroup()">＋ 新增分组</NButton></template>
      <div class="gap">
        <button v-for="item in modelValue.groups" :key="item.id" class="group-chip" :class="{ stopped: !item.active }" @click="editGroup(item)">
          <strong>{{ item.name }}</strong>
          <span>{{ groupCount(item.id) }} 个页面{{ item.active ? '' : ' · 已停用' }}</span>
        </button>
      </div>
    </NCard>
    <NCard title="动态页面">
      <template #header-extra>
        <div class="gap">
          <NInput v-model:value="keyword" size="small" placeholder="搜索页面或分组" clearable style="width: 180px" />
          <NButton type="primary" size="small" @click="edit()">＋ 新增页面</NButton>
        </div>
      </template>
      <NAlert type="info" :bordered="false" class="mb">页面绑定内置业务模板，可配置名称、分组、顺序和访问角色。保存后按当前用户授权生成菜单。</NAlert>
      <div class="config-list">
        <div v-for="entry in visible" :key="entry.item.id" class="config-item">
          <div class="config-main">
            <div class="page-title">
              <strong>{{ entry.item.name }}</strong>
              <NTag size="small" :bordered="false" :type="entry.item.active ? 'info' : 'default'">{{ entry.item.active ? '启用' : '停用' }}</NTag>
              <NTag size="small" :bordered="false">{{ groupName(entry.item.group) }}</NTag>
            </div>
            <small class="page-meta">
              <span>{{ PAGE_COMPONENTS[entry.item.component].label }}</span>
              <NPopover v-if="rolesFor(entry.item.id).length" trigger="click">
                <template #trigger>
                  <NButton text size="tiny" type="primary">{{ roleSummary(entry.item.id) }}</NButton>
                </template>
                <div class="role-cloud">
                  <NTag v-for="name in rolesFor(entry.item.id)" :key="name" size="small" :bordered="false">{{ name }}</NTag>
                </div>
              </NPopover>
              <span v-else class="role-missing">尚未授权，菜单不展示</span>
            </small>
          </div>
          <div class="config-actions">
            <NButton size="tiny" quaternary :disabled="entry.index === 0" @click="move(entry.index, -1)">↑</NButton>
            <NButton size="tiny" quaternary :disabled="entry.index === modelValue.pages.length - 1" @click="move(entry.index, 1)">↓</NButton>
            <NButton size="small" text type="primary" @click="edit(entry.item)">编辑</NButton>
            <NPopconfirm @positive-click="remove(entry.item.id)">
              <template #trigger><NButton size="small" text type="error">删除</NButton></template>
              删除菜单页面并解除角色页面关联？
            </NPopconfirm>
          </div>
        </div>
        <NEmpty v-if="!visible.length" description="没有匹配的页面" size="small" />
      </div>
    </NCard>
  </div>
  <NDrawer v-model:show="open" :width="mobile ? '100%' : 520">
    <NDrawerContent title="页面配置" closable>
      <NForm v-if="page" label-placement="top">
        <NFormItem label="页面名称" required><NInput v-model:value="page.name" :maxlength="50" /></NFormItem>
        <NFormItem label="菜单分组" required><NSelect v-model:value="page.group" :options="groups" /></NFormItem>
        <NFormItem label="业务模板"><NSelect v-model:value="page.component" :options="components" /></NFormItem>
        <NFormItem label="授权角色"><NSelect v-model:value="pageRoles" :options="roles" multiple filterable /></NFormItem>
        <NFormItem label="启用"><NSwitch v-model:value="page.active" /></NFormItem>
        <NAlert type="info">角色还需具备模板对应的业务操作权限；页面授权与业务权限共同生效。</NAlert>
      </NForm>
      <template #footer><NButton type="primary" :loading="saving" :disabled="saving" @click="save">保存</NButton></template>
    </NDrawerContent>
  </NDrawer>
  <NDrawer v-model:show="groupOpen" :width="mobile ? '100%' : 440">
    <NDrawerContent title="菜单分组" closable>
      <NForm v-if="group" label-placement="top">
        <NFormItem label="分组名称" required><NInput v-model:value="group.name" :maxlength="50" /></NFormItem>
        <NFormItem label="启用"><NSwitch v-model:value="group.active" /></NFormItem>
      </NForm>
      <template #footer><NButton type="primary" :loading="saving" :disabled="saving" @click="saveGroup">保存</NButton></template>
    </NDrawerContent>
  </NDrawer>
</template>
