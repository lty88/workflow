<script setup lang="tsx">
  import type { WorkflowTask } from '@workflow/domain'
  import CollaborationPanel from '@/components/activity/collaboration/CollaborationPanel.vue'
  import CollaborationDispatchDrawer from '@/components/activity/collaboration/CollaborationDispatchDrawer.vue'
  import { lifecycleOf } from '@workflow/domain'
  import { computed, nextTick, ref } from 'vue'
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
  const collaborationOpen = ref(false)
  const collaborationTask = ref<WorkflowTask>()
  const collaborationPanel = ref<InstanceType<typeof CollaborationPanel>>()
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
  const collaborationCount = computed(() => detail.value?.activity.nodes.filter((node) => !!node.collaboration).length || 0)
  const activityBusiness = computed(() => !!detail.value && lifecycleOf(detail.value.activity).businessType === 'activity')
  const executionVisible = computed(() => {
    const activity = detail.value?.activity
    return (
      !!activity &&
      lifecycleOf(activity).afterApproval === 'activity_standard' &&
      (EXECUTION_STATUSES.includes(activity.status) || !!activity.report || !!activity.archive || !!activity.assignment)
    )
  })
  /** 再次检查服务端派发资格后打开当前个人待办的协作抽屉。
   * @param selected 当前审批个人待办
   */
  function collaborate(selected: WorkflowTask): void {
    if (loading.value || isOld.value || !detail.value?.collaborationCapabilities?.dispatchTaskIds.includes(selected.id)) return
    collaborationTask.value = selected
    collaborationOpen.value = true
  }
  /** 切换到协作任务分区并等待面板显示，再打开本人任务或定位待验收清单。 */
  async function openCollaborationWork(): Promise<void> {
    section.value = 'collaboration'
    await nextTick()
    collaborationPanel.value?.openMyTask()
  }
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
          <RouterLink :to="listDestination" class="back-link">
            <span aria-hidden="true">←</span>
            返回申请列表
          </RouterLink>
          <span class="navigation-caption">{{ activityBusiness ? '活动工作台' : '申请工作台' }}</span>
          <NButton quaternary :loading="loading" @click="load">↻ 刷新详情</NButton>
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
                  <section class="detail-section application-attachments">
                    <h2>申请补充附件</h2>
                    <AttachmentList
                      :activity-id="detail.activity.id"
                      :files="detail.files"
                      :activity-version="detail.activity.version"
                      stage="application"
                      compact-empty
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
                <NTabPane v-if="collaborationCount" name="collaboration" display-directive="show">
                  <template #tab>
                    <span class="detail-tab-label">
                      协作任务
                      <span class="tab-count">{{ collaborationCount }}</span>
                    </span>
                  </template>
                  <CollaborationPanel ref="collaborationPanel" :detail="detail" :read-only="isOld || loading" @done="load" />
                </NTabPane>
                <NTabPane v-if="detail.activity.lifecycle?.afterApproval !== 'complete'" name="execution" tab="执行与归档" display-directive="show:lazy">
                  <ActivityExecutionSection
                    v-if="executionVisible"
                    :detail="detail"
                    :read-only="isOld"
                    :execution-upload="executionUpload"
                    :archive-upload="archiveUpload"
                    @uploaded="load"
                  />
                  <NEmpty v-else description="流程办理完成后进入执行与归档阶段" />
                </NTabPane>
                <NTabPane
                  v-if="
                    activityBusiness &&
                    detail.activity.lifecycle?.afterApproval !== 'complete' &&
                    (auth.can('evaluation:read') || auth.can('evaluation:manage'))
                  "
                  name="evaluation"
                  tab="活动评价"
                  display-directive="show:lazy"
                >
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
          @collaborate="collaborate"
          @collaboration-work="openCollaborationWork"
          @transfer="transfer"
          @deleted="afterDelete"
          @refresh="load"
          @current="revision = 'current'"
        />
        <CollaborationDispatchDrawer v-model:show="collaborationOpen" :detail="detail" :task="collaborationTask" @done="load" />
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
    --detail-border: #e6ebf2;
    --detail-text: #24334b;
    --detail-muted: #7a879b;
    min-width: 0;
    color: var(--detail-text);
  }
  .detail-navigation {
    display: flex;
    align-items: center;
    gap: 18px;
    margin-bottom: 16px;
    font-size: 13px;
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #526580;
    font-weight: 500;
  }
  .back-link:hover {
    color: #3569db;
  }
  .navigation-caption {
    flex: 1;
    border-left: 1px solid #dce3ee;
    padding-left: 18px;
    color: var(--detail-muted);
  }
  .activity-detail-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 344px;
    align-items: start;
    gap: 20px;
    margin-top: 20px;
  }
  .detail-content,
  .detail-progress {
    min-width: 0;
  }
  .detail-progress {
    position: sticky;
    top: 20px;
    max-height: calc(100dvh - 130px);
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-color: #d5deeb transparent;
    border: 1px solid var(--detail-border);
    border-radius: 14px;
    background: #fff;
  }
  .content-card {
    border: 1px solid var(--detail-border);
    border-radius: 14px;
    min-height: 460px;
    box-shadow: 0 4px 20px #263f6604;
  }
  :deep(.content-card > .n-card__content) {
    padding: 8px 24px 24px;
  }
  :deep(.content-card > .n-card__content > .n-tabs > .n-tabs-nav) {
    padding-top: 8px;
  }
  :deep(.content-card .n-tab-pane) {
    padding-top: 24px !important;
  }
  :deep(.content-card .n-tabs-tab) {
    font-size: 14px;
    font-weight: 500;
  }
  :deep(.detail-progress .n-card) {
    border: 0;
    border-radius: 14px;
  }
  :deep(.detail-progress .n-card-header) {
    padding: 20px 20px 16px;
  }
  :deep(.detail-progress .n-card__content) {
    padding: 0 20px 20px;
  }
  :deep(.detail-progress .n-card-header__main) {
    font-size: 15px;
    font-weight: 600;
  }
  :deep(.detail-progress .flow-body > .spread) {
    align-items: flex-start;
    gap: 8px;
  }
  :deep(.detail-progress .flow-body > .spread > strong) {
    flex: 1;
    line-height: 1.7;
  }
  :deep(.detail-progress .flow-step:last-child) {
    padding-bottom: 0;
  }
  .detail-tab-label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .tab-count {
    min-width: 20px;
    padding: 0 5px;
    background: #edf2fb;
    color: #5e789f;
    border-radius: 5px;
    font-size: 11px;
    line-height: 20px;
    text-align: center;
  }
  :deep(.detail-section h2) {
    font-size: 15px;
    color: var(--detail-text);
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
    font-size: 16px;
    margin: 0 0 6px;
  }
  .section-intro p {
    color: var(--detail-muted);
    font-size: 13px;
    line-height: 1.7;
    margin: 0 0 20px;
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
  :deep(.info-grid dt) {
    font-size: 12px;
  }
  :deep(.application-attachments .compact-empty) {
    margin-bottom: 0;
  }
  @media (max-width: 1200px) {
    .activity-detail-grid {
      grid-template-columns: minmax(0, 1fr) 304px;
      gap: 16px;
    }
    :deep(.content-card > .n-card__content) {
      padding: 8px 20px 20px;
    }
  }
  @media (max-width: 1000px) {
    .activity-detail-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .detail-progress {
      position: static;
      max-height: none;
    }
  }
  @media (max-width: 600px) {
    .detail-navigation {
      gap: 10px;
    }
    .navigation-caption {
      display: none;
    }
    .detail-navigation > :last-child {
      margin-left: auto;
    }
    :deep(.content-card > .n-card__content) {
      padding: 4px 16px 20px;
    }
    :deep(.content-card .n-tab-pane) {
      padding-top: 20px !important;
    }
    .activity-detail-grid {
      margin-top: 16px;
    }
  }
</style>
