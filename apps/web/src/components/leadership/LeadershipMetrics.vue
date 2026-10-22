<script setup lang="tsx">
import { computed } from 'vue';
import type { LeadershipDashboard } from '@/typings/api/insights';
const props = defineProps<{ summary: LeadershipDashboard['summary'] }>();
const metrics = computed(() => [
  {
    label: '活动总量',
    value: props.summary.total,
    unit: '场',
    note: '统计期内已提交活动',
    accent: 'blue',
  },
  {
    label: '执行已完成',
    value: props.summary.completed,
    unit: '场',
    note: `推进中 ${props.summary.ongoing} 场 · 已取消 ${props.summary.cancelled} 场`,
    accent: 'green',
  },
  {
    label: '完成率',
    value: props.summary.completionRate ?? '—',
    unit: props.summary.completionRate === null ? '' : '%',
    note: '执行完成数 / 活动总量',
    accent: 'violet',
  },
  {
    label: '实际参与',
    value: props.summary.participants.toLocaleString(),
    unit: '人次',
    note: '来自已完成活动的执行汇报',
    accent: 'cyan',
  },
  {
    label: '整体满意度',
    value: props.summary.average ?? '—',
    unit: '/ 5',
    note: `${props.summary.responses} 份评价 · 覆盖 ${props.summary.evaluatedActivities} 场活动`,
    accent: 'amber',
  },
  {
    label: '满意率',
    value: props.summary.satisfaction ?? '—',
    unit: props.summary.satisfaction === null ? '' : '%',
    note: '整体评分为4至5星的评价占比',
    accent: 'rose',
  },
]);
</script>
<template>
  <div class="leadership-metrics">
    <article v-for="metric in metrics" :key="metric.label" class="leadership-metric" :class="metric.accent">
      <div class="metric-top">
        <span>{{ metric.label }}</span
        ><i />
      </div>
      <div class="leadership-value">
        {{ metric.value }}<small>{{ metric.unit }}</small>
      </div>
      <p>{{ metric.note }}</p>
    </article>
  </div>
</template>
<style scoped>
.leadership-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 22px;
}
.leadership-metric {
  padding: 22px 24px;
  border: 1px solid #e7ecf5;
  border-radius: 14px;
  background: white;
  --accent: #235de9;
}
.green {
  --accent: #19a17b;
}
.violet {
  --accent: #8058d4;
}
.cyan {
  --accent: #129fb0;
}
.amber {
  --accent: #c28a21;
}
.rose {
  --accent: #cf647d;
}
.metric-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #5e6e88;
  font-size: 14px;
}
.metric-top i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--accent);
}
.leadership-value {
  margin: 18px 0 10px;
  font-size: 36px;
  line-height: 1.2;
  font-weight: 650;
  letter-spacing: -1px;
  color: #21324f;
  font-variant-numeric: tabular-nums;
}
.leadership-value small {
  font-size: 14px;
  letter-spacing: 0;
  font-weight: 400;
  color: #7b8aa2;
  margin-left: 8px;
}
.leadership-metric p {
  font-size: 12px;
  line-height: 1.7;
  color: #8390a7;
  margin: 0;
}
@media (min-width: 1600px) {
  .leadership-metrics {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  .leadership-metric {
    padding: 20px;
  }
  .leadership-value {
    font-size: 32px;
  }
}
@media (max-width: 750px) {
  .leadership-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .leadership-metric {
    padding: 18px;
  }
  .leadership-value {
    font-size: 30px;
  }
}
</style>
