<script setup lang="tsx">
import { ref, watch } from 'vue';
import { NAlert, NButton, NForm, NModal, NSpin } from 'naive-ui';
import type { FileAccessInput } from '@workflow/domain';
import type { Directory } from '@/typings/api';
import type { FileAccessDialogProps } from './types';
import { directoryApi } from '@/api/workspace';
import { updateFileAccessApi } from '@/api/files';
import { clone } from '@/composables/format';
import { useFeedback } from '@/composables/use-feedback';
import AccessRuleEditor from '@/components/security/AccessRuleEditor.vue';
const props = defineProps<FileAccessDialogProps>();
const emit = defineEmits<{ 'update:show': [value: boolean]; done: [] }>();
const feedback = useFeedback();
const directory = ref<Directory | null>(null);
const editing = ref<FileAccessInput>({});
const loading = ref(false);
const busy = ref(false);
const error = ref('');
/**
 * 打开时复制附件当前授权并读取组织，避免编辑影响父级已加载资料。
 * @param open 是否打开
 */
async function initialize(open: boolean): Promise<void> {
  if (!open || !props.file) return;
  editing.value = clone({ access: props.file.access, downloadAccess: props.file.downloadAccess });
  loading.value = true;
  error.value = '';
  try {
    directory.value = await directoryApi();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '组织选项读取失败';
  } finally {
    loading.value = false;
  }
}
/** 保存附件授权并刷新主单版本，上传者扩大范围会被服务端拒绝。 */
async function save(): Promise<void> {
  if (!props.file || busy.value) return;
  busy.value = true;
  try {
    await updateFileAccessApi(props.file.id, props.activityVersion, editing.value);
    feedback.success('附件权限已更新');
    emit('update:show', false);
    emit('done');
  } catch (cause) {
    feedback.failure(cause);
  } finally {
    busy.value = false;
  }
}
watch(() => props.show, initialize);
</script>
<template>
  <NModal
    :show="show"
    preset="card"
    title="附件数据权限"
    style="width: min(560px, 95vw)"
    :mask-closable="!busy"
    @update:show="emit('update:show', $event)"
    ><NAlert type="info" :bordered="false" class="mb"
      >上传者可收紧原有授权；扩大范围需要有本活动访问权的配置管理员。收紧后不在授权范围内的人员将立即失去访问权。</NAlert
    >
    <p>{{ file?.name }}</p>
    <NSpin :show="loading"
      ><NAlert v-if="error" type="error">{{ error }}</NAlert
      ><NForm v-if="directory" label-placement="top" :disabled="busy"
        ><AccessRuleEditor
          v-model="editing.access"
          :config="directory"
          :node="!!file?.nodeId"
          inherit
          inherit-label="继承所属节点或活动"
          label="附件附加查看范围" /><AccessRuleEditor
          v-model="editing.downloadAccess"
          :fallback="editing.access"
          :config="directory"
          :node="!!file?.nodeId"
          inherit
          label="附件附加下载范围" /></NForm></NSpin
    ><template #footer
      ><div class="gap">
        <NButton :disabled="busy" @click="emit('update:show', false)">取消</NButton
        ><NButton type="primary" :disabled="loading || !!error || !directory" :loading="busy" @click="save"
          >保存权限</NButton
        >
      </div></template
    ></NModal
  >
</template>
