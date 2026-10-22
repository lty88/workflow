<script setup lang="tsx">
import { computed, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NEmpty, NSpin, NTag } from 'naive-ui';
import { dashboardFilterSchema } from '@workflow/domain';
import type { DashboardFilter, LeadershipDashboard } from '@/typings/api/insights';
import { leadershipDashboardApi } from '@/api/insights';
import { useAuthStore } from '@/stores/auth';
import { formatTime } from '@/composables/format';
import LeadershipFilters from './LeadershipFilters.vue';
import LeadershipMetrics from './LeadershipMetrics.vue';
import LeadershipCharts from './LeadershipCharts.vue';
import { recentDateRange } from './dates';
const auth = useAuthStore();
const filter = ref<DashboardFilter>({
  ...recentDateRange(90),
  department: '',
  activityType: '',
});
const applied = ref<DashboardFilter | null>(null);
const data = ref<LeadershipDashboard | null>(null);
const busy = ref(false);
const errorText = ref('');
let generation = 0;
const options = computed(() => data.value?.options || { departments: [], types: [] });

/** 校验当前看板资格与筛选后读取聚合，丢弃晚到的旧请求结果。 */
async function load(): Promise<void> {
  if (!auth.can('dashboard:read')) {
    errorText.value = '当前账号未获领导看板权限';
    return;
  }
  const input = dashboardFilterSchema.safeParse(filter.value);
  if (!input.success) {
    errorText.value = '请选择有效起止日期，开始日期需早于结束日期，单次最多查询366天。';
    return;
  }
  const current = ++generation;
  busy.value = true;
  errorText.value = '';
  try {
    const result = await leadershipDashboardApi(input.data);
    if (current === generation) {
      data.value = result;
      applied.value = { ...input.data };
    }
  } catch (error) {
    if (current === generation) errorText.value = error instanceof Error ? error.message : '看板读取失败';
  } finally {
    if (current === generation) busy.value = false;
  }
}

/**
 * 按最近若干日重置日期并查询，保留当前部门和类型。
 * @param days 含今天在内的查询天数
 */
async function selectRange(days: number): Promise<void> {
  filter.value = { ...filter.value, ...recentDateRange(days) };
  await load();
}
onMounted(load);
</script>
<template>
  <div class="leadership-dashboard">
    <section class="leadership-hero">
      <div>
        <span class="hero-eyebrow">ACTIVITY INSIGHTS</span>
        <h1>每一场活动，都看得见成果</h1>
        <p>从活动推进到参与体验，掌握团队协作与服务质量。</p>
        <div class="hero-tags">
          <NTag :bordered="false" round>领导数据看板</NTag><span>按当前账号授权范围统计</span>
        </div>
      </div>
      <div class="hero-mark" aria-hidden="true"><i /><i /><i /><i /><i /></div>
    </section>
    <LeadershipFilters
      v-model="filter"
      :options="options"
      :loading="busy"
      @search="load"
      @range="selectRange"
    />
    <NAlert v-if="errorText" type="error" class="mb"
      >{{ errorText }}<NButton text @click="load">重试</NButton></NAlert
    >
    <NSpin :show="busy"
      ><template v-if="data"
        ><div class="dashboard-caption">
          <span>{{ applied?.start }} 至 {{ applied?.end }} · 按活动计划开始日期</span
          ><span>更新于 {{ formatTime(data.generatedAt) }}</span>
        </div>
        <LeadershipMetrics :summary="data.summary" /><LeadershipCharts :data="data" />
        <NCard title="需要关注的活动"
          ><template #header-extra><NTag type="warning" :bordered="false">整体均分低于 3.5</NTag></template>
          <div v-if="data.lowRated.length" class="low-rated-list">
            <article v-for="(item, index) in data.lowRated" :key="item.id">
              <span class="ranking">{{ String(index + 1).padStart(2, '0') }}</span>
              <div>
                <strong>{{ item.name }}</strong>
                <p>{{ item.department }} · 收到 {{ item.responses }} 份评价</p>
              </div>
              <div class="rating-value">{{ item.average }}<small> / 5</small></div>
            </article>
          </div>
          <NEmpty v-else description="当前统计范围暂无低分活动" size="small"
        /></NCard>
        <div class="metric-definitions">
          <strong>统计口径</strong>
          <p>
            活动总量不含草稿；提交执行汇报后计为执行完成，包含待提交档案、待归档审核和已归档。参与人数为人次；平均分按评价份数加权；满意率为整体评分4至5星的比例。无评价时显示“—”，低分关注列表最多展示10场。
          </p>
        </div> </template
      ><NEmpty v-else-if="!busy && !errorText" description="选择时间范围查看活动数据"
    /></NSpin>
  </div>
</template>
<style scoped>
.leadership-dashboard {
  max-width: 1800px;
  margin: 0 auto;
}
.leadership-hero {
  background: linear-gradient(115deg, #172c53, #254a82);
  border-radius: 18px;
  min-height: 210px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32px 38px;
  color: white;
  margin-bottom: 22px;
  overflow: hidden;
}
.hero-eyebrow {
  font-size: 12px;
  letter-spacing: 2.5px;
  color: #a3bee7;
}
.leadership-hero h1 {
  font-size: 28px;
  letter-spacing: 0.5px;
  margin: 14px 0 12px;
  color: white;
}
.leadership-hero p {
  font-size: 14px;
  color: #b7c9e5;
  line-height: 1.8;
}
.hero-tags {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 20px;
  font-size: 12px;
  color: #b7c9e5;
}
.hero-tags :deep(.n-tag) {
  background: #ffffff18;
  color: #e0ecff;
}
.hero-mark {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  height: 120px;
  transform: rotate(-9deg);
  padding: 0 30px;
}
.hero-mark i {
  display: block;
  width: 25px;
  background: linear-gradient(#7baaff99, #7baaff10);
  border-radius: 7px;
  height: 40%;
}
.hero-mark i:nth-child(2) {
  height: 65%;
}
.hero-mark i:nth-child(3) {
  height: 50%;
}
.hero-mark i:nth-child(4) {
  height: 85%;
}
.hero-mark i:nth-child(5) {
  height: 100%;
}
.dashboard-caption {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 0 2px 16px;
  color: #7e8da4;
  font-size: 12px;
}
.low-rated-list article {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 0;
  border-bottom: 1px solid #edf1f7;
}
.low-rated-list article:last-child {
  border-bottom: 0;
}
.ranking {
  font-size: 16px;
  font-weight: 600;
  color: #d1a36d;
}
.low-rated-list strong {
  font-size: 14px;
  font-weight: 500;
}
.low-rated-list p {
  font-size: 12px;
  color: #8390a7;
  margin: 7px 0 0;
}
.rating-value {
  margin-left: auto;
  font-size: 26px;
  color: #c47f42;
}
.rating-value small {
  font-size: 12px;
  color: #91a0b6;
}
.metric-definitions {
  padding: 22px 4px;
  color: #8390a7;
  font-size: 12px;
  line-height: 1.9;
}
.metric-definitions strong {
  color: #62718a;
  font-weight: 500;
}
.metric-definitions p {
  margin-top: 6px;
}
@media (max-width: 750px) {
  .leadership-hero {
    padding: 26px 22px;
    min-height: 190px;
  }
  .leadership-hero h1 {
    font-size: 22px;
  }
  .hero-mark {
    display: none;
  }
}
</style>
