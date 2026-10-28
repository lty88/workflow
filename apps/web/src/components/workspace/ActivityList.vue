<script setup lang="tsx">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { activityDestination } from '@/navigation';
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
import type { ActivityListItem, ActivityPage, ListParams } from '@/typings/api';
import { activitiesApi, exportActivitiesApi } from '@/api/activities';
import { useAuthStore } from '@/stores/auth';
import { useFeedback } from '@/composables/use-feedback';
import { formatTime, formatMoney } from '@/composables/format';
import CreateRequestMenu from '@/components/workspace/creation/CreateRequestMenu.vue';
import ActivityDeleteButton from '@/components/activity/ActivityDeleteButton.vue';
const props = withDefaults(defineProps<{ scope?: ListParams['scope']; title?: string; common?: boolean }>(), {
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
const businessType = ref<ListParams['businessType'] | null>(null);
const filter = ref<'all' | 'mine'>('all');
const page = ref(1);
const data = ref<ActivityPage>({ items: [], total: 0, page: 1, pageSize: 15 });
const statusOptions = Object.entries(STATUSES).map(statusOption);
const errorText = ref('');
let requestId = 0;
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
    <RouterLink to={activityDestination(row.id, row.businessType)}>
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
      type={statusTone(row.status)}
    >
      {STATUSES[row.status]}
    </NTag>
  );
}
/** 统一桌面与手机的状态颜色，终止显示红色，撤回及取消保留中性色。
 * @param value 申请状态
 * @returns 状态标签的语义颜色
 */
function statusTone(value: ActivityListItem['status']): 'success' | 'error' | 'warning' | 'default' | 'info' {
  if (value === 'rejected') return 'error';
  if (['archived', 'completed'].includes(value)) return 'success';
  if (['needs_info', 'cancel_review'].includes(value)) return 'warning';
  if (['draft', 'withdrawn', 'cancelled'].includes(value)) return 'default';
  return 'info';
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
  return row.restrictedFields?.includes('budget') ? '权限受限' : formatMoney(row.budget);
}
/**
 * 渲染行内详情和受权限及状态限制的删除入口。
 * @param row 列表行
 * @returns 详情链接与删除确认按钮
 */
function renderAction(row: ActivityListItem) {
  return (
    <div class="gap">
      <RouterLink to={activityDestination(row.id, row.businessType)}>{props.scope === 'tasks' ? '去办理 →' : '查看 →'}</RouterLink>
      <ActivityDeleteButton activity={row} allowed={row.canDelete} onDeleted={afterDelete} onRefresh={load} />
    </div>
  );
}
/** 显示申请所属业务，便于跨业务待办识别。
 * @param row 列表记录
 * @returns 业务名称
 */
function renderBusinessType(row: ActivityListItem): string {
  return row.businessType === 'general' ? '通用 OA' : '活动申请';
}
/** 显示申请更新时间，通用申请无需展示活动时间和预算空列。
 * @param row 列表记录
 * @returns 本地化时间
 */
function renderUpdated(row: ActivityListItem): string { return formatTime(row.updatedAt); }
const columns = computed<DataTableColumns<ActivityListItem>>(() => [
  { title: props.common || props.scope === 'tasks' ? '申请名称 / 编号' : '活动名称 / 编号', key: 'name', minWidth: 220, render: renderName },
  { title: '发起人', key: 'applicantName', width: 110 },
  { title: '状态', key: 'status', width: 120, render: renderStatus },
  ...(props.common || props.scope === 'tasks' ? [
    { title: '业务类型', key: 'businessType', width: 110, render: renderBusinessType },
    { title: '更新时间', key: 'updatedAt', width: 165, render: renderUpdated },
  ] : [
    { title: '计划开始', key: 'startAt', width: 165, render: renderStart },
    { title: '地点', key: 'location', minWidth: 140, ellipsis: { tooltip: true } },
    { title: '预算', key: 'budget', width: 125, render: renderBudget },
  ]),
  { title: '操作', key: 'actions', width: 150, render: renderAction },
]);
/**
 * 按当前业务、状态及授权范围请求分页，保存相同筛选用于导出并忽略过期响应。
 */
async function load(): Promise<void> {
  const current = ++requestId;
  busy.value = true;
  try {
    const result = await activitiesApi({
      q: q.value.trim(),
      status: status.value || '',
      businessType: props.common || props.scope === 'tasks' ? businessType.value || undefined : undefined,
      scope: props.scope === 'all' ? filter.value : props.scope,
      page: page.value,
      pageSize: 15,
    }, props.common);
    if (current === requestId) {
      data.value = result;
      applied.value = {
        q: q.value.trim(),
        status: status.value || '',
        businessType: props.common || props.scope === 'tasks' ? businessType.value || undefined : undefined,
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
/** 删除后刷新列表，当前页仅剩一条时回到上一页，避免停留空页。 */
async function afterDelete(): Promise<void> {
  if (data.value.items.length === 1 && page.value > 1) page.value -= 1;
  await load();
}
/**
 * 搜索或过滤条件变化时回到第一页。
 */
function search(): void {
  page.value = 1;
  void load();
}
/** 清空搜索、业务及状态限制，回到当前页面范围内的全部可见申请。 */
function resetFilters(): void {
  q.value = '';
  status.value = null;
  businessType.value = null;
  filter.value = 'all';
  search();
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
    const blob = await exportActivitiesApi(applied.value, props.common);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = props.common ? '申请列表.csv' : '活动工单.csv';
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
          scope === 'tasks' ? 'MY INBOX' : common ? 'REQUEST CENTER' : scope === 'archives' ? 'ACTIVITY ARCHIVES' : 'ACTIVITY ORDERS'
        }}</span>
        <h1>{{ title }}</h1>
        <p>
          {{
            scope === 'tasks'
              ? '按申请汇总当前可办理事项，进入详情处理个人节点和后续任务。'
              : scope === 'archives'
                ? '已审核归档的活动与成果资料。'
                : common ? '汇总活动申请与通用审批，保留已终止、已取消及已办结记录。' : '在授权范围内查看申请、审批与执行进度。'
          }}
        </p>
      </div>
      <CreateRequestMenu />
    </div>
    <NCard
      ><div class="filters">
        <NInput
          v-model:value="q"
          clearable
          :placeholder="common ? '搜索申请名称或编号' : '搜索活动名称或编号'"
          class="search-input"
          @keyup.enter="search"
        /><NSelect
          v-if="common || scope === 'tasks'"
          v-model:value="businessType"
          :options="[{ label: '活动申请', value: 'activity' }, { label: '通用审批', value: 'general' }]"
          clearable
          placeholder="全部业务类型"
          class="filter-select"
          @update:value="search"
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
        ><NButton v-if="q || status || businessType || filter !== 'all'" :disabled="busy" @click="resetFilters">重置筛选</NButton
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
        :scroll-x="1030" /><NSpin :show="busy" class="mobile-activity"
        ><NEmpty v-if="!data.items.length && !busy" :description="common || scope === 'tasks' ? '暂无申请' : '暂无活动'" />
        <article v-for="row in data.items" :key="row.id" class="activity-card">
          <RouterLink :to="activityDestination(row.id, row.businessType)">
            <div class="spread">
              <small class="muted">{{ row.code }}</small
              ><NTag size="small" :bordered="false" :type="statusTone(row.status)">{{ STATUSES[row.status] }}</NTag>
            </div>
            <h3>{{ row.name || '未命名草稿' }}</h3>
            <div class="meta">
              发起人：{{ row.applicantName }}<br />
              <template v-if="common || scope === 'tasks'">{{ renderBusinessType(row) }} · 更新于 {{ renderUpdated(row) }}</template>
              <template v-else>{{ formatTime(row.startAt) }}<br />{{ row.location }}<br />{{ renderBudget(row) }}</template>
            </div>
          </RouterLink>
          <div class="spread" style="margin-top: 12px">
            <RouterLink :to="activityDestination(row.id, row.businessType)"
              >{{ scope === 'tasks' ? '去办理' : '查看详情' }} →</RouterLink
            ><ActivityDeleteButton
              :activity="row"
              :allowed="row.canDelete"
              @deleted="afterDelete"
              @refresh="load"
            />
          </div>
        </article>
      </NSpin>
      <div class="spread" style="margin-top: 22px">
        <span class="help-text">共 {{ data.total }} {{ common || scope === 'tasks' ? '个申请' : '个活动' }}</span
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
