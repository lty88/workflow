<script setup lang="tsx">
import { ref } from 'vue';
import { NAlert, NButton, NEmpty, NUpload } from 'naive-ui';
import type { UploadCustomRequestOptions } from 'naive-ui';
import type { AttachmentProps } from './types';
import { uploadApi } from '../../api';
import { useFeedback } from '../../composables/use-feedback';
const props = defineProps<AttachmentProps>();
const emit = defineEmits<{ uploaded: [] }>();
const feedback = useFeedback();
const busy = ref(false);
/**
 * 将单个附件上传到对应业务阶段，成功后刷新工单版本。
 * @param options 上传控件回调
 */
async function upload(options: UploadCustomRequestOptions): Promise<void> {
  const file = options.file.file;
  if (!file) return;
  busy.value = true;
  try {
    await uploadApi(props.activityId, file, props.stage);
    options.onFinish();
    emit('uploaded');
    feedback.success('附件已上传');
  } catch (error) {
    options.onError();
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div>
    <NAlert v-if="canUpload" type="info" :bordered="false" class="mb"
      >支持 PDF、JPG、PNG、DOCX、XLSX，每个文件最多20MB，每阶段最多10个。</NAlert
    >
    <div v-for="file in files" :key="file.id" class="file-row">
      <div>
        <a :href="'/api/files/' + file.id" target="_blank" rel="noopener" class="file-name">{{
          file.name
        }}</a>
        <div class="file-meta">
          {{ (file.size / 1024).toFixed(1) }} KB ·
          {{ { application: '申请附件', execution: '执行资料', archive: '成果附件' }[file.stage] }}
        </div>
      </div>
    </div>
    <NEmpty v-if="!files.length" size="small" description="暂无附件" class="mb" /><NUpload
      v-if="canUpload"
      :custom-request="upload"
      :show-file-list="false"
      :disabled="busy"
      accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
      ><NButton :loading="busy" dashed style="margin-top: 14px">上传附件</NButton></NUpload
    >
  </div>
</template>
