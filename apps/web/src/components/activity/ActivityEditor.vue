<script setup lang="tsx">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { NAlert, NButton, NCard, NSteps, NStep, NSpin, NEmpty, NTag } from 'naive-ui';
import { defaultValues, validateForm } from '@workflow/domain';
import type { ActivityDetail, WorkflowPreview } from '../../typings/api';
import { activityApi, previewApi, saveDraftApi, submitApi } from '../../api';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/use-feedback';
import { clone } from '../../composables/format';
import { ApiError, errorMessages } from '../../api/http';
import type { SubmissionAttempt } from './types';
import DynamicForm from './DynamicForm.vue';
import AttachmentList from './AttachmentList.vue';
import WorkflowTimeline from './WorkflowTimeline.vue';
const route = useRoute();
const props = defineProps<{ activityId?: string }>();
const emit = defineEmits<{ saved: [] }>();
const auth = useAuthStore();
const feedback = useFeedback();
const router = useRouter();
const payload = ref<Record<string, string>>(auth.profile ? defaultValues(auth.profile.form) : {});
const detail = ref<ActivityDetail | null>(null);
const savedId = ref(props.activityId || '');
const version = ref(0);
const step = ref(1);
const busy = ref(false);
const loading = ref(false);
const errors = ref<string[]>([]);
const preview = ref<WorkflowPreview | null>(null);
const loadError = ref('');
const submission = ref<SubmissionAttempt | null>(null);
const schema = computed(() => auth.profile!.form);
/**
 * 计算当前分步表单的字段集合。
 * @returns 当前步骤字段键
 */
function currentSectionKeys(): string[] {
  const keys = schema.value.fields.map(fieldKey);
  if (step.value === 1) return keys.filter(basicKey);
  if (step.value === 2) return keys.filter(nonBasicKey);
  return [];
}
const sectionKeys = computed(currentSectionKeys);
/**
 * 取得字段键。
 * @param field 字段
 * @returns 字段键
 */
function fieldKey(field: { key: string }): string {
  return field.key;
}
/**
 * 区分基础信息和活动内容。
 * @param key 字段键
 * @returns 是否基础信息
 */
function basicKey(key: string): boolean {
  return [
    'activity_name',
    'delivery_mode',
    'start_at',
    'end_at',
    'location',
    'meeting_url',
    'nature',
    'service_type',
  ].includes(key);
}
/**
 * 将其他动态新增字段归入活动内容。
 * @param key 字段键
 * @returns 是否内容字段
 */
function nonBasicKey(key: string): boolean {
  return !basicKey(key);
}
/**
 * 读取草稿与附件，并检查是否仍可编辑。
 */
async function load(): Promise<void> {
  if (!savedId.value && route.query.copyId) {
    loading.value = true;
    try {
      const source = await activityApi(String(route.query.copyId));
      if (!source.actions.includes('copy')) throw new Error('无复制申请权限');
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
  if (!savedId.value) return;
  loading.value = true;
  try {
    const result = await activityApi(savedId.value);
    if (!result.actions.includes('edit')) throw new Error('当前工单不可编辑，请返回详情');
    detail.value = result;
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
 * 保存当前输入，草稿允许暂缺必填信息。
 * @returns 已保存工单标识
 */
async function persist(): Promise<string> {
  const result = await saveDraftApi(payload.value, savedId.value || undefined, version.value || undefined);
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
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/**
 * 校验当前动态表单并预览实际审批路线。
 */
async function showPreview(): Promise<void> {
  errors.value = validateForm(schema.value, payload.value).errors;
  if (errors.value.length) {
    step.value = 3;
    return;
  }
  busy.value = true;
  try {
    preview.value = await previewApi(payload.value);
    errors.value = preview.value.errors;
  } catch (error) {
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/**
 * 先保存，再按服务端当前规则提交并进入工单详情。
 */
async function submit(): Promise<void> {
  if (!auth.can('activity:submit') || busy.value) return;
  errors.value = submission.value ? [] : validateForm(schema.value, payload.value).errors;
  if (errors.value.length) {
    step.value = 3;
    return;
  }
  busy.value = true;
  try {
    if (!submission.value) {
      const id = await persist();
      submission.value = { id, version: version.value };
    }
    const { id, version: submittedVersion } = submission.value;
    await submitApi(id, submittedVersion);
    submission.value = null;
    feedback.success('申请已提交，审批任务已生成');
    await router.push('/activities/' + id);
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) submission.value = null;
    errors.value = errorMessages(error);
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/**
 * 定位校验错误对应的字段并聚焦输入控件。
 * @param message 校验说明
 */
async function locateError(message: string): Promise<void> {
  for (const field of schema.value.fields)
    if (message.includes(field.label)) {
      step.value = basicKey(field.key) ? 1 : 2;
      await nextTick();
      const element = document.getElementById('field-' + field.key);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.querySelector<HTMLElement>('input,textarea,button')?.focus();
      return;
    }
}
/**
 * 在没有待确认提交时切换表单步骤。
 * @param value 步骤序号
 */
function changeStep(value: number): void {
  if (!submission.value) step.value = value;
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
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <span class="eyebrow">NEW APPLICATION</span>
        <h1>{{ activityId ? '编辑活动申请' : '发起活动申请' }}</h1>
        <p>表单由公司配置动态生成，提交后保留版本快照。</p>
      </div>
      <NTag :bordered="false" type="info">配置 V{{ auth.profile?.configVersion }}</NTag>
    </div>
    <NSpin :show="loading"
      ><NAlert v-if="loadError" type="error">{{ loadError }}</NAlert
      ><template v-else
        ><NCard
          ><NAlert v-if="submission" type="warning" class="mb"
            >上次提交结果待确认。请点击“重试提交”确认结果，系统会沿用原请求标识。</NAlert
          ><NSteps :current="step" size="small" @update:current="changeStep"
            ><NStep title="基础信息" /><NStep title="内容与预算" /><NStep
              title="检查并提交" /></NSteps></NCard
        ><NCard
          v-if="step < 3"
          :title="step === 1 ? '活动基础信息' : '活动内容、联系人与费用'"
          class="step-panel"
          ><DynamicForm
            v-model="payload"
            :schema="schema"
            :keys="sectionKeys"
            :errors="errors"
            :disabled="busy || !!submission"
        /></NCard>
        <div v-else class="stack step-panel">
          <NAlert v-if="errors.length" type="error" title="请完善以下信息"
            ><div v-for="error in errors" :key="error" role="alert">
              <NButton text type="error" :disabled="!!submission" @click="locateError(error)">{{
                error
              }}</NButton>
            </div></NAlert
          ><NCard title="审批路线预览"
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
            <NButton v-if="step > 1" :disabled="busy || !!submission" @click="step--">上一步</NButton
            ><NButton :loading="busy" :disabled="!!submission" @click="save">保存草稿</NButton
            ><NButton v-if="step < 3" type="primary" @click="step++">下一步</NButton
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
