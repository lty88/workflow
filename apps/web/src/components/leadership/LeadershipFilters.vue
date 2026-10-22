<script setup lang="tsx">
import { NButton, NDatePicker, NSelect } from 'naive-ui';
import type { DashboardFilter, LeadershipDashboard } from '@/typings/api/insights';
import { toPickerDate } from './dates';
const props = defineProps<{
  modelValue: DashboardFilter;
  options: LeadershipDashboard['options'];
  loading: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: DashboardFilter];
  search: [];
  range: [days: number];
}>();

/**
 * 更新单个筛选字段，保留其余条件，查询由父组件统一触发。
 * @param key 查询字段名
 * @param value 目标值
 */
function update(key: keyof DashboardFilter, value: string): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}
</script>
<template>
  <section class="leadership-filters" aria-label="看板数据筛选">
    <div class="date-filters">
      <NDatePicker
        :formatted-value="toPickerDate(modelValue.start)"
        value-format="yyyy-MM-dd"
        type="date"
        :clearable="false"
        aria-label="开始日期"
        @update:formatted-value="update('start', String($event || ''))"
      /><span>至</span
      ><NDatePicker
        :formatted-value="toPickerDate(modelValue.end)"
        value-format="yyyy-MM-dd"
        type="date"
        :clearable="false"
        aria-label="结束日期"
        @update:formatted-value="update('end', String($event || ''))"
      />
    </div>
    <NSelect
      :value="modelValue.department"
      :options="[{ label: '全部授权部门', value: '' }, ...options.departments]"
      aria-label="活动部门"
      @update:value="update('department', String($event || ''))"
    />
    <NSelect
      :value="modelValue.activityType"
      :options="[{ label: '全部活动类型', value: '' }, ...options.types]"
      aria-label="活动类型"
      @update:value="update('activityType', String($event || ''))"
    />
    <NButton type="primary" :loading="loading" @click="emit('search')">查询</NButton>
    <div class="quick-ranges">
      <NButton text size="small" @click="emit('range', 30)">近30天</NButton
      ><NButton text size="small" @click="emit('range', 90)">近90天</NButton
      ><NButton text size="small" @click="emit('range', 365)">近一年</NButton>
    </div>
  </section>
</template>
<style scoped>
.leadership-filters {
  display: grid;
  grid-template-columns:
    minmax(300px, 1.7fr) minmax(160px, 1fr) minmax(160px, 1fr)
    auto;
  gap: 12px;
  background: white;
  padding: 20px;
  border: 1px solid #e7ecf5;
  border-radius: 14px;
  margin-bottom: 22px;
}
.date-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.date-filters :deep(.n-date-picker) {
  min-width: 0;
  flex: 1;
}
.date-filters > span {
  font-size: 13px;
  color: #7e8da4;
}
.quick-ranges {
  grid-column: 1/-1;
  display: flex;
  gap: 20px;
}
@media (max-width: 1000px) {
  .leadership-filters {
    grid-template-columns: 1fr 1fr;
  }
  .date-filters {
    grid-column: 1/-1;
  }
}
@media (max-width: 550px) {
  .leadership-filters {
    grid-template-columns: 1fr;
  }
  .date-filters {
    flex-wrap: wrap;
  }
  .date-filters :deep(.n-date-picker) {
    flex-basis: 44%;
  }
}
</style>
