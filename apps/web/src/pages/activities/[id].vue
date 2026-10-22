<script setup lang="tsx">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { NAlert, NButton, NCard, NEmpty, NSelect, NSpin, NTag } from 'naive-ui';
import { STATUSES, visibleFields } from '@workflow/domain';
import type { WorkflowTask, FileRecord, FormField } from '@workflow/domain';
import type { ActivityDetail } from '@/typings/api';
import { activityApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useFeedback } from '@/composables/use-feedback';
import { formatTime, formatMoney } from '@/composables/format';
import { ACTION_LABELS } from '@/components/activity/types';
import WorkflowTimeline from '@/components/activity/WorkflowTimeline.vue';
import ActionDrawer from '@/components/activity/ActionDrawer.vue';
import AdjustmentDrawer from '@/components/activity/AdjustmentDrawer.vue';
import AttachmentList from '@/components/activity/AttachmentList.vue';
import ActivityEditor from '@/components/activity/ActivityEditor.vue';
import TransferDrawer from '@/components/activity/TransferDrawer.vue';
import NodeMaterialsPanel from '@/components/activity/NodeMaterialsPanel.vue';
import ActivityEvaluationPanel from '@/components/evaluations/ActivityEvaluationPanel.vue';
import ActivityDeleteButton from '@/components/activity/ActivityDeleteButton.vue';
const transferOpen = ref(false);
const route = useRoute('/activities/[id]');
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
const revision = ref('current');
const actions = computed(() => (detail.value?.actions || []).filter(visibleAction));
const STATUS_TONE: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  draft: 'default',
  approving: 'info',
  needs_info: 'warning',
  withdrawn: 'default',
  rejected: 'error',
  ready_assign: 'info',
  ready_execute: 'info',
  executing: 'success',
  archive_draft: 'warning',
  archive_review: 'info',
  archived: 'success',
  cancel_review: 'warning',
  cancelled: 'default',
};
const EXECUTION_STATUSES = [
  'ready_assign',
  'ready_execute',
  'executing',
  'archive_draft',
  'archive_review',
  'archived',
];
const ACTION_STYLES: Record<string, 'primary' | 'ghost'> = {
  edit: 'primary',
  submit: 'primary',
  assign: 'primary',
  start: 'primary',
  report: 'primary',
  'archive-submit': 'primary',
  'archive-approve': 'primary',
  'cancel-approve': 'primary',
  'cancel-request': 'ghost',
  copy: 'ghost',
};
const statusTone = computed(() => STATUS_TONE[detail.value?.activity.status ?? 'draft'] ?? 'default');
/**
 * 计算当前查看的申请数据：当前内容或指定历史快照。
 * @returns 表单定义、填写数据与是否历史快照
 */
const viewData = computed(() => {
  const item = detail.value?.activity;
  if (!item) return null;
  if (revision.value !== 'current') {
    const snapshot = item.snapshots.find((entry) => String(entry.revision) === revision.value);
    if (snapshot) return { schema: snapshot.schema, payload: snapshot.payload, old: true };
  }
  return { schema: item.schema, payload: item.payload, old: false };
});
const isOld = computed(() => viewData.value?.old ?? false);
const templateLabel = computed(() => {
  const item = detail.value?.activity;
  if (!item) return '';
  if (revision.value !== 'current')
    for (const snapshot of item.snapshots)
      if (String(snapshot.revision) === revision.value)
        return snapshot.templateName
          ? `流程模板：${snapshot.templateName} · V${snapshot.templateVersion}`
          : '历史流程快照';
  return item.templateName ? `流程模板：${item.templateName} · V${item.templateVersion}` : '历史流程快照';
});
const fields = computed(() =>
  viewData.value ? visibleFields(viewData.value.schema, viewData.value.payload) : [],
);
/**
 * 判断动态字段是否为金额字段，金额进入费用预算表展示。
 * @param field 字段定义
 * @returns 是否金额字段
 */
function isMoneyField(field: FormField): boolean {
  return field.key === 'budget' || field.key.endsWith('_fee');
}
const moneyFields = computed(() => fields.value.filter(isMoneyField));
const infoFields = computed(() =>
  fields.value.filter((field) => !isMoneyField(field) && field.type !== 'textarea'),
);
const textFields = computed(() => fields.value.filter((field) => field.type === 'textarea'));
const budgetRestricted = computed(() => {
  if (revision.value === 'current' && detail.value?.access?.hiddenFieldKeys.includes('budget')) return true;
  for (const field of viewData.value?.schema.fields || [])
    if (field.key === 'budget') return !!field.redacted;
  return true;
});
const budgetTotal = computed(() =>
  moneyFields.value.reduce((total, field) => {
    const amount = Number(viewData.value?.payload[field.key]);
    return Number.isFinite(amount) ? total + amount : total;
  }, 0),
);
const revisionOptions = computed(() => [
  { label: '当前申请内容', value: 'current' },
  ...(detail.value?.activity.snapshots || []).map((snapshot) => ({
    label: '申请 V' + snapshot.revision + ' · ' + formatTime(snapshot.submittedAt),
    value: String(snapshot.revision),
  })),
]);
const executionVisible = computed(() => {
  const item = detail.value?.activity;
  if (!item) return false;
  return EXECUTION_STATUSES.includes(item.status) || !!item.report || !!item.archive || !!item.assignment;
});
const nextHint = computed(() => {
  const item = detail.value?.activity;
  if (!item) return null;
  if (item.status === 'approving') {
    const nodes = item.nodes.filter((node) => node.status === 'active');
    const owners = [...new Set(nodes.flatMap((node) => node.assignees))].map(nameFor).join('、');
    return {
      owner: owners || '—',
      text: nodes.length ? '等待' + nodes.map((node) => node.label).join('、') + '审批' : '等待审批',
    };
  }
  const hints: Record<string, { owner: string; text: string }> = {
    draft: { owner: nameFor(item.applicant), text: '填写资料并提交申请' },
    needs_info: { owner: nameFor(item.applicant), text: '按退回意见补充后重新提交' },
    withdrawn: { owner: nameFor(item.applicant), text: '修改后可重新提交' },
    cancel_review: { owner: nameFor(item.applicant), text: '取消审批处理中，执行操作已冻结' },
    ready_assign: { owner: '—', text: '审批已完成，请指派执行人' },
    ready_execute: { owner: nameFor(item.executor), text: '按计划时间开始执行' },
    executing: { owner: nameFor(item.executor), text: '完成后提交执行汇报' },
    archive_draft: { owner: nameFor(item.applicant), text: '补齐成果材料并提交档案' },
    archive_review: {
      owner: item.archive ? nameFor(item.archive.reviewer) : '—',
      text: '核查执行结果与成果后归档',
    },
    archived: { owner: '—', text: '活动闭环完成，档案只读' },
    rejected: { owner: '—', text: '查看拒绝原因，可复制为新申请' },
    cancelled: { owner: '—', text: '活动已取消，可复制为新申请' },
  };
  return hints[item.status] || { owner: '—', text: '查看办理记录' };
});
/**
 * 检查当前用户在指定附件阶段的上传资格。
 * @param target 附件阶段
 * @returns 是否允许上传
 */
function uploadAllowed(target: FileRecord['stage']): boolean {
  const a = detail.value?.activity;
  if (!a) return false;
  if (target === 'application') return !!detail.value?.actions.includes('edit');
  if (target === 'execution')
    return a.executor === auth.profile?.user.id && a.status === 'executing' && auth.can('execution:report');
  return a.applicant === auth.profile?.user.id && a.status === 'archive_draft' && auth.can('activity:submit');
}
const applicationUpload = computed(() => uploadAllowed('application') && !isOld.value);
const executionUpload = computed(() => uploadAllowed('execution'));
const archiveUpload = computed(() => uploadAllowed('archive'));
/**
 * 将导出动作作为独立下载链接展示。
 * @param value 动作码
 * @returns 是否按钮
 */
function visibleAction(value: string): boolean {
  return value !== 'export' && value !== 'delete';
}
/**
 * 按原型规范返回动作按钮的 Naive UI 类型与弱化标记。
 * @param code 动作码
 * @returns 按钮样式参数
 */
function actionStyle(code: string): {
  type: 'primary' | 'default';
  ghost: boolean;
} {
  if (ACTION_STYLES[code] === 'primary') return { type: 'primary', ghost: false };
  return { type: 'default', ghost: ACTION_STYLES[code] === 'ghost' };
}
/**
 * 读取详情与最新个人操作能力，历史快照失效时回退到当前内容。
 */
async function load(): Promise<void> {
  loading.value = true;
  try {
    detail.value = await activityApi(String(route.params.id));
    errorText.value = '';
    const item = detail.value.activity;
    if (
      revision.value !== 'current' &&
      !item.snapshots.some((entry) => String(entry.revision) === revision.value)
    )
      revision.value = 'current';
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '读取失败';
  } finally {
    loading.value = false;
  }
}
/** 删除成功后回到当前账号有权访问的活动列表。 */
async function afterDelete(): Promise<void> {
  let destination = '/';
  for (const menu of auth.profile?.menus || [])
    if (menu.component === 'activity_list') {
      destination = '/workspace/' + menu.id;
      break;
    }
  await router.replace(destination);
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
 * 路由业务按钮到编辑预览或相应办理表单，提交前必须确认模板路线。
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
    edit.value = true;
    feedback.success('请核对流程模板并计算实际路线后提交');
    return;
  }
  task.value = undefined;
  action.value = value;
  actionOpen.value = true;
}
/**
 * 按字段类型格式化展示值。
 * @param field 字段定义
 * @returns 展示文本
 */
function displayValue(field: FormField): string {
  const raw = viewData.value?.payload[field.key];
  if (field.redacted) return raw || '权限受限';
  if (isMoneyField(field)) return formatMoney(raw);
  if (field.type === 'datetime') return formatTime(raw);
  return raw || '未填写';
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
  grid-template-columns: minmax(0, 1fr) 400px;
}
@media (max-width: 1150px) {
  .activity-detail-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
<template>
  <NSpin :show="loading"
    ><div v-if="errorText" class="error-box">
      <NAlert type="error" :title="errorText"
        ><div class="gap">
          <NButton size="small" type="primary" @click="load">重新读取</NButton
          ><NButton size="small" @click="router.push('/activities')">返回活动工单</NButton>
        </div></NAlert
      >
    </div>
    <template v-else-if="detail"
      ><template v-if="edit"
        ><NButton class="mb" @click="closeEdit">返回详情</NButton
        ><ActivityEditor :activity-id="detail.activity.id" @submitted="closeEdit" /></template
      ><template v-else
        ><NButton text class="back" @click="router.push('/activities')">← 返回活动工单</NButton>
        <div class="detail-grid activity-detail-grid">
          <div>
            <NCard class="detail-summary"
              ><div class="detail-title">
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
                    budgetRestricted
                      ? '部分金额受限'
                      : formatMoney(viewData?.payload.budget || String(budgetTotal))
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
              <NAlert v-if="detail.access?.hiddenFieldKeys.length" type="info" :bordered="false" class="mb"
                >部分资料已按当前身份隐藏或脱敏；审批办理状态和公开结论仍可查看。</NAlert
              >
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
              <div v-if="executionVisible" class="detail-section">
                <h2>执行安排</h2>
                <p>执行人：{{ nameFor(detail.activity.executor) }}</p>
                <p v-if="detail.activity.assignment">{{ detail.activity.assignment }}</p>
                <p class="sub-label">执行资料附件</p>
                <AttachmentList
                  :activity-id="detail.activity.id"
                  :files="detail.files"
                  :activity-version="detail.activity.version"
                  stage="execution"
                  :can-upload="executionUpload"
                  @uploaded="load"
                />
              </div>
              <div v-if="detail.activity.report" class="detail-section">
                <h2>执行汇报</h2>
                <dl class="info-grid">
                  <div>
                    <dt>实际开始</dt>
                    <dd>{{ formatTime(detail.activity.report.start) }}</dd>
                  </div>
                  <div>
                    <dt>实际结束</dt>
                    <dd>{{ formatTime(detail.activity.report.end) }}</dd>
                  </div>
                  <div>
                    <dt>实到人数</dt>
                    <dd>{{ detail.activity.report.people }} 人</dd>
                  </div>
                  <div>
                    <dt>实际支出参考</dt>
                    <dd>
                      {{
                        detail.activity.report.spend
                          ? formatMoney(detail.activity.report.spend)
                          : '未提供或权限受限'
                      }}
                    </dd>
                  </div>
                </dl>
                <p style="margin-top: 15px">{{ detail.activity.report.summary }}</p>
                <template v-if="detail.activity.report.exception"
                  ><p class="sub-label">异常说明</p>
                  <p>{{ detail.activity.report.exception }}</p></template
                >
              </div>
              <div v-if="detail.activity.archive" class="detail-section">
                <h2>
                  活动档案
                  <small
                    >提交 V{{ detail.activity.archive.version
                    }}{{ detail.activity.archive.code ? ' · ' + detail.activity.archive.code : '' }}</small
                  >
                </h2>
                <p>{{ detail.activity.archive.summary }}</p>
                <p v-if="detail.activity.archive.url" style="margin-top: 10px">
                  <a :href="detail.activity.archive.url" target="_blank" rel="noopener noreferrer"
                    >查看成果链接 ↗</a
                  >
                </p>
                <dl class="info-grid">
                  <div>
                    <dt>提交人</dt>
                    <dd>{{ nameFor(detail.activity.archive.submittedBy) }}</dd>
                  </div>
                  <div>
                    <dt>审核人</dt>
                    <dd>{{ nameFor(detail.activity.archive.reviewer) }}</dd>
                  </div>
                  <div>
                    <dt>档案编号</dt>
                    <dd>{{ detail.activity.archive.code || '待审核' }}</dd>
                  </div>
                  <div>
                    <dt>归档意见</dt>
                    <dd>{{ detail.activity.archive.comment || '—' }}</dd>
                  </div>
                </dl>
                <p class="sub-label">成果附件</p>
                <AttachmentList
                  :activity-id="detail.activity.id"
                  :files="detail.files"
                  :activity-version="detail.activity.version"
                  stage="archive"
                  :can-upload="archiveUpload"
                  @uploaded="load"
                />
              </div>
              <div v-if="detail.activity.archives.length" class="detail-section">
                <h2>历次档案提交</h2>
                <div
                  v-for="attempt in [...detail.activity.archives].reverse()"
                  :key="attempt.version"
                  class="history-item"
                >
                  <strong>档案 V{{ attempt.version }} · {{ attempt.code || '历史提交' }}</strong>
                  <p>{{ attempt.summary }}{{ attempt.comment ? '\n审核意见：' + attempt.comment : '' }}</p>
                </div>
              </div>
              <div v-if="!isOld" class="detail-actions">
                <template v-if="actions.length"
                  ><NButton
                    v-for="item in actions"
                    :key="item"
                    :loading="busy"
                    :type="actionStyle(item).type"
                    :quaternary="actionStyle(item).ghost"
                    @click="handleAction(item)"
                    >{{ ACTION_LABELS[item] || item }}</NButton
                  ></template
                ><small v-else-if="!detail.actions.includes('delete')" class="muted"
                  >当前身份暂无可办理动作，可查看申请与历史记录。</small
                >
                <ActivityDeleteButton
                  :activity="detail.activity"
                  :allowed="detail.actions.includes('delete')"
                  @deleted="afterDelete"
                  @refresh="load"
                /></div
            ></NCard>
            <ActivityEvaluationPanel
              v-if="auth.can('evaluation:read') || auth.can('evaluation:manage')"
              :activity="detail.activity"
              class="mt"
            />
          </div>
          <div class="stack">
            <NCard title="办理进度"
              ><template #header-extra
                ><span class="muted">申请 V{{ detail.activity.revision }}</span></template
              ><WorkflowTimeline :detail="detail" @decide="decide" @transfer="transfer"
            /></NCard>
            <NCard title="办理记录"
              ><template #header-extra
                ><span class="muted">{{ detail.activity.audit.length }} 条</span></template
              >
              <div class="history">
                <div v-for="item in [...detail.activity.audit].reverse()" :key="item.id" class="history-item">
                  <strong>{{ ACTION_LABELS[item.action] || item.action }} · {{ item.actorName }}</strong>
                  <p v-if="item.note">{{ item.note }}</p>
                  <time>{{ formatTime(item.createdAt) }}</time>
                </div>
                <NEmpty v-if="!detail.activity.audit.length" description="暂无记录" size="small" /></div
            ></NCard>
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
          @done="load" /></template
    ></template>
    <div v-else-if="!loading" class="error-box">
      <NEmpty description="未找到活动"
        ><NButton size="small" @click="router.push('/activities')">返回活动工单</NButton></NEmpty
      >
    </div>
  </NSpin>
</template>
