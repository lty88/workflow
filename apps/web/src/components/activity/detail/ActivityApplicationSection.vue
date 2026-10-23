<script setup lang="tsx">
import { computed } from 'vue';
import { NSelect, NTag } from 'naive-ui';
import { STATUSES } from '@workflow/domain';
import type { ActivityDetailSectionProps } from './types';
import { formatMoney } from '@/composables/format';
import { participantName } from './presentation';
import { useActivityPresentation } from './use-activity-presentation';

const props = defineProps<ActivityDetailSectionProps>();
const revision = defineModel<string>('revision', { required: true });
const {
  statusTone,
  viewData,
  isOld,
  templateLabel,
  infoFields,
  textFields,
  moneyFields,
  budgetRestricted,
  budgetTotal,
  revisionOptions,
  nextHint,
  displayValue,
} = useActivityPresentation(
  computed(() => props.detail),
  revision,
);

/**
 * 按参与人标识读取已授权的展示姓名。
 * @param id 人员标识
 * @returns 姓名或占位标识
 */
function nameFor(id: string): string {
  return participantName(props.detail, id);
}
</script>
<template>
  <div class="detail-title">
    <div>
      <h1>{{ detail.activity.name || '未命名活动' }}</h1>
      <p>
        {{ detail.activity.code }} · 发起人 {{ nameFor(detail.activity.applicant) }} · 申请 V{{
          detail.activity.revision
        }}
        · 流程结构 R{{ detail.activity.structureRevision }}
      </p>
    </div>
    <NTag :bordered="false" round :type="statusTone">{{ STATUSES[detail.activity.status] }}</NTag>
  </div>
  <div v-if="nextHint" class="next-step">
    <div>
      <strong>{{ nextHint.text }}</strong
      ><span v-if="nextHint.owner">当前负责人：{{ nextHint.owner }}</span>
    </div>
    <span>组织配置 V{{ detail.activity.configVersion }}</span>
  </div>
  <p class="help-text">{{ templateLabel }}</p>
  <div v-if="detail.activity.snapshots.length" class="revision-select">
    <NSelect v-model:value="revision" size="small" :options="revisionOptions" />
  </div>
  <div v-if="isOld" class="notice warning">
    正在查看历史申请快照 V{{ revision }}。如需办理当前任务，请先切换回“当前申请内容”。
  </div>
  <div v-if="detail.activity.status === 'needs_info'" class="notice warning">
    申请被退回，请查看审核意见。修改后重新提交会生成新的审批轮次。
  </div>
  <div
    v-if="detail.activity.cancellation && detail.activity.status === 'cancel_review'"
    class="notice warning"
  >
    取消原因：{{ detail.activity.cancellation.reason }} · 审核人：{{
      nameFor(detail.activity.cancellation.reviewer)
    }}
  </div>
  <dl v-if="infoFields.length" class="info-grid">
    <div v-for="field in infoFields" :key="field.id">
      <dt>{{ field.label }}</dt>
      <dd>{{ displayValue(field) }}</dd>
    </div>
  </dl>
  <div v-if="textFields.length" class="detail-section">
    <h2>方案说明</h2>
    <template v-for="field in textFields" :key="field.id"
      ><p class="sub-label">{{ field.label }}</p>
      <p>{{ viewData?.payload[field.key] || '未填写' }}</p></template
    >
  </div>
  <div v-if="moneyFields.length" class="detail-section">
    <h2>
      费用预算
      <span class="count-tag">{{
        budgetRestricted ? '部分金额受限' : formatMoney(viewData?.payload.budget || String(budgetTotal))
      }}</span>
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
