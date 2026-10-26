<script setup lang="tsx">
  import { NAlert, NFormItem, NInput, NInputNumber, NDatePicker } from 'naive-ui'
  import type { ExecutionReport } from '@workflow/domain'
  import type { ExecutionReportFormProps } from './types'
  defineProps<ExecutionReportFormProps>()
  const report = defineModel<ExecutionReport>({ required: true })
  /** 将ISO时间转换为日期控件时间戳。
   * @param value ISO时间
   * @returns 有效时间戳或空值
   */
  function timestamp(value: string): number | null {
    const time = Date.parse(value)
    return Number.isFinite(time) ? time : null
  }
  /** 更新本条执行记录的实际时间。
   * @param key 实际时间字段
   * @param value 日期控件时间戳
   */
  function setTime(key: 'start' | 'end', value: number | null): void {
    report.value = { ...report.value, [key]: value === null ? '' : new Date(value).toISOString() }
  }
</script>
<template>
  <NAlert :type="completion ? 'warning' : 'info'" :bordered="false" class="mb">
    {{
      completion
        ? '请确认最终人数、总支出和整体成果。确认后停止新增执行记录，由执行负责人继续补齐成果并提交归档审核。'
        : '可按日报、阶段进展持续新增记录。本次提交仅保存记录，活动继续执行。'
    }}
  </NAlert>
  <NFormItem v-if="!completion" label="记录标题" path="report.title">
    <NInput v-model:value="report.title" placeholder="例如：10月26日现场执行日报" :maxlength="100" />
  </NFormItem>
  <div class="report-time-grid">
    <NFormItem :label="completion ? '活动实际开始时间' : '本次记录开始时间'" path="report.start" required>
      <NDatePicker :value="timestamp(report.start)" type="datetime" style="width: 100%" @update:value="setTime('start', $event)" />
    </NFormItem>
    <NFormItem :label="completion ? '活动实际结束时间' : '本次记录结束时间'" path="report.end" required>
      <NDatePicker :value="timestamp(report.end)" type="datetime" style="width: 100%" @update:value="setTime('end', $event)" />
    </NFormItem>
  </div>
  <NFormItem :label="completion ? '最终实到人数' : '本次实到人数'" path="report.people" required>
    <NInputNumber v-model:value="report.people" :min="0" :max="100000" :precision="0" />
  </NFormItem>
  <NFormItem :label="completion ? '最终执行成果汇总' : '本次进展与成果'" path="report.summary" required>
    <NInput v-model:value="report.summary" type="textarea" :maxlength="3000" :autosize="{ minRows: 5 }" show-count />
  </NFormItem>
  <NFormItem :label="completion ? '活动实际总支出（元）' : '本次发生支出（元）'">
    <NInput v-model:value="report.spend" placeholder="非负金额，最多两位小数；未发生可填0" />
  </NFormItem>
  <NFormItem label="异常说明" path="report.exception" :required="completion && report.people === 0">
    <NInput v-model:value="report.exception" type="textarea" :maxlength="1000" :autosize="{ minRows: 3 }" />
  </NFormItem>
</template>
<style scoped>
  .report-time-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
</style>
