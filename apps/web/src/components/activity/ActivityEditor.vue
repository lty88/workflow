<script setup lang="tsx">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { NAlert, NButton, NCard, NSteps, NStep, NSpin, NEmpty, NTag } from 'naive-ui';
import { defaultValues } from '@workflow/domain';
import type { ActivityDetail, WorkflowPreview } from '@/typings/api';
import { activityApi, saveDraftApi, submitApi } from '@/api';
import { templatePreviewApi } from '@/api/templates';
import { useAuthStore } from '@/stores/auth';
import { useFeedback } from '@/composables/use-feedback';
import { clone } from '@/composables/format';
import { ApiError, errorMessages } from '@/api/http';
import type { SubmissionAttempt } from './types';
import { useActivityTemplate } from './use-activity-template';
import { useActivitySteps } from './use-activity-steps';
import ActivityValidationErrors from './ActivityValidationErrors.vue';
import DynamicForm from './DynamicForm.vue';
import AttachmentList from './AttachmentList.vue';
import WorkflowTimeline from './WorkflowTimeline.vue';
import ActivityTemplateSelector from '@/components/templates/ActivityTemplateSelector.vue';
const route = useRoute();
const props = defineProps<{ activityId?: string }>();
const emit = defineEmits<{ saved: []; submitted: [] }>();
const auth = useAuthStore();
const feedback = useFeedback();
const router = useRouter();
const payload = ref<Record<string, string>>(auth.profile ? defaultValues(auth.profile.form) : {});
const detail = ref<ActivityDetail | null>(null);
const savedId = ref(props.activityId || '');
const version = ref(0);
const busy = ref(false);
const loading = ref(false);
const preview = ref<WorkflowPreview | null>(null);
const loadError = ref('');
const submission = ref<SubmissionAttempt | null>(null);
const previewFingerprint = ref('');
const {
  templates,
  activityTypes,
  selection,
  templateNotice,
  selectedTemplate,
  schema,
  refreshTemplates,
  restoreSelection,
  recoverTemplate,
} = useActivityTemplate({
  payload,
  fallbackForm: computed(() => auth.profile!.form),
  existingDetail: computed(() => detail.value),
  invalidatePreview,
});
const hasTemplate = computed(() => {
  const current = selection.value;
  const candidate = selectedTemplate.value;
  return (
    !!current &&
    !!candidate &&
    candidate.definition.activityTypeIds.includes(current.activityTypeId) &&
    candidate.version === current.expectedTemplateVersion
  );
});
const { step, errors, issues, sectionKeys, changeStep, locateError, validateAll } = useActivitySteps({
  schema,
  payload,
  hasTemplate,
  disabled: computed(() => busy.value || loading.value || !!submission.value),
});
/**
 * 组合模板选择与输入作为预览凭据，变化后必须重新确认。
 * @returns 当前输入摘要
 */
function fingerprint(): string {
  return JSON.stringify({ selection: selection.value, payload: payload.value });
}
/** 清除旧审批路线与确认凭据，避免提交使用不匹配的预览。 */
function invalidatePreview(): void {
  preview.value = null;
  previewFingerprint.value = '';
}
/** 手动刷新模板目录，保留输入并要求重新预览。 */
async function reloadTemplates(): Promise<void> {
  if (busy.value || submission.value) return;
  busy.value = true;
  try {
    await refreshTemplates();
    invalidatePreview();
    templateNotice.value = '模板列表已刷新，请核对选择并重新预览。';
  } catch (error) {
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/**
 * 读取授权模板、草稿与附件，检查编辑资格并明确采用的模板版本。
 */
async function load(): Promise<void> {
  loading.value = true;
  try {
    await refreshTemplates();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '模板读取失败';
    loading.value = false;
    return;
  }
  if (!savedId.value && route.query.copyId) {
    loading.value = true;
    try {
      const source = await activityApi(String(route.query.copyId));
      if (!source.actions.includes('copy')) throw new Error('无复制申请权限');
      restoreSelection(source.activity);
      payload.value = {
        ...defaultValues(schema.value),
        ...clone(source.activity.payload),
        activity_name: source.activity.name + '（副本）',
        start_at: '',
        end_at: '',
      };
    } catch (error) {
      feedback.failure(error);
    } finally {
      loading.value = false;
    }
    return;
  }
  if (!savedId.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const result = await activityApi(savedId.value);
    if (!result.actions.includes('edit')) throw new Error('当前工单不可编辑，请返回详情');
    detail.value = result;
    restoreSelection(result.activity);
    payload.value = { ...defaultValues(schema.value), ...clone(result.activity.payload) };
    version.value = result.activity.version;
    loadError.value = '';
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败';
    feedback.failure(error);
  } finally {
    loading.value = false;
  }
}
/**
 * 保存所选模板版本和当前输入，草稿允许暂缺业务必填信息。
 * @returns 已保存工单标识
 */
async function persist(): Promise<string> {
  if (!selection.value) throw new Error('请选择活动类型和流程模板');
  const result = await saveDraftApi(
    payload.value,
    savedId.value || undefined,
    version.value || undefined,
    selection.value,
  );
  savedId.value = result.id;
  version.value = result.version;
  detail.value = await activityApi(result.id);
  emit('saved');
  return result.id;
}
/**
 * 保存草稿后留在当前编辑页。
 */
async function save(): Promise<void> {
  if (!auth.can('activity:create') || submission.value) return;
  busy.value = true;
  try {
    await persist();
    feedback.success('草稿已保存');
  } catch (error) {
    await recoverTemplate(error);
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/**
 * 校验所选模板冻结表单，预览实际审批路线并保存预览凭据。
 */
async function showPreview(): Promise<void> {
  if (busy.value || submission.value || !validateAll()) return;
  const selected = selection.value;
  if (!selected) return;
  busy.value = true;
  try {
    const inputFingerprint = fingerprint();
    const result = await templatePreviewApi(selected, payload.value, savedId.value || undefined);
    if (inputFingerprint !== fingerprint()) return;
    preview.value = result;
    previewFingerprint.value = inputFingerprint;
    errors.value = preview.value.errors;
  } catch (error) {
    await recoverTemplate(error);
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/**
 * 确认当前输入已经预览后保存并提交模板版本，网络失败保留原提交凭据。
 */
async function submit(): Promise<void> {
  if (!auth.can('activity:submit') || busy.value) return;
  if (!submission.value && !validateAll()) return;
  if (submission.value) {
    errors.value = [];
    issues.value = [];
  }
  busy.value = true;
  try {
    if (!submission.value) {
      if (
        !selection.value ||
        !preview.value ||
        previewFingerprint.value !== fingerprint() ||
        preview.value.errors.length
      )
        throw new Error('请先计算并确认当前模板的实际路线，再提交申请');
      const id = await persist();
      submission.value = {
        id,
        version: version.value,
        templateVersion: selection.value.expectedTemplateVersion,
      };
    }
    const { id, version: submittedVersion } = submission.value;
    await submitApi(id, submittedVersion, submission.value.templateVersion);
    submission.value = null;
    feedback.success('申请已提交，审批任务已生成');
    emit('submitted');
    await router.push('/activities/' + id);
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) submission.value = null;
    await recoverTemplate(error);
    errors.value = errorMessages(error);
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/**
 * 上传附件后刷新主单版本，保留当前编辑输入。
 */
async function refreshFiles(): Promise<void> {
  if (!savedId.value) return;
  try {
    detail.value = await activityApi(savedId.value);
    version.value = detail.value.activity.version;
  } catch (error) {
    feedback.failure(error);
  }
}
onMounted(load);
watch(payload, invalidatePreview, { deep: true });
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <span class="eyebrow">NEW APPLICATION</span>
        <h1>{{ activityId ? '编辑活动申请' : '发起活动申请' }}</h1>
        <p>
          发起人：{{ detail?.activity.applicantName || auth.profile?.user.name }} ·
          表单由公司配置动态生成，提交后保留版本快照。
        </p>
      </div>
      <div class="gap">
        <NButton :disabled="busy || !!submission" @click="reloadTemplates">刷新模板</NButton
        ><NTag :bordered="false" type="info">{{
          selectedTemplate ? selectedTemplate.definition.name + ' V' + selectedTemplate.version : '请选择模板'
        }}</NTag>
      </div>
    </div>
    <NSpin :show="loading"
      ><NAlert v-if="loadError" type="error">{{ loadError }}</NAlert
      ><template v-else
        ><NCard
          ><NAlert v-if="submission" type="warning" class="mb"
            >上次提交结果待确认。请点击“重试提交”确认结果，系统会沿用原请求标识。</NAlert
          ><NAlert v-if="templateNotice" type="warning" class="mb">{{ templateNotice }}</NAlert
          ><NSteps :current="step" size="small" @update:current="changeStep"
            ><NStep title="基础信息" /><NStep title="内容与预算" /><NStep
              title="检查并提交" /></NSteps></NCard
        ><NCard
          v-if="step < 3"
          :title="step === 1 ? '活动基础信息' : '活动内容、联系人与费用'"
          class="step-panel"
          ><ActivityValidationErrors
            :errors="errors"
            :disabled="busy || !!submission"
            @locate="locateError" /><ActivityTemplateSelector
            id="activity-template-selection"
            v-if="step === 1"
            v-model="selection"
            :templates="templates"
            :types="activityTypes"
            :disabled="busy || !!submission"
            class="mb" /><DynamicForm
            v-model="payload"
            :schema="schema"
            :keys="sectionKeys"
            :errors="errors"
            :issues="issues"
            :disabled="busy || !!submission"
        /></NCard>
        <div v-else class="stack step-panel">
          <ActivityValidationErrors :errors="errors" :disabled="busy || !!submission" @locate="locateError" />
          <NCard title="审批路线预览"
            ><p class="help-text">
              按当前填写内容计算条件分支。多人节点采用全员通过，平行节点全部完成后继续。
            </p>
            <NButton :loading="busy" :disabled="!!submission" @click="showPreview">计算实际路线</NButton>
            <div v-if="preview" style="margin-top: 20px">
              <WorkflowTimeline
                :detail="{
                  activity: { nodes: preview.nodes, tasks: [] },
                  participants: preview.participants,
                }"
              />
            </div>
            <NEmpty
              v-else
              size="small"
              description="点击计算实际路线，检查审批人和预算分支"
              style="margin-top: 20px" /></NCard
          ><NCard title="申请附件"
            ><AttachmentList
              v-if="savedId && detail"
              :activity-id="savedId"
              :files="detail.files"
              :activity-version="detail.activity.version"
              stage="application"
              :can-upload="!submission"
              @uploaded="refreshFiles"
            />
            <p v-else class="help-text">保存草稿后即可上传申请附件。</p></NCard
          ><NAlert type="info" :bordered="false"
            >提交时将再次校验必填项、费用合计、负责人和受理权限。当前填写人：{{
              auth.profile?.user.name
            }}。</NAlert
          >
        </div>
        <div class="sticky-actions">
          <span class="muted">{{ savedId ? '已建立草稿 · 可继续编辑' : '尚未保存' }}</span>
          <div class="gap">
            <NButton v-if="step > 1" :disabled="busy || !!submission" @click="changeStep(step - 1)"
              >上一步</NButton
            ><NButton :loading="busy" :disabled="!!submission" @click="save">保存草稿</NButton
            ><NButton
              v-if="step < 3"
              type="primary"
              :disabled="busy || loading || !!submission"
              @click="changeStep(step + 1)"
              >下一步</NButton
            ><NButton
              v-else-if="auth.can('activity:submit')"
              type="primary"
              :loading="busy"
              @click="submit"
              >{{ submission ? '重试提交' : '提交申请' }}</NButton
            >
          </div>
        </div></template
      ></NSpin
    >
  </div>
</template>
