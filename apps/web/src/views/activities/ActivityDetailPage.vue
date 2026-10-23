<script setup lang="tsx">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { NAlert, NButton, NCard, NEmpty, NSpin } from 'naive-ui';
import { ACTION_LABELS } from '@/components/activity/types';
import ActivityEditor from '@/components/activity/ActivityEditor.vue';
import ActionDrawer from '@/components/activity/ActionDrawer.vue';
import AdjustmentDrawer from '@/components/activity/AdjustmentDrawer.vue';
import TransferDrawer from '@/components/activity/TransferDrawer.vue';
import AttachmentList from '@/components/activity/AttachmentList.vue';
import NodeMaterialsPanel from '@/components/activity/NodeMaterialsPanel.vue';
import ActivityDeleteButton from '@/components/activity/ActivityDeleteButton.vue';
import ActivityEvaluationPanel from '@/components/evaluations/ActivityEvaluationPanel.vue';
import ActivityApplicationSection from '@/components/activity/detail/ActivityApplicationSection.vue';
import ActivityExecutionSection from '@/components/activity/detail/ActivityExecutionSection.vue';
import ActivityHistoryPanel from '@/components/activity/detail/ActivityHistoryPanel.vue';
import type { ActivityDetailPageProps } from './types';
import { useActivityDetail } from './use-activity-detail';

const props = defineProps<ActivityDetailPageProps>();
const {
  auth,
  detail,
  loading,
  errorText,
  revision,
  edit,
  task,
  action,
  actionOpen,
  adjustmentOpen,
  transferOpen,
  actions,
  isOld,
  listDestination,
  applicationUpload,
  executionUpload,
  archiveUpload,
  actionStyle,
  load,
  afterDelete,
  decide,
  handleAction,
  closeEdit,
  transfer,
} = useActivityDetail(computed(() => props.activityId));
</script>
<template>
  <NSpin :show="loading">
    <div v-if="errorText" class="error-box">
      <NAlert type="error" :title="errorText">
        <div class="gap">
          <NButton size="small" type="primary" @click="load">重新读取</NButton>
          <RouterLink :to="listDestination"><NButton size="small">返回活动工单</NButton></RouterLink>
        </div>
      </NAlert>
    </div>
    <template v-else-if="detail">
      <template v-if="edit">
        <NButton class="mb" @click="closeEdit">返回详情</NButton>
        <ActivityEditor :activity-id="detail.activity.id" @submitted="closeEdit" />
      </template>
      <template v-else>
        <RouterLink :to="listDestination" class="back">← 返回活动工单</RouterLink>
        <div class="detail-grid activity-detail-grid">
          <div>
            <NCard class="detail-summary">
              <ActivityApplicationSection v-model:revision="revision" :detail="detail" />
              <NAlert v-if="detail.access?.hiddenFieldKeys.length" type="info" :bordered="false" class="mb">
                部分资料已按当前身份隐藏或脱敏；审批办理状态和公开结论仍可查看。
              </NAlert>
              <NodeMaterialsPanel :detail="detail" @uploaded="load" />
              <div class="detail-section">
                <h2>申请附件</h2>
                <AttachmentList
                  :activity-id="detail.activity.id"
                  :files="detail.files"
                  :activity-version="detail.activity.version"
                  stage="application"
                  :can-upload="applicationUpload"
                  @uploaded="load"
                />
              </div>
              <ActivityExecutionSection
                :detail="detail"
                :execution-upload="executionUpload"
                :archive-upload="archiveUpload"
                @uploaded="load"
              />
              <div v-if="!isOld" class="detail-actions">
                <NButton
                  v-for="item in actions"
                  :key="item"
                  :disabled="loading"
                  :type="actionStyle(item).type"
                  :quaternary="actionStyle(item).ghost"
                  @click="handleAction(item)"
                  >{{ ACTION_LABELS[item] || item }}</NButton
                >
                <small v-if="!actions.length && !detail.actions.includes('delete')" class="muted">
                  当前身份暂无可办理动作，可查看申请与历史记录。
                </small>
                <ActivityDeleteButton
                  :activity="detail.activity"
                  :allowed="detail.actions.includes('delete')"
                  @deleted="afterDelete"
                  @refresh="load"
                />
              </div>
            </NCard>
            <ActivityEvaluationPanel
              v-if="auth.can('evaluation:read') || auth.can('evaluation:manage')"
              :activity="detail.activity"
              class="mt"
            />
          </div>
          <ActivityHistoryPanel :detail="detail" @decide="decide" @transfer="transfer" />
        </div>
        <TransferDrawer v-model:show="transferOpen" :detail="detail" :task="task" @done="load" />
        <ActionDrawer v-model:show="actionOpen" :detail="detail" :action="action" :task="task" @done="load" />
        <AdjustmentDrawer v-model:show="adjustmentOpen" :detail="detail" @done="load" />
      </template>
    </template>
    <div v-else-if="!loading" class="error-box">
      <NEmpty description="未找到活动">
        <RouterLink :to="listDestination"><NButton size="small">返回活动工单</NButton></RouterLink>
      </NEmpty>
    </div>
  </NSpin>
</template>
<style scoped>
.activity-detail-grid {
  grid-template-columns: minmax(0, 1fr) 400px;
}
@media (max-width: 1150px) {
  .activity-detail-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
