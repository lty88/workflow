<script setup lang="tsx">
  import FormAttachmentField from '@/components/activity/FormAttachmentField.vue'
  import { computed } from 'vue'
  import { NSelect } from 'naive-ui'
  import type { ActivityDetailSectionProps } from './types'
  import { formatMoney } from '@/composables/format'
  import { participantName } from './presentation'
  import { useActivityPresentation } from './use-activity-presentation'

  const props = defineProps<ActivityDetailSectionProps>()
  const revision = defineModel<string>('revision', { required: true })
  const { viewData, templateLabel, infoFields, textFields, attachmentFields, moneyFields, budgetRestricted, budgetTotal, revisionOptions, displayValue } =
    useActivityPresentation(
      computed(() => props.detail),
      revision
    )

  /**
   * 按参与人标识读取已授权的展示姓名。
   * @param id 人员标识
   * @returns 姓名或占位标识
   */
  function nameFor(id: string): string {
    return participantName(props.detail, id)
  }
</script>
<template>
  <div class="application-section-heading">
    <div>
      <h2>申请资料</h2>
      <p>{{ templateLabel }} · 申请 V{{ revision === 'current' ? detail.activity.revision : revision }} · 流程结构 R{{ detail.activity.structureRevision }}</p>
    </div>
    <div v-if="detail.activity.snapshots.length" class="application-revision">
      <span>查看版本</span>
      <NSelect v-model:value="revision" size="medium" :options="revisionOptions" aria-label="申请资料版本" />
    </div>
  </div>
  <div v-if="detail.activity.status === 'needs_info'" class="notice warning">申请被退回，请查看审核意见。修改后重新提交会生成新的审批轮次。</div>
  <div v-if="detail.activity.cancellation && detail.activity.status === 'cancel_review'" class="notice warning">
    取消原因：{{ detail.activity.cancellation.reason }} · 审核人：{{ nameFor(detail.activity.cancellation.reviewer) }}
  </div>
  <dl v-if="infoFields.length" class="info-grid application-info-grid">
    <div v-for="field in infoFields" :key="field.id">
      <dt>{{ field.label }}</dt>
      <dd>{{ displayValue(field) }}</dd>
    </div>
  </dl>
  <div v-if="textFields.length" class="detail-section">
    <h2>方案说明</h2>
    <template v-for="field in textFields" :key="field.id">
      <p class="sub-label">{{ field.label }}</p>
      <p>{{ viewData?.payload[field.key] || '未填写' }}</p>
    </template>
  </div>
  <div v-if="attachmentFields.length" class="detail-section">
    <h2>申请表附件</h2>
    <div v-for="field in attachmentFields" :key="field.id" class="mb">
      <p class="sub-label">{{ field.label }}</p>
      <FormAttachmentField :field="field" :model-value="viewData?.payload[field.key] || ''" :files="detail.files" disabled />
    </div>
  </div>
  <div v-if="moneyFields.length" class="detail-section">
    <h2>
      费用预算
      <span class="count-tag">{{ budgetRestricted ? '部分金额受限' : formatMoney(viewData?.payload.budget || String(budgetTotal)) }}</span>
    </h2>
    <table class="budget-table">
      <thead>
        <tr>
          <th>费用类别</th>
          <th>金额</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="field in moneyFields" :key="field.id">
          <td>{{ field.label }}</td>
          <td class="number">{{ displayValue(field) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
  .application-section-heading {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 16px;
    padding-bottom: 18px;
    border-bottom: 1px solid #edf0f6;
  }
  .application-section-heading h2 {
    font-size: 17px;
    margin: 0 0 8px;
  }
  .application-section-heading p {
    color: #79869a;
    font-size: 12px;
    margin: 0;
    line-height: 1.7;
  }
  .application-revision {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 13px;
    color: #65758c;
  }
  .application-revision :deep(.n-select) {
    width: 240px;
    max-width: 100%;
  }
  .info-grid.application-info-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .application-info-grid > div {
    min-width: 0;
  }
  :deep(.info-grid dd) {
    font-size: 14px;
    line-height: 1.8;
  }
  :deep(.info-grid dt) {
    font-size: 13px;
  }
  :deep(.detail-section h2) {
    font-size: 16px;
  }
  :deep(.detail-section p),
  :deep(.budget-table) {
    font-size: 14px;
  }
  :deep(.count-tag) {
    font-size: 12px;
  }
  @media (max-width: 900px) {
    .info-grid.application-info-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 600px) {
    .info-grid.application-info-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
