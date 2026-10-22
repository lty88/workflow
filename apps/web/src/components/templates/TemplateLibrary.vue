<script setup lang="tsx">
import { computed, ref } from 'vue';
import { NButton, NCard, NEmpty, NInput, NPopconfirm, NSelect, NTag } from 'naive-ui';
import type { TemplateLibraryProps } from './types';
import type { TemplateDefinition, WorkflowTemplate } from '@workflow/domain';
const props = defineProps<TemplateLibraryProps>();
const emit = defineEmits<{
  edit: [item: WorkflowTemplate];
  copy: [item: WorkflowTemplate];
  active: [item: WorkflowTemplate];
  history: [item: WorkflowTemplate];
  remove: [item: WorkflowTemplate];
  create: [];
}>();
const query = ref('');
const typeId = ref<string | null>(null);
const department = ref<string | null>(null);
const state = ref<string | null>(null);
const typeOptions = computed(() => props.types.map(option));
const departmentOptions = computed(() => props.config.departments.map(option));
const items = computed(() => props.items.filter(matches));
/**
 * 将部门或类型转换为选择项。
 * @param value 具名对象
 * @returns 下拉选项
 */
function option(value: { id: string; name: string }) {
  return { label: value.name, value: value.id };
}
/**
 * 列表展示发布定义，无发布版本时展示草稿。
 * @param item 模板
 * @returns 展示定义
 */
function definition(item: WorkflowTemplate): TemplateDefinition {
  return item.published || item.draft;
}
/**
 * 根据名称编码、类型、部门和启停状态筛选模板。
 * @param item 模板
 * @returns 是否显示
 */
function matches(item: WorkflowTemplate): boolean {
  const def = definition(item);
  return (
    (!query.value || `${def.name} ${item.code}`.toLowerCase().includes(query.value.trim().toLowerCase())) &&
    (!typeId.value || def.activityTypeIds.includes(typeId.value)) &&
    (!department.value || !def.departmentIds.length || def.departmentIds.includes(department.value)) &&
    (!state.value || (state.value === 'active' ? item.active : !item.active))
  );
}
/**
 * 将活动类型引用转换成易读名称。
 * @param ids 活动类型标识
 * @returns 类型摘要
 */
function typeNames(ids: string[]): string {
  const names = [];
  for (const type of props.types) if (ids.includes(type.id)) names.push(type.name);
  return names.join('、') || '未设置';
}
/**
 * 判断草稿是否与已发布定义不同。
 * @param item 模板
 * @returns 是否待发布
 */
function unpublished(item: WorkflowTemplate): boolean {
  return JSON.stringify(item.draft) !== JSON.stringify(item.published);
}
</script>
<template>
  <div class="stack">
    <div class="spread">
      <div>
        <h2>流程模板库</h2>
        <p class="help-text">按活动配置常用模板，发布新版本后用于后续申请。</p>
      </div>
      <NButton type="primary" :disabled="busy" @click="emit('create')">＋ 新建模板</NButton>
    </div>
    <div class="filters">
      <NInput v-model:value="query" clearable placeholder="搜索名称或编码" style="width: 240px" /><NSelect
        v-model:value="typeId"
        :options="typeOptions"
        clearable
        placeholder="活动类型"
        style="width: 180px"
      /><NSelect
        v-model:value="department"
        :options="departmentOptions"
        clearable
        placeholder="授权部门"
        style="width: 180px"
      /><NSelect
        v-model:value="state"
        :options="[
          { label: '启用', value: 'active' },
          { label: '停用', value: 'inactive' },
        ]"
        clearable
        placeholder="启停状态"
        style="width: 140px"
      />
    </div>
    <div class="template-cards">
      <NCard v-for="item in items" :key="item.id" :title="definition(item).name"
        ><div class="gap">
          <NTag :type="item.active ? 'success' : 'default'" :bordered="false">{{
            item.active ? '启用' : '停用'
          }}</NTag
          ><NTag :bordered="false">{{ item.currentVersion ? 'V' + item.currentVersion : '尚未发布' }}</NTag
          ><NTag v-if="unpublished(item)" type="warning" :bordered="false">有草稿</NTag>
        </div>
        <p>适用：{{ typeNames(definition(item).activityTypeIds) }}</p>
        <p class="help-text">编码 {{ item.code }} · {{ definition(item).nodes.length }}个节点</p>
        <p v-if="definition(item).defaultForTypeIds.length" class="help-text">
          默认推荐：{{ typeNames(definition(item).defaultForTypeIds) }}
        </p>
        <div class="gap">
          <NButton type="primary" :disabled="busy" @click="emit('edit', item)">设计模板</NButton
          ><NButton :disabled="busy" @click="emit('copy', item)">复制</NButton
          ><NButton :disabled="busy" @click="emit('history', item)">版本</NButton
          ><NPopconfirm @positive-click="emit('active', item)"
            ><template #trigger
              ><NButton :disabled="busy">{{ item.active ? '停用' : '启用' }}</NButton></template
            >{{
              item.active
                ? '停用后新申请无法选择，在途活动继续按原快照办理；此类型可能暂无可用模板。'
                : '启用后授权人员可以选择已发布版本。'
            }}</NPopconfirm
          ><NPopconfirm v-if="!item.currentVersion" @positive-click="emit('remove', item)"
            ><template #trigger><NButton type="error" ghost :disabled="busy">删除草稿</NButton></template
            >删除这份从未发布的草稿？</NPopconfirm
          >
        </div></NCard
      >
    </div>
    <NEmpty v-if="!items.length" description="暂无匹配模板" />
  </div>
</template>
<style scoped>
.template-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 20px;
}
.template-cards .gap {
  flex-wrap: wrap;
}
@media (max-width: 700px) {
  .template-cards {
    grid-template-columns: 1fr;
  }
}
</style>
