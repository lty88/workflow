<script setup lang="tsx">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { NAlert, NButton, NCard, NEmpty, NSpin, NTag, NTabs, NTabPane } from 'naive-ui';
import { STATUSES, visibleFields } from '@workflow/domain';
import type { WorkflowTask, FileRecord } from '@workflow/domain';
import type { ActivityDetail } from '../../typings/api';
import { activityApi, submitApi } from '../../api';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/use-feedback';
import { formatTime, formatMoney } from '../../composables/format';
import { ACTION_LABELS } from '../../components/activity/types';
import WorkflowTimeline from '../../components/activity/WorkflowTimeline.vue';
import ActionDrawer from '../../components/activity/ActionDrawer.vue';
import AdjustmentDrawer from '../../components/activity/AdjustmentDrawer.vue';
import AttachmentList from '../../components/activity/AttachmentList.vue';
import ActivityEditor from '../../components/activity/ActivityEditor.vue';
import TransferDrawer from '../../components/activity/TransferDrawer.vue';
const transferOpen = ref(false);
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedback();
const detail = ref<ActivityDetail | null>(null);
const loading = ref(false);
const errorText = ref('');
const action = ref('');
const task = ref<WorkflowTask>();
const actionOpen = ref(false);
const adjustmentOpen = ref(false);
const edit = ref(false);
const busy = ref(false);
const stage = ref<FileRecord['stage']>('application');
const fields = computed(() =>
  detail.value ? visibleFields(detail.value.activity.schema, detail.value.activity.payload) : [],
);
const actions = computed(() => (detail.value?.actions || []).filter(visibleAction));
/**
 * 检查当前用户在所选附件阶段的上传资格。
 * @returns 是否允许上传
 */
function uploadAllowed(): boolean {
  const a = detail.value?.activity;
  if (!a) return false;
  if (stage.value === 'application') return !!detail.value?.actions.includes('edit');
  if (stage.value === 'execution')
    return a.executor === auth.profile?.user.id && a.status === 'executing' && auth.can('execution:report');
  return a.applicant === auth.profile?.user.id && a.status === 'archive_draft' && auth.can('activity:submit');
}
const canUpload = computed(uploadAllowed);
/**
 * 将导出动作作为独立下载链接展示。
 * @param value 动作码
 * @returns 是否按钮
 */
function visibleAction(value: string): boolean {
  return value !== 'export';
}
/**
 * 读取详情与最新个人操作能力。
 */
async function load(): Promise<void> {
  loading.value = true;
  try {
    detail.value = await activityApi(String(route.params.id));
    errorText.value = '';
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '读取失败';
  } finally {
    loading.value = false;
  }
}
/**
 * 展示本人的任务办理抽屉。
 * @param value 个人任务
 */
function decide(value: WorkflowTask): void {
  task.value = value;
  action.value = '';
  actionOpen.value = true;
}
/**
 * 路由业务按钮到编辑、提交或相应办理表单。
 * @param value 动作码
 */
async function handleAction(value: string): Promise<void> {
  if (!detail.value?.actions.includes(value)) return;
  if (value === 'copy') {
    await router.push({ path: '/activities/new', query: { copyId: detail.value.activity.id } });
    return;
  }
  if (value === 'edit') {
    edit.value = true;
    return;
  }
  if (value === 'adjust') {
    adjustmentOpen.value = true;
    return;
  }
  if (value === 'submit') {
    busy.value = true;
    try {
      await submitApi(detail.value.activity.id, detail.value.activity.version);
      feedback.success('已提交');
      await load();
    } catch (error) {
      feedback.failure(error);
    } finally {
      busy.value = false;
    }
    return;
  }
  task.value = undefined;
  action.value = value;
  actionOpen.value = true;
}
/**
 * 显示参与人姓名。
 * @param id 人员标识
 * @returns 姓名
 */
function nameFor(id: string): string {
  return (
    detail.value?.participants.find(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param person 当前集合项
       * @returns 是否符合筛选条件
       */ function match(person) {
        return person.id === id;
      },
    )?.name ||
    id ||
    '—'
  );
}
/**
 * 退出编辑并重新读取草稿。
 */
async function closeEdit(): Promise<void> {
  edit.value = false;
  await load();
}
/**
 * 打开流程负责人专用的个人待办转交表单。
 * @param value 个人任务
 */
function transfer(value: WorkflowTask): void {
  task.value = value;
  transferOpen.value = true;
}
onMounted(load);
</script>
<style scoped>
.activity-detail-grid {
  grid-template-columns: minmax(0, 1fr);
}
</style>
<template>
  <NSpin :show="loading"
    ><div v-if="errorText" class="error-box">
      <NAlert type="error" :title="errorText"><NButton text @click="load">重新读取</NButton></NAlert>
    </div>
    <template v-else-if="detail"
      ><template v-if="edit"
        ><NButton class="mb" @click="closeEdit">返回详情</NButton
        ><ActivityEditor :activity-id="detail.activity.id" /></template
      ><template v-else
        ><div class="page-heading">
          <div>
            <span class="eyebrow">{{ detail.activity.code }} · 第{{ detail.activity.revision }}次申请</span>
            <h1>{{ detail.activity.name || '未命名活动' }}</h1>
            <p>{{ nameFor(detail.activity.applicant) }} 发起 · {{ formatTime(detail.activity.createdAt) }}</p>
          </div>
          <div class="gap">
            <NTag :bordered="false" type="info">{{ STATUSES[detail.activity.status] }}</NTag
            ><NButton size="small" @click="load">刷新</NButton
            ><a
              v-if="detail.actions.includes('export')"
              :href="'/api/activities/' + detail.activity.id + '/export'"
              target="_blank"
              rel="noopener"
              >导出</a
            >
          </div>
        </div>
        <NAlert v-if="detail.activity.status === 'needs_info'" type="warning" class="mb"
          >申请被退回，请查看审核意见。修改后重新提交会生成新的审批轮次。</NAlert
        ><NAlert
          v-if="detail.activity.cancellation && detail.activity.status === 'cancel_review'"
          type="warning"
          class="mb"
          >取消审核中：{{ detail.activity.cancellation.reason }} · 审核人：{{
            nameFor(detail.activity.cancellation.reviewer)
          }}</NAlert
        >
        <div class="detail-grid activity-detail-grid">
          <div class="stack">
            <NCard
              ><NTabs type="line" animated
                ><NTabPane name="application" tab="申请信息"
                  ><div class="detail-data" style="padding-top: 18px">
                    <div
                      v-for="field in fields"
                      :key="field.id"
                      :class="{ 'form-wide': field.type === 'textarea' }"
                    >
                      <div class="detail-label">{{ field.label }}</div>
                      <div class="detail-value">
                        {{
                          field.key === 'budget' || field.key.endsWith('_fee')
                            ? formatMoney(detail.activity.payload[field.key])
                            : field.type === 'datetime'
                              ? formatTime(detail.activity.payload[field.key])
                              : detail.activity.payload[field.key] || '—'
                        }}
                      </div>
                    </div>
                  </div></NTabPane
                ><NTabPane name="execution" tab="执行与成果"
                  ><div class="detail-data" style="padding-top: 18px">
                    <div>
                      <div class="detail-label">执行人</div>
                      {{ nameFor(detail.activity.executor) }}
                    </div>
                    <div>
                      <div class="detail-label">实际开始</div>
                      {{ formatTime(detail.activity.actualStart) }}
                    </div>
                    <div class="form-wide">
                      <div class="detail-label">执行安排</div>
                      <div class="detail-value">{{ detail.activity.assignment || '—' }}</div>
                    </div>
                    <template v-if="detail.activity.report"
                      ><div>
                        <div class="detail-label">实到人数</div>
                        {{ detail.activity.report.people }} 人
                      </div>
                      <div>
                        <div class="detail-label">实际支出</div>
                        {{ formatMoney(detail.activity.report.spend) }}
                      </div>
                      <div class="form-wide">
                        <div class="detail-label">实际活动时间</div>
                        {{ formatTime(detail.activity.report.start) }} —
                        {{ formatTime(detail.activity.report.end) }}
                      </div>
                      <div class="form-wide">
                        <div class="detail-label">执行成果</div>
                        <div class="detail-value">{{ detail.activity.report.summary }}</div>
                      </div>
                      <div v-if="detail.activity.report.exception" class="form-wide">
                        <div class="detail-label">异常说明</div>
                        {{ detail.activity.report.exception }}
                      </div></template
                    ><template v-if="detail.activity.archive"
                      ><div class="form-wide">
                        <div class="detail-label">归档摘要 · 第{{ detail.activity.archive.version }}版</div>
                        <div class="detail-value">{{ detail.activity.archive.summary }}</div>
                        <a
                          v-if="detail.activity.archive.url"
                          :href="detail.activity.archive.url"
                          target="_blank"
                          rel="noopener noreferrer"
                          >查看成果链接 ↗</a
                        >
                      </div>
                      <div>
                        <div class="detail-label">档案审核人</div>
                        {{ nameFor(detail.activity.archive.reviewer) }}
                      </div>
                      <div>
                        <div class="detail-label">档案编号</div>
                        {{ detail.activity.archive.code || '待审核' }}
                      </div>
                      <div class="form-wide">
                        <div class="detail-label">归档意见</div>
                        {{ detail.activity.archive.comment || '—' }}
                      </div></template
                    >
                  </div></NTabPane
                ><NTabPane name="history" tab="操作记录"
                  ><div style="padding-top: 18px">
                    <div
                      v-for="item in [...detail.activity.audit].reverse()"
                      :key="item.id"
                      class="audit-item"
                    >
                      <strong>{{ item.action }}</strong
                      ><small>{{ item.actorName }} · {{ formatTime(item.createdAt) }}</small>
                      <p>{{ item.note }}</p>
                    </div>
                    <NEmpty v-if="!detail.activity.audit.length" description="暂无记录" /></div></NTabPane
                ><NTabPane name="versions" tab="申请版本"
                  ><div
                    v-for="snapshot in detail.activity.snapshots"
                    :key="snapshot.revision"
                    class="config-item"
                  >
                    <div>
                      <strong>第{{ snapshot.revision }}次申请</strong
                      ><small
                        >{{ formatTime(snapshot.submittedAt) }} · 配置V{{ snapshot.configVersion }} ·
                        {{ snapshot.schema.fields.length }}个字段</small
                      >
                    </div>
                    <span>{{ formatMoney(snapshot.payload.budget) }}</span>
                  </div></NTabPane
                ></NTabs
              ></NCard
            ><NCard title="附件资料"
              ><div class="gap mb">
                <NButton
                  v-for="item in (['application', 'execution', 'archive'] as const)"
                  :key="item"
                  :type="stage === item ? 'primary' : 'default'"
                  size="small"
                  @click="stage = item"
                  >{{
                    { application: '申请阶段', execution: '执行阶段', archive: '归档阶段' }[item]
                  }}</NButton
                >
              </div>
              <AttachmentList
                :activity-id="detail.activity.id"
                :files="detail.files"
                :stage="stage"
                :can-upload="canUpload"
                @uploaded="load"
            /></NCard>
          </div>
          <NCard title="审批流程与办理"
            ><template #header-extra
              ><span class="muted">R{{ detail.activity.structureRevision }}</span></template
            ><WorkflowTimeline :detail="detail" @decide="decide" @transfer="transfer"
          /></NCard>
        </div>
        <div v-if="actions.length" class="sticky-actions">
          <span class="muted">当前可办理事项</span>
          <div class="gap">
            <NButton
              v-for="item in actions"
              :key="item"
              :loading="busy"
              :type="
                ['edit', 'withdraw', 'adjust', 'cancel-request', 'cancel-withdraw'].includes(item)
                  ? 'default'
                  : 'primary'
              "
              @click="handleAction(item)"
              >{{ ACTION_LABELS[item] || item }}</NButton
            >
          </div>
        </div>
        <TransferDrawer v-model:show="transferOpen" :detail="detail" :task="task" @done="load" /><ActionDrawer
          v-model:show="actionOpen"
          :detail="detail"
          :action="action"
          :task="task"
          @done="load" /><AdjustmentDrawer
          v-model:show="adjustmentOpen"
          :detail="detail"
          @done="load" /></template></template
    ><NEmpty v-else-if="!loading" description="未找到活动"
  /></NSpin>
</template>
