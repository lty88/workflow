<script setup lang="tsx">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NInput,
  NPagination,
  NSelect,
  NTag,
  NSpin,
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { STATUSES } from '@workflow/domain';
import type { ActivityListItem, ActivityPage, ListParams } from '../../typings/api';
import { activitiesApi, exportActivitiesApi } from '../../api';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/use-feedback';
import { formatTime, formatMoney } from '../../composables/format';
const props = withDefaults(defineProps<{ scope?: ListParams['scope']; title?: string }>(), {
  scope: 'all',
  title: '活动工单',
});
const auth = useAuthStore();
const feedback = useFeedback();
const exportBusy = ref(false);
const applied = ref<ListParams>({});
const busy = ref(false);
const q = ref('');
const status = ref<string | null>(null);
const filter = ref<'all' | 'mine'>('all');
const page = ref(1);
const data = ref<ActivityPage>({ items: [], total: 0, page: 1, pageSize: 15 });
const statusOptions = Object.entries(STATUSES).map(statusOption);
const newPage = computed(() => auth.profile?.menus.find(isNewPage));
const errorText = ref('');
let requestId = 0;
/**
 * 查找授权的新建页面。
 * @param item 动态页
 * @returns 是否表单页
 */
function isNewPage(item: { component: string }): boolean {
  return item.component === 'activity_form';
}
/**
 * 转换状态选项。
 * @param pair 状态键值
 * @returns 下拉项
 */
function statusOption(pair: [string, string]): { label: string; value: string } {
  return { label: pair[1], value: pair[0] };
}
/**
 * 渲染工单名称和编号。
 * @param row 列表行
 * @returns 名称链接
 */
function renderName(row: ActivityListItem) {
  return (
    <RouterLink to={'/activities/' + row.id}>
      <strong>{row.name || '未命名草稿'}</strong>
      <div class="file-meta">{row.code}</div>
    </RouterLink>
  );
}
/**
 * 渲染工单状态。
 * @param row 列表行
 * @returns 状态标签
 */
function renderStatus(row: ActivityListItem) {
  return (
    <NTag
      size="small"
      bordered={false}
      type={row.status === 'archived' ? 'success' : row.status === 'needs_info' ? 'warning' : 'info'}
    >
      {STATUSES[row.status]}
    </NTag>
  );
}
/**
 * 渲染计划时间。
 * @param row 列表行
 * @returns 时间文本
 */
function renderStart(row: ActivityListItem): string {
  return formatTime(row.startAt);
}
/**
 * 渲染预算。
 * @param row 列表行
 * @returns 金额文本
 */
function renderBudget(row: ActivityListItem): string {
  return formatMoney(row.budget);
}
/**
 * 渲染行内详情入口。
 * @param row 列表行
 * @returns 详情链接
 */
function renderAction(row: ActivityListItem) {
  return (
    <RouterLink to={'/activities/' + row.id}>{props.scope === 'tasks' ? '去办理 →' : '查看 →'}</RouterLink>
  );
}
const columns: DataTableColumns<ActivityListItem> = [
  { title: '活动名称 / 编号', key: 'name', minWidth: 220, render: renderName },
  { title: '状态', key: 'status', width: 120, render: renderStatus },
  { title: '计划开始', key: 'startAt', width: 165, render: renderStart },
  { title: '地点', key: 'location', minWidth: 140, ellipsis: { tooltip: true } },
  { title: '预算', key: 'budget', width: 125, render: renderBudget },
  { title: '操作', key: 'actions', width: 90, render: renderAction },
];
/**
 * 读取真实分页数据，忽略被新查询取代的旧响应。
 */
async function load(): Promise<void> {
  const current = ++requestId;
  busy.value = true;
  try {
    const result = await activitiesApi({
      q: q.value.trim(),
      status: status.value || '',
      scope: props.scope === 'all' ? filter.value : props.scope,
      page: page.value,
      pageSize: 15,
    });
    if (current === requestId) {
      data.value = result;
      applied.value = {
        q: q.value.trim(),
        status: status.value || '',
        scope: props.scope === 'all' ? filter.value : props.scope,
      };
      errorText.value = '';
    }
  } catch (error) {
    if (current === requestId) {
      errorText.value = error instanceof Error ? error.message : '读取失败';
      feedback.failure(error);
    }
  } finally {
    if (current === requestId) busy.value = false;
  }
}
/**
 * 搜索或过滤条件变化时回到第一页。
 */
function search(): void {
  page.value = 1;
  void load();
}
/**
 * 翻到指定页并请求数据。
 * @param value 页码
 */
function changePage(value: number): void {
  page.value = value;
  void load();
}
watch(() => props.scope, search);
onMounted(load);
/**
 * 下载已应用搜索条件下的活动列表，错误通过统一消息显示。
 */
async function exportList(): Promise<void> {
  if (!auth.can('activity:export')) return;
  exportBusy.value = true;
  try {
    const blob = await exportActivitiesApi(applied.value);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '活动工单.csv';
    link.click();
    setTimeout(
      /**
       * 释放下载产生的临时地址。
       */ function revoke(): void {
        URL.revokeObjectURL(url);
      },
      1000,
    );
  } catch (error) {
    feedback.failure(error);
  } finally {
    exportBusy.value = false;
  }
}
/**
 * 为表格提供稳定行标识。
 * @param row 活动记录
 * @returns 工单标识
 */
function rowKey(row: ActivityListItem): string {
  return row.id;
}
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <span class="eyebrow">{{
          scope === 'tasks' ? 'MY INBOX' : scope === 'archives' ? 'ACTIVITY ARCHIVES' : 'ACTIVITY ORDERS'
        }}</span>
        <h1>{{ title }}</h1>
        <p>
          {{
            scope === 'tasks'
              ? '按活动汇总当前可办理事项，进入详情处理个人节点和后续任务。'
              : scope === 'archives'
                ? '已审核归档的活动与成果资料。'
                : '在授权范围内查看申请、审批与执行进度。'
          }}
        </p>
      </div>
      <RouterLink v-if="newPage && auth.can('activity:create')" :to="'/workspace/' + newPage.id"
        ><NButton type="primary">＋ 发起活动</NButton></RouterLink
      >
    </div>
    <NCard
      ><div class="filters">
        <NInput
          v-model:value="q"
          clearable
          placeholder="搜索活动名称、编号或地点"
          class="search-input"
          @keyup.enter="search"
        /><NSelect
          v-if="scope !== 'archives'"
          v-model:value="status"
          :options="statusOptions"
          clearable
          placeholder="全部状态"
          class="filter-select"
          @update:value="search"
        /><NSelect
          v-if="scope === 'all'"
          v-model:value="filter"
          :options="[
            { label: '授权范围', value: 'all' },
            { label: '我发起的', value: 'mine' },
          ]"
          class="filter-select"
          @update:value="search"
        /><NButton :loading="busy" @click="search">查询</NButton
        ><NButton
          v-if="auth.can('activity:export')"
          :loading="exportBusy"
          :disabled="busy || !data.total"
          @click="exportList"
          >导出筛选结果</NButton
        >
      </div>
      <NAlert v-if="errorText" type="error" class="mb">{{ errorText }}</NAlert
      ><NDataTable
        class="desktop-table"
        :columns="columns"
        :data="data.items"
        :loading="busy"
        :bordered="false"
        :row-key="rowKey"
        :scroll-x="850" /><NSpin :show="busy" class="mobile-activity"
        ><NEmpty v-if="!data.items.length && !busy" description="暂无活动" /><RouterLink
          v-for="row in data.items"
          :key="row.id"
          :to="'/activities/' + row.id"
          class="activity-card"
          ><div class="spread">
            <small class="muted">{{ row.code }}</small
            ><NTag size="small" :bordered="false" type="info">{{ STATUSES[row.status] }}</NTag>
          </div>
          <h3>{{ row.name || '未命名草稿' }}</h3>
          <div class="meta">
            {{ formatTime(row.startAt) }}<br />{{ row.location }}<br />{{ formatMoney(row.budget) }}
          </div>
          <div style="margin-top: 12px">{{ scope === 'tasks' ? '去办理' : '查看详情' }} →</div></RouterLink
        ></NSpin
      >
      <div class="spread" style="margin-top: 22px">
        <span class="help-text">共 {{ data.total }} 个活动</span
        ><NPagination
          :page="page"
          :item-count="data.total"
          :page-size="15"
          :page-slot="5"
          @update:page="changePage"
        /></div
    ></NCard>
  </div>
</template>
