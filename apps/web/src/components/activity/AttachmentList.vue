<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NEmpty, NUpload, NTag, NButton } from 'naive-ui'
  import type { FileAccessInput, FileRecord } from '@workflow/domain'
  import { attachmentFileErrors } from '@workflow/domain'
  import AttachmentUploadPrompt from './AttachmentUploadPrompt.vue'
  import { fileAccessRequiredErrors } from '@/components/security/access-validation'
  import FileUploadAccess from '@/components/security/FileUploadAccess.vue'
  import FileAccessDialog from './FileAccessDialog.vue'
  import type { UploadCustomRequestOptions } from 'naive-ui'
  import type { AttachmentProps } from './types'
  import { uploadApi } from '@/api/files'
  import { useFeedback } from '@/composables/use-feedback'
  import { formatTime } from '@/composables/format'
  const props = defineProps<AttachmentProps>()
  const emit = defineEmits<{ uploaded: []; busy: [value: boolean] }>()
  const feedback = useFeedback()
  const busy = ref(false)
  const accessOpen = ref(false)
  const accessFile = ref<FileRecord | null>(null)
  const uploadAccess = ref<FileAccessInput>({})
  const stageFiles = computed(() =>
    props.files.filter(
      (file) =>
        !file.fieldKey &&
        file.stage === props.stage &&
        (props.stage !== 'node' || file.nodeId === props.nodeId) &&
        (props.contextId ? file.contextId === props.contextId : props.includeContexts || !file.contextId)
    )
  )
  const uploadFileCount = computed(() => stageFiles.value.filter((file) => file.contextId === props.contextId).length)
  /**
   * 上传前按需保存申请，附件写入对应表单分组，刷新主单版本后解除上传锁。
   * @param options 上传控件回调
   */
  async function upload(options: UploadCustomRequestOptions): Promise<void> {
    const file = options.file.file
    if (!file || busy.value || !props.canUpload) {
      options.onError()
      return
    }
    const errors = attachmentFileErrors(
      { id: 'generic-attachment', key: 'attachment', label: '附件', type: 'attachment', required: false, default: '', options: [] },
      file
    )
    errors.push(...fileAccessRequiredErrors(uploadAccess.value))
    if (uploadFileCount.value >= 10) errors.push('本表单或记录最多上传10个附件')
    if (errors.length) {
      feedback.failure(new Error(errors.join('；')))
      options.onError()
      return
    }
    busy.value = true
    emit('busy', true)
    try {
      const activityId = props.prepareUpload ? await props.prepareUpload() : props.activityId
      if (!activityId) throw new Error('请先选择活动类型和流程模板后上传附件')
      await uploadApi(activityId, file, props.stage, { ...uploadAccess.value, nodeId: props.nodeId, contextId: props.contextId, actionKey: props.actionKey })
      await props.refreshFiles?.()
      options.onFinish()
      emit('uploaded')
      feedback.success('附件已上传')
    } catch (error) {
      options.onError()
      feedback.failure(error)
    } finally {
      busy.value = false
      emit('busy', false)
    }
  }
  /**
   * 将字节数格式化为可读的文件大小。
   * @param size 字节数
   * @returns 可读大小文本
   */
  function formatSize(size: number): string {
    if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + ' MB'
    return (size / 1024).toFixed(1) + ' KB'
  }
  /**
   * 按文件名扩展名推断类型徽标类别。
   * @param name 文件名
   * @returns 徽标类别
   */
  function badgeKind(name: string): string {
    const ext = name.includes('.') ? (name.split('.').pop() ?? '') : ''
    if (ext === 'pdf') return 'pdf'
    if (['doc', 'docx'].includes(ext)) return 'doc'
    if (['xls', 'xlsx'].includes(ext)) return 'xls'
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'img'
    return 'file'
  }
  /**
   * 生成文件类型徽标文案。
   * @param name 文件名
   * @returns 徽标文案
   */
  function badgeText(name: string): string {
    const ext = name.includes('.') ? (name.split('.').pop() ?? '') : ''
    return ext ? ext.toUpperCase() : 'FILE'
  }
  /**
   * 打开有管理资格的附件权限窗口，兼容历史阶段附件的权限收紧。
   * @param file 附件
   */
  function manage(file: FileRecord): void {
    if (!file.canManageAccess || !props.activityVersion) return
    accessFile.value = file
    accessOpen.value = true
  }
  /** 附件权限更新后刷新当前文件和活动版本，再通知详情或表单同步。
   */
  async function permissionsChanged(): Promise<void> {
    busy.value = true
    emit('busy', true)
    try {
      await props.refreshFiles?.()
      emit('uploaded')
    } catch (error) {
      feedback.failure(error)
    } finally {
      busy.value = false
      emit('busy', false)
    }
  }
</script>
<template>
  <div class="attachment-panel">
    <template v-if="canUpload || busy">
      <NUpload
        class="attachment-uploader"
        :custom-request="upload"
        :show-file-list="false"
        :multiple="false"
        :disabled="busy || uploadFileCount >= 10"
        accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
      >
        <AttachmentUploadPrompt
          :busy="busy"
          :disabled="uploadFileCount >= 10"
          description="支持 PDF、JPG、PNG、DOCX、XLSX"
          :limit-label="`单个文件不超过 20 MB · 本表单或记录 ${uploadFileCount} / 10 个`"
        />
      </NUpload>
      <FileUploadAccess v-model="uploadAccess" :node="!!nodeId" :disabled="busy" />
    </template>
    <div v-if="stageFiles.length" class="attachment-list-heading">
      <strong>已上传附件</strong>
      <span>{{ stageFiles.length }} 个</span>
    </div>
    <div v-for="file in stageFiles" :key="file.id" class="attachment-file-row">
      <span class="file-badge" :class="badgeKind(file.name)">{{ badgeText(file.name) }}</span>
      <div class="file-cell">
        <a v-if="file.canPreview" :href="'/api/files/' + file.id + '/preview'" target="_blank" rel="noopener" class="file-name">{{ file.name }}</a>
        <span v-else class="file-name">{{ file.name }}</span>
        <div class="file-meta">{{ formatSize(file.size) }} · {{ formatTime(file.createdAt) }}</div>
      </div>
      <div class="attachment-file-actions">
        <a v-if="file.canDownload" :href="'/api/files/' + file.id" target="_blank" rel="noopener">下载</a>
        <NTag v-else size="small" :bordered="false">无下载授权</NTag>
        <NButton v-if="file.canManageAccess && activityVersion" size="small" secondary type="primary" :disabled="busy" @click="manage(file)">
          单文件权限
        </NButton>
      </div>
    </div>
    <NEmpty v-if="!stageFiles.length && !canUpload && !busy" size="small" description="暂无可查看附件" class="mb" />
    <FileAccessDialog v-model:show="accessOpen" :file="accessFile" :activity-version="activityVersion || 1" @done="permissionsChanged" />
  </div>
</template>
<style scoped>
  .attachment-panel {
    width: 100%;
    min-width: 0;
  }
  .attachment-uploader,
  :deep(.attachment-uploader .n-upload-trigger) {
    width: 100%;
    display: block;
  }
  .attachment-list-heading {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 20px 0 8px;
    font-size: 14px;
    color: #405879;
  }
  .attachment-list-heading span {
    font-size: 12px;
    color: #8290a5;
  }
  .attachment-file-row {
    display: flex;
    align-items: center;
    gap: 14px;
    border-bottom: 1px solid #e9eef6;
    padding: 16px 0;
  }
  .file-badge {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    font-size: 12px;
    flex: none;
  }
  .file-cell {
    flex: 1;
    min-width: 0;
  }
  .file-name {
    font-size: 14px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .file-meta {
    font-size: 12px;
    color: #8090a7;
    margin-top: 5px;
    line-height: 1.7;
  }
  .attachment-file-actions {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: none;
    font-size: 13px;
  }
  @media (max-width: 600px) {
    .attachment-file-row {
      flex-wrap: wrap;
      gap: 10px;
    }
    .attachment-file-actions {
      width: 100%;
      justify-content: flex-end;
      padding-left: 54px;
    }
  }
</style>
