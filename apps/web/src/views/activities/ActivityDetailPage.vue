<script setup lang="tsx">
  import { lifecycleOf } from '@workflow/domain'
  import { computed, ref } from 'vue'
  import { RouterLink } from 'vue-router'
  import { NAlert, NButton, NCard, NEmpty, NSpin, NTabs, NTabPane } from 'naive-ui'
  import ActivityEditor from '@/components/activity/ActivityEditor.vue'
  import ActionDrawer from '@/components/activity/ActionDrawer.vue'
  import AdjustmentDrawer from '@/components/activity/AdjustmentDrawer.vue'
  import TransferDrawer from '@/components/activity/TransferDrawer.vue'
  import AttachmentList from '@/components/activity/AttachmentList.vue'
  import NodeMaterialsPanel from '@/components/activity/NodeMaterialsPanel.vue'
  import ActivityEvaluationPanel from '@/components/evaluations/ActivityEvaluationPanel.vue'
  import ActivityOverview from '@/components/activity/detail/ActivityOverview.vue'
  import ActivityActionBar from '@/components/activity/detail/ActivityActionBar.vue'
  import ActivityApplicationSection from '@/components/activity/detail/ActivityApplicationSection.vue'
  import ActivityExecutionSection from '@/components/activity/detail/ActivityExecutionSection.vue'
  import ActivityHistoryPanel from '@/components/activity/detail/ActivityHistoryPanel.vue'
  import { EXECUTION_STATUSES } from '@/components/activity/detail/presentation'
  import type { ActivityDetailPageProps } from './types'
  import { useActivityDetail } from './use-activity-detail'

  const props = defineProps<ActivityDetailPageProps>()
  const section = ref('application')
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
    load,
    afterDelete,
    decide,
    handleAction,
    closeEdit,
    transfer,
  } = useActivityDetail(computed(() => props.activityId))
  const activityBusiness = computed(() => !!detail.value && lifecycleOf(detail.value.activity).businessType === 'activity')
  const executionVisible = computed(() => {
    const activity = detail.value?.activity
    return !!activity && lifecycleOf(activity).afterApproval === 'activity_standard' && (EXECUTION_STATUSES.includes(activity.status) || !!activity.report || !!activity.archive || !!activity.assignment)
  })
  /** 从常驻操作栏打开执行或归档表单时切换对应分区，提交后直接看到新增记录。
   * @param code 当前身份获准的活动业务动作
   */
  async function openAction(code: string): Promise<void> {
    if (['start', 'report', 'execution-complete', 'archive-submit', 'archive-approve', 'archive-return'].includes(code)) section.value = 'execution'
    await handleAction(code)
  }
</script>
<template>
  <NSpin :show="loading">
    <div v-if="errorText" class="error-box">
      <NAlert type="error" :title="errorText">
        <div class="gap">
          <NButton size="small" type="primary" @click="load">重新读取</NButton>
          <RouterLink :to="listDestination"><NButton size="small">返回申请列表</NButton></RouterLink>
        </div>
      </NAlert>
    </div>
    <template v-else-if="detail">
      <template v-if="edit">
        <NButton class="mb" @click="closeEdit">返回详情</NButton>
        <ActivityEditor :activity-id="detail.activity.id" :business-type="activityBusiness ? 'activity' : 'general'" @submitted="closeEdit" />
      </template>
      <div v-else class="activity-detail-page">
        <div class="detail-navigation">
          <RouterLink :to="listDestination">← 返回申请列表</RouterLink>
          <NButton :loading="loading" @click="load">刷新详情</NButton>
        </div>
        <ActivityOverview :detail="detail" />
        <NAlert v-if="isOld" type="warning" :bordered="false" class="historical-notice">
          申请资料正在展示历史快照 V{{ revision }}；右侧流程进度为当前状态。返回当前申请后可继续办理。
          <NButton type="warning" secondary class="history-return" @click="revision = 'current'">返回当前申请</NButton>
        </NAlert>
        <div class="activity-detail-grid">
          <div class="detail-content">
            <NCard class="content-card" :bordered="false">
              <NTabs v-model:value="section" type="line" size="large" animated :tabs-padding="4">
                <NTabPane name="application" tab="申请资料" display-directive="show">
                  <ActivityApplicationSection v-model:revision="revision" :detail="detail" />
                  <NAlert v-if="detail.access?.hiddenFieldKeys.length" type="info" :bordered="false" class="permission-notice">
                    部分资料已按当前身份隐藏或脱敏，公开结论和流程进度仍可查看。
                  </NAlert>
                  <section class="detail-section">
                    <h2>申请补充附件</h2>
                    <AttachmentList
                      :activity-id="detail.activity.id"
                      :files="detail.files"
                      :activity-version="detail.activity.version"
                      stage="application"
                      :can-upload="applicationUpload"
                      @uploaded="load"
                    />
                  </section>
                </NTabPane>
                <NTabPane name="materials" tab="节点资料" display-directive="show:lazy">
                  <div class="section-intro">
                    <h2>节点资料</h2>
                    <p>按办理节点查阅和补充附件，内部资料沿用各节点的数据权限。</p>
                  </div>
                  <NodeMaterialsPanel v-if="detail.activity.nodes.length" :detail="detail" :read-only="isOld" @uploaded="load" />
                  <NEmpty v-else description="提交活动申请后生成节点资料区域" />
                </NTabPane>
                <NTabPane v-if="detail.activity.lifecycle?.afterApproval !== 'complete'" name="execution" tab="执行与归档" display-directive="show:lazy">
                  <div class="section-intro">
                    <h2>执行与归档</h2>
                    <p>集中查看执行安排、实际汇报与成果档案。</p>
                  </div>
                  <ActivityExecutionSection
                    v-if="executionVisible"
                    :detail="detail"
                    :read-only="isOld"
                    :execution-upload="executionUpload"
                    :archive-upload="archiveUpload"
                    @action="openAction"
                    @uploaded="load"
                  />
                  <NEmpty v-else description="流程办理完成后进入执行与归档阶段" />
                </NTabPane>
                <NTabPane v-if="activityBusiness && detail.activity.lifecycle?.afterApproval !== 'complete' && (auth.can('evaluation:read') || auth.can('evaluation:manage'))" name="evaluation" tab="活动评价" display-directive="show:lazy">
                  <ActivityEvaluationPanel v-if="activityBusiness" :activity="detail.activity" />
                </NTabPane>
                <NTabPane name="history" :tab="`办理记录 · ${detail.activity.audit.length}`" display-directive="show:lazy">
                  <ActivityHistoryPanel :detail="detail" section="records" @uploaded="load" />
                </NTabPane>
              </NTabs>
            </NCard>
          </div>
          <aside aria-label="当前审批流程" class="detail-progress">
            <ActivityHistoryPanel :detail="detail" section="progress" :read-only="isOld || loading" @decide="decide" @transfer="transfer" />
          </aside>
        </div>
        <ActivityActionBar
          :detail="detail"
          :actions="actions"
          :loading="loading"
          :historical="isOld"
          @action="openAction"
          @decide="decide"
          @transfer="transfer"
          @deleted="afterDelete"
          @refresh="load"
          @current="revision = 'current'"
        />
        <TransferDrawer v-model:show="transferOpen" :detail="detail" :task="task" @done="load" />
        <ActionDrawer v-model:show="actionOpen" :detail="detail" :action="action" :task="task" @done="load" />
        <AdjustmentDrawer v-model:show="adjustmentOpen" :detail="detail" @done="load" />
      </div>
    </template>
    <div v-else-if="!loading" class="error-box">
      <NEmpty description="未找到活动">
        <RouterLink :to="listDestination"><NButton size="small">返回申请列表</NButton></RouterLink>
      </NEmpty>
    </div>
  </NSpin>
</template>
<style scoped>
  .activity-detail-page {
    min-width: 0;
  }
  .detail-navigation {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
    font-size: 14px;
  }
  .activity-detail-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 370px;
    align-items: start;
    gap: 20px;
    margin-top: 22px;
  }
  .detail-content,
  .detail-progress {
    min-width: 0;
  }
  .content-card {
    border: 1px solid #e3e9f2;
    border-radius: 12px;
    min-height: 440px;
  }
  :deep(.n-tab-pane) {
    padding-top: 24px !important;
  }
  :deep(.detail-progress .n-card) {
    border-radius: 12px;
    border-color: #e3e9f2;
  }
  :deep(.detail-progress .n-card-header__main) {
    font-size: 16px;
    font-weight: 600;
  }
  :deep(.detail-section h2) {
    font-size: 16px;
  }
  :deep(.detail-section h2 small),
  :deep(.history-item time),
  :deep(.file-badge) {
    font-size: 12px;
  }
  :deep(.detail-section p),
  :deep(.info-grid dd) {
    font-size: 14px;
  }
  .section-intro h2 {
    font-size: 17px;
    margin: 0 0 8px;
  }
  .section-intro p {
    color: #75839a;
    font-size: 13px;
    line-height: 1.8;
    margin-bottom: 20px;
  }
  :deep(.node-materials) {
    border-top: 0;
    padding-top: 0;
    margin-top: 0;
  }
  :deep(.node-materials > .spread h2) {
    display: none;
  }
  :deep(.evaluation-panel) {
    margin-top: 0;
  }
  .historical-notice {
    margin-top: 16px;
  }
  .permission-notice {
    margin-top: 20px;
  }
  .history-return {
    margin-left: 12px;
  }
  :deep(.info-grid) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  :deep(.info-grid dt) {
    font-size: 13px;
  }
  @media (max-width: 1200px) {
    .activity-detail-grid {
      grid-template-columns: minmax(0, 1fr) 330px;
      gap: 16px;
    }
  }
  @media (max-width: 1000px) {
    .activity-detail-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 600px) {
    :deep(.info-grid) {
      grid-template-columns: minmax(0, 1fr);
    }
    :deep(.content-card > .n-card__content),
    :deep(.activity-overview > .n-card__content) {
      padding: 18px 16px;
    }
  }
</style>
