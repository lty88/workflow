<script setup lang="tsx">
  import { ref, watch } from 'vue'
  import AttachmentList from './AttachmentList.vue'
  import type { BusinessFormAttachmentProps } from './types'
  import type { FileRecord } from '@workflow/domain'
  import { activityApi } from '@/api/activities'
  const props = defineProps<BusinessFormAttachmentProps>()
  const emit = defineEmits<{ busy: [value: boolean]; refreshed: [version: number, files: FileRecord[]] }>()
  const current = ref(props.detail)
  const uploading = ref(false)
  /** 外部详情刷新时同步附件和版本，不重置当前表单输入。
   * @param detail 最新服务端详情
   */
  function syncDetail(detail: BusinessFormAttachmentProps['detail']): void {
    current.value = detail
  }
  /** 上传成功后读取本表单附件及主单新版本，避免提交时发生自身上传导致的版本冲突。 */
  async function refresh(): Promise<void> {
    current.value = await activityApi(props.detail.activity.id)
    emit('refreshed', current.value.activity.version, current.value.files)
  }
  /** 将文件上传锁同步给父表单，上传期间不允许提交或关闭抽屉。
   * @param value 是否正在上传及刷新
   */
  function setBusy(value: boolean): void {
    uploading.value = value
    emit('busy', value)
  }
  watch(() => props.detail, syncDetail)
</script>
<template>
  <section class="business-form-attachments">
    <h3>
      附件
      <span>选填</span>
    </h3>
    <p>上传本次办理的材料，附件会随本条记录保存，并沿用活动及节点的数据权限。</p>
    <AttachmentList
      :activity-id="detail.activity.id"
      :files="current.files"
      :activity-version="current.activity.version"
      :stage="stage"
      :node-id="nodeId"
      :node-scope="nodeId ? current.access?.nodeAttachmentScopes?.[nodeId] : undefined"
      :context-id="contextId"
      :action-key="actionKey"
      :can-upload="!disabled || uploading"
      :refresh-files="refresh"
      @busy="setBusy"
    />
  </section>
</template>
<style scoped>
  .business-form-attachments {
    border-top: 1px solid #e6ebf4;
    padding-top: 20px;
    margin-top: 16px;
  }
  h3 {
    font-size: 15px;
    margin-bottom: 8px;
  }
  h3 span {
    font-weight: 400;
    color: #7b889c;
    font-size: 12px;
    margin-left: 8px;
  }
  p {
    font-size: 13px;
    color: #748198;
    line-height: 1.8;
  }
</style>
