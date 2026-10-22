<script setup lang="tsx">
import { computed } from 'vue';
import { NCard, NEmpty, NProgress } from 'naive-ui';
import { STATUSES } from '@workflow/domain';
import type { LeadershipDashboard } from '@/typings/api/insights';
const props = defineProps<{ data: LeadershipDashboard }>();
const trendMax = computed(() => Math.max(1, ...props.data.trend.map((item) => item.total)));
const total = computed(() => Math.max(1, props.data.summary.total));
const colors = ['#426aef', '#30ad93', '#f1b953', '#9b7bd9', '#ea7e95', '#68a5cb'];
</script>
<template>
  <div class="leadership-charts">
    <NCard title="活动趋势" class="trend-card"
      ><template #header-extra
        ><div class="chart-legend">
          <span><i />活动总量</span><span><i />执行完成</span>
        </div></template
      >
      <div v-if="data.summary.total" class="trend-scroll">
        <div class="trend-chart" :style="{ minWidth: Math.max(420, data.trend.length * 65) + 'px' }">
          <div class="chart-y">
            <span>{{ trendMax }}</span
            ><span>{{ Math.round(trendMax / 2) }}</span
            ><span>0</span>
          </div>
          <div class="trend-bars">
            <div v-for="item in data.trend" :key="item.month" class="trend-month">
              <div class="bar-pair">
                <div
                  class="trend-bar total-bar"
                  :style="{ height: (item.total / trendMax) * 170 + 'px' }"
                  :title="`${item.month}：${item.total}场`"
                >
                  <span>{{ item.total }}</span>
                </div>
                <div
                  class="trend-bar completed-bar"
                  :style="{ height: (item.completed / trendMax) * 170 + 'px' }"
                  :title="`已完成：${item.completed}场`"
                />
              </div>
              <span>{{ item.month.slice(2).replace('-', ' / ') }}</span>
            </div>
          </div>
        </div>
      </div>
      <NEmpty v-else description="当前筛选范围暂无活动" class="chart-empty" />
    </NCard>
    <NCard title="流程状态分布"
      ><template #header-extra><span class="chart-unit">单位：场</span></template>
      <div v-if="data.statuses.length" class="status-list">
        <div v-for="(item, index) in data.statuses" :key="item.status" class="status-row">
          <span><i :style="{ background: colors[index % colors.length] }" />{{ STATUSES[item.status] }}</span
          ><NProgress
            type="line"
            :percentage="Math.round((item.count / total) * 100)"
            :color="colors[index % colors.length]"
            :height="8"
            :show-indicator="false"
          /><strong>{{ item.count }}</strong>
        </div>
      </div>
      <NEmpty v-else description="暂无状态分布" class="chart-empty"
    /></NCard>
    <NCard title="部门活动与质量"
      ><template #header-extra><span class="chart-unit">按活动数量排序</span></template>
      <div v-if="data.departments.length" class="table-scroll">
        <table class="insight-table">
          <thead>
            <tr>
              <th>部门</th>
              <th>活动数</th>
              <th>已完成</th>
              <th>平均分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in data.departments" :key="item.id">
              <td>{{ item.name }}</td>
              <td>{{ item.total }}</td>
              <td>{{ item.completed }}</td>
              <td>
                <span
                  :class="{
                    'low-score': item.average !== null && item.average < 3.5,
                  }"
                  >{{ item.average ?? '—' }}</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <NEmpty v-else description="暂无部门活动" class="chart-empty"
    /></NCard>
    <NCard title="活动类型分布"
      ><div v-if="data.types.length" class="type-list">
        <div v-for="(item, index) in data.types" :key="item.id">
          <div>
            <strong>{{ item.name }}</strong
            ><span>{{ item.total }} 场 · {{ Math.round((item.total / total) * 100) }}%</span>
          </div>
          <NProgress
            type="line"
            :percentage="Math.round((item.total / total) * 100)"
            :color="colors[index % colors.length]"
            :height="10"
            :show-indicator="false"
          />
        </div>
      </div>
      <NEmpty v-else description="暂无类型分布" class="chart-empty"
    /></NCard>
  </div>
</template>
<style scoped>
.leadership-charts {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}
.chart-legend {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: #7e8da4;
}
.chart-legend span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.chart-legend i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: #426aef;
}
.chart-legend span:last-child i {
  background: #30ad93;
}
.chart-unit {
  font-size: 12px;
  color: #7e8da4;
}
.trend-scroll,
.table-scroll {
  overflow: auto;
}
.trend-chart {
  display: flex;
  height: 245px;
  padding-top: 16px;
}
.chart-y {
  width: 28px;
  flex-shrink: 0;
  height: 186px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: #91a0b6;
  font-size: 12px;
}
.trend-bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  height: 218px;
  justify-content: space-around;
  background: repeating-linear-gradient(
    to top,
    transparent 0,
    transparent 83px,
    #f0f3f9 84px,
    transparent 85px
  );
}
.trend-month {
  flex: 1;
  text-align: center;
  min-width: 46px;
}
.trend-month > span {
  display: block;
  font-size: 12px;
  color: #7e8da4;
  margin-top: 16px;
}
.bar-pair {
  height: 180px;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 5px;
}
.trend-bar {
  width: 16px;
  max-width: 28%;
  border-radius: 5px 5px 0 0;
  position: relative;
  min-height: 0;
  background: #426aef;
  transition: height 0.2s;
}
.trend-bar > span {
  position: absolute;
  top: -22px;
  font-size: 12px;
  left: 50%;
  transform: translateX(-50%);
  color: #657695;
}
.completed-bar {
  background: #30ad93;
}
.status-list {
  padding: 8px 0;
  display: grid;
  gap: 20px;
  max-height: 270px;
  overflow: auto;
}
.status-row {
  display: grid;
  grid-template-columns: 110px 1fr 32px;
  gap: 12px;
  align-items: center;
  font-size: 13px;
}
.status-row > span {
  display: flex;
  gap: 9px;
  align-items: center;
  color: #657695;
}
.status-row i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.status-row strong {
  text-align: right;
  font-weight: 500;
}
.insight-table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
  font-size: 14px;
}
.insight-table th {
  text-align: left;
  color: #8390a7;
  background: #f8faff;
  font-size: 12px;
  font-weight: 500;
}
.insight-table th,
.insight-table td {
  padding: 14px 12px;
  border-bottom: 1px solid #edf1f7;
}
.insight-table td:not(:first-child),
.insight-table th:not(:first-child) {
  text-align: right;
}
.low-score {
  color: #cc7647;
}
.type-list {
  display: grid;
  gap: 28px;
  padding: 10px 0;
}
.type-list > div > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.type-list strong {
  font-weight: 500;
}
.type-list span {
  font-size: 12px;
  color: #7e8da4;
}
.chart-empty {
  padding: 65px 0;
}
@media (max-width: 1000px) {
  .leadership-charts {
    grid-template-columns: 1fr;
  }
}
</style>
