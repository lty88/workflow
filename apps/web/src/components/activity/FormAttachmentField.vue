<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NAlert, NButton, NEmpty, NPopconfirm, NUpload } from 'naive-ui'
  import type { UploadCustomRequestOptions } from 'naive-ui'
  import { attachmentIds, attachmentOptions, attachmentFileErrors } from '@workflow/domain'
  import type { FileRecord } from '@workflow/domain'
  import type { FormAttachmentProps } from './types'
  import { uploadApi } from '@/api/files'
  import { useFeedback } from '@/composables/use-feedback'
  const props = defineProps<FormAttachmentProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: string]; busy: [value: boolean] }>()
  const feedback = useFeedback()
  const pending = ref(false)
  const localFiles = ref<FileRecord[]>([])
  const ids = computed(() => attachmentIds(props.modelValue) || [])
  const rules = computed(() => attachmentOptions(props.field))
  const accept = computed(() => rules.value.extensions.map(extensionAccept).join(','))
  const files = computed(() => {
    const found: FileRecord[] = []
    for (const id of ids.value) {
      const file = [...(props.files || []), ...localFiles.value].find(
        /** 仅展示该字段实际关联的文件。
         * @param item 已授权文件
         * @returns 是否属于当前字段
         */ function matches(item) {
          return item.id === id && item.fieldKey === props.field.key
        }
      )
      if (file) found.push(file)
    }
    return found
  })
  const canUpload = computed(() => !props.disabled && !pending.value && !!(props.prepareUpload || props.activityId) && ids.value.length < rules.value.maxCount)
  /** 生成浏览器文件选择器接受的扩展名。
   * @param extension 无前缀扩展名
   * @returns 带点的扩展名
   */
  function extensionAccept(extension: string): string {
    return '.' + extension
  }
  /** 显示文件大小，便于核对上传限制。
   * @param size 文件字节数
   * @returns 可读大小
   */
  function fileSize(size: number): string {
    return size >= 1024 * 1024 ? (size / 1024 / 1024).toFixed(1) + ' MB' : (size / 1024).toFixed(1) + ' KB'
  }
  /** 从本次表单移除引用，随保存生效；不删除历史申请快照中的原附件。
   * @param id 当前文件ID
   */
  function remove(id: string): void {
    if (props.disabled || pending.value) return
    const next = ids.value.filter(
      /** 保留未移除的文件。
       * @param item 当前引用ID
       * @returns 是否保留
       */ function keep(item) {
        return item !== id
      }
    )
    emit('update:modelValue', next.length ? JSON.stringify(next) : '')
  }
  /** 校验格式及大小后自动保存申请、上传到独立字段，再刷新附件及主单版本。
   * @param options 上传控件的文件与成功失败回调
   */
  async function upload(options: UploadCustomRequestOptions): Promise<void> {
    const file = options.file.file
    if (!file || !canUpload.value) {
      options.onError()
      return
    }
    const errors = attachmentFileErrors(props.field, file)
    if (errors.length) {
      feedback.failure(new Error(errors.join('；')))
      options.onError()
      return
    }
    pending.value = true
    emit('busy', true)
    try {
      const activityId = props.prepareUpload ? await props.prepareUpload() : props.activityId!
      const uploaded = await uploadApi(activityId, file, 'application', { fieldKey: props.field.key })
      localFiles.value.push(uploaded)
      const next = [...new Set([...ids.value, uploaded.id])]
      emit('update:modelValue', JSON.stringify(next))
      await props.refreshFiles?.()
      options.onFinish()
      feedback.success('附件已上传')
    } catch (error) {
      options.onError()
      feedback.failure(error)
    } finally {
      pending.value = false
      emit('busy', false)
    }
  }
</script>
<template>
  <div class="field-attachments">
    <div v-for="file in files" :key="file.id" class="field-file-row">
      <div class="field-file-name">
        <a v-if="file.canPreview" :href="'/api/files/' + file.id + '/preview'" target="_blank" rel="noopener">{{ file.name }}</a>
        <span v-else>{{ file.name }}</span>
        <small>{{ fileSize(file.size) }}</small>
      </div>
      <a v-if="file.canDownload" :href="'/api/files/' + file.id" target="_blank" rel="noopener">下载</a>
      <NPopconfirm v-if="!disabled" @positive-click="remove(file.id)">
        <template #trigger><NButton text type="error" :disabled="pending">移除</NButton></template>
        从本次表单移除，保存后生效；历史申请附件保留。
      </NPopconfirm>
    </div>
    <NAlert v-if="ids.length > files.length" type="warning" :bordered="false" class="field-hint">部分附件受独立权限限制或暂未读取，请刷新后查看。</NAlert>
    <NUpload v-if="!disabled || pending" :custom-request="upload" :accept="accept" :multiple="false" :show-file-list="false" :disabled="!canUpload">
      <NButton :loading="pending" :disabled="!canUpload">{{ pending ? '正在上传…' : '上传附件' }}</NButton>
    </NUpload>
    <p v-if="!disabled || pending" class="field-hint">
      已上传 {{ ids.length }} / {{ rules.maxCount }} 个 · 单个 ≤ {{ rules.maxSizeMB }} MB · {{ rules.extensions.join('、').toUpperCase() }}
    </p>
    <p v-if="!disabled && !prepareUpload && !activityId" class="field-hint">此处为配置预览，实际填写活动时可上传附件。</p>
    <NEmpty v-if="disabled && !pending && !ids.length" size="small" description="未上传附件" />
  </div>
</template>
<style scoped>
  .field-attachments {
    width: 100%;
    font-size: 14px;
  }
  .field-file-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 12px;
    background: #f6f8fc;
    border: 1px solid #e5eaf2;
    border-radius: 8px;
    margin-bottom: 10px;
  }
  .field-file-name {
    min-width: 0;
    flex: 1;
    overflow-wrap: anywhere;
  }
  .field-file-name small {
    display: block;
    font-size: 12px;
    color: #768399;
    margin-top: 3px;
  }
  .field-hint {
    font-size: 12px;
    color: #768399;
    line-height: 1.7;
    margin: 8px 0 0;
  }
</style>
