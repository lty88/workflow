<script setup lang="tsx">
import { computed, ref } from 'vue';
import { NAlert, NEmpty, NUpload, NTag, NButton } from 'naive-ui';
import type { FileAccessInput, FileRecord } from '@workflow/domain';
import FileUploadAccess from '@/components/security/FileUploadAccess.vue';
import FileAccessDialog from './FileAccessDialog.vue';
import type { UploadCustomRequestOptions } from 'naive-ui';
import type { AttachmentProps } from './types';
import { uploadApi } from '@/api/files';
import { useFeedback } from '@/composables/use-feedback';
import { formatTime } from '@/composables/format';
const props = defineProps<AttachmentProps>();
const emit = defineEmits<{ uploaded: [] }>();
const feedback = useFeedback();
const busy = ref(false);
const accessOpen = ref(false);
const accessFile = ref<FileRecord | null>(null);
const uploadAccess = ref<FileAccessInput>({});
const stageFiles = computed(() =>
  props.files.filter(
    (file) => file.stage === props.stage && (props.stage !== 'node' || file.nodeId === props.nodeId),
  ),
);
/**
 * 将单个附件上传到对应业务阶段，成功后刷新工单版本。
 * @param options 上传控件回调
 */
async function upload(options: UploadCustomRequestOptions): Promise<void> {
  const file = options.file.file;
  if (!file) return;
  busy.value = true;
  try {
    await uploadApi(props.activityId, file, props.stage, { ...uploadAccess.value, nodeId: props.nodeId });
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
/**
 * 将字节数格式化为可读的文件大小。
 * @param size 字节数
 * @returns 可读大小文本
 */
function formatSize(size: number): string {
  if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + ' MB';
  return (size / 1024).toFixed(1) + ' KB';
}
/**
 * 按文件名扩展名推断类型徽标类别。
 * @param name 文件名
 * @returns 徽标类别
 */
function badgeKind(name: string): string {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '') : '';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  if (['xls', 'xlsx'].includes(ext)) return 'xls';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'img';
  return 'file';
}
/**
 * 生成文件类型徽标文案。
 * @param name 文件名
 * @returns 徽标文案
 */
function badgeText(name: string): string {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '') : '';
  return ext ? ext.toUpperCase() : 'FILE';
}
/**
 * 打开有管理资格的附件权限窗口，兼容历史阶段附件的权限收紧。
 * @param file 附件
 */
function manage(file: FileRecord): void {
  if (!file.canManageAccess || !props.activityVersion) return;
  accessFile.value = file;
  accessOpen.value = true;
}
</script>
<template>
  <div>
    <NAlert v-if="canUpload" type="info" :bordered="false" class="mb"
      >支持 PDF、JPG、PNG、DOCX、XLSX，每个文件最多20MB，每阶段最多10个。</NAlert
    >
    <div v-for="file in stageFiles" :key="file.id" class="file-row">
      <span class="file-badge" :class="badgeKind(file.name)">{{ badgeText(file.name) }}</span>
      <div class="file-cell">
        <a
          :href="'/api/files/' + file.id + '/preview'"
          v-if="file.canPreview"
          target="_blank"
          rel="noopener"
          class="file-name"
          >{{ file.name }}</a
        ><span v-else class="file-name">{{ file.name }}</span>
        <div class="file-meta">{{ formatSize(file.size) }} · {{ formatTime(file.createdAt) }}</div>
      </div>
      <a v-if="file.canDownload" :href="'/api/files/' + file.id" target="_blank" rel="noopener">下载</a
      ><NTag v-else size="small" :bordered="false">无下载授权</NTag
      ><NButton v-if="file.canManageAccess && activityVersion" size="small" text @click="manage(file)"
        >权限</NButton
      >
    </div>
    <FileUploadAccess v-if="canUpload" v-model="uploadAccess" :node="!!nodeId" :disabled="busy" />
    <NEmpty v-if="!stageFiles.length" size="small" description="暂无可查看附件" class="mb" /><NUpload
      v-if="canUpload"
      :custom-request="upload"
      :show-file-list="false"
      :disabled="busy"
      accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
      ><div class="upload-trigger">点击上传附件（单个 ≤ 20MB）</div></NUpload
    >
    <FileAccessDialog
      v-model:show="accessOpen"
      :file="accessFile"
      :activity-version="activityVersion || 1"
      @done="emit('uploaded')"
    />
  </div>
</template>
