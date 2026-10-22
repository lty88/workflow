<script setup lang="tsx">
import { computed, ref } from 'vue';
import { NAlert, NButton, NInput, NModal, NSpace } from 'naive-ui';
import { deleteActivityApi } from '@/api';
import { ApiError } from '@/api/http';
import { useAuthStore } from '@/stores/auth';
import { useFeedback } from '@/composables/use-feedback';
import type { DeleteActivityProps } from './types';
const props = defineProps<DeleteActivityProps>();
const emit = defineEmits<{ deleted: []; refresh: [] }>();
const auth = useAuthStore();
const feedback = useFeedback();
const open = ref(false);
const busy = ref(false);
const reason = ref('');
const expectedVersion = ref(0);
const visible = computed(
  () => props.allowed && (auth.can('activity:delete') || auth.can('activity:delete:any')),
);

/** 再次检查按钮授权后展示删除确认，冻结当前版本并清空上次原因。 */
function showConfirmation(): void {
  if (!visible.value || busy.value) return;
  reason.value = '';
  expectedVersion.value = props.activity.version;
  open.value = true;
}

/** 核验权限与原因后提交删除；成功通知父组件刷新，版本冲突时关闭旧确认并读取最新活动。 */
async function remove(): Promise<void> {
  if (!visible.value || busy.value) return;
  const note = reason.value.trim();
  if (note.length < 5) {
    feedback.failure(new Error('请填写至少5字的删除原因'));
    return;
  }
  busy.value = true;
  try {
    await deleteActivityApi(props.activity.id, expectedVersion.value, note);
    open.value = false;
    feedback.success('活动已删除');
    emit('deleted');
  } catch (error) {
    feedback.failure(error);
    if (error instanceof ApiError && [403, 409].includes(error.status)) {
      open.value = false;
      emit('refresh');
    }
    if (error instanceof ApiError && error.status === 404) {
      open.value = false;
      emit('deleted');
    }
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <NButton v-if="visible" text type="error" size="small" @click.stop.prevent="showConfirmation">删除</NButton>
  <NModal
    v-model:show="open"
    preset="card"
    title="删除活动"
    :style="{ width: '480px', maxWidth: 'calc(100vw - 32px)' }"
    :mask-closable="!busy"
    :close-on-esc="!busy"
    :closable="!busy"
  >
    <div class="delete-activity-title">
      <strong>{{ activity.name || '未命名草稿' }}</strong
      ><span>{{ activity.code }}</span>
    </div>
    <NAlert type="warning" :bordered="false"
      >删除后活动将从列表、待办和看板中移除，未完成任务停止，评价链接失效。审批、附件和评价历史会保留。</NAlert
    >
    <label class="delete-reason-label">删除原因 <span>必填，至少5字</span></label>
    <NInput
      v-model:value="reason"
      type="textarea"
      :disabled="busy"
      :maxlength="500"
      show-count
      :autosize="{ minRows: 3, maxRows: 6 }"
      placeholder="请说明删除原因，例如：重复创建的测试活动"
      aria-label="删除原因"
    />
    <template #footer
      ><NSpace justify="end"
        ><NButton :disabled="busy" @click="open = false">保留活动</NButton
        ><NButton
          type="error"
          :loading="busy"
          :disabled="reason.trim().length < 5 || !visible"
          @click="remove"
          >确认删除</NButton
        ></NSpace
      ></template
    >
  </NModal>
</template>
<style scoped>
.delete-activity-title {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 18px;
}
.delete-activity-title strong {
  font-size: 16px;
  word-break: break-word;
}
.delete-activity-title span {
  font-size: 12px;
  color: #8390a7;
}
.delete-reason-label {
  display: block;
  font-size: 14px;
  margin: 20px 0 10px;
}
.delete-reason-label span {
  font-size: 12px;
  color: #8390a7;
  margin-left: 8px;
}
</style>
