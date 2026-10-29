<script setup lang="tsx">
  import { computed, ref, watch } from 'vue'
  import { dataAccessScopeLabel } from '@workflow/domain'
  import { NAlert, NButton, NForm, NModal, NSpin } from 'naive-ui'
  import type { FileAccessInput } from '@workflow/domain'
  import type { Directory } from '@/typings/api'
  import type { FileAccessDialogProps } from './types'
  import { directoryApi } from '@/api/workspace'
  import { updateFileAccessApi } from '@/api/files'
  import { clone } from '@/composables/format'
  import { useFeedback } from '@/composables/use-feedback'
  import { fileAccessRequiredErrors } from '@/components/security/access-validation'
  import AccessRuleEditor from '@/components/security/AccessRuleEditor.vue'
  const props = defineProps<FileAccessDialogProps>()
  const emit = defineEmits<{ 'update:show': [value: boolean]; done: [] }>()
  const feedback = useFeedback()
  const directory = ref<Directory | null>(null)
  const editing = ref<FileAccessInput>({})
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  const inheritedView = computed(() => props.file?.inheritedScope?.view)
  const inheritedDownload = computed(() => editing.value.access ? dataAccessScopeLabel(editing.value.access, !!props.file?.nodeId) : props.file?.inheritedScope?.download)
  /**
   * 打开时复制附件当前授权并读取组织，区分继承节点和文件单独分享，避免修改父级资料。
   * @param open 是否打开
   */
  async function initialize(open: boolean): Promise<void> {
    if (!open || !props.file) return
    editing.value = clone({ access: props.file.access, downloadAccess: props.file.downloadAccess })
    loading.value = true
    error.value = ''
    try {
      directory.value = await directoryApi()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '组织选项读取失败'
    } finally {
      loading.value = false
    }
  }
  /** 在浏览器校验必选受众后保存附件授权并刷新版本，服务端核验上传人与节点分享资格。 */
  async function save(): Promise<void> {
    if (!props.file || busy.value) return
    const issues = fileAccessRequiredErrors(editing.value)
    if (issues.length) {
      feedback.failure(new Error(issues.join('；')))
      return
    }
    busy.value = true
    try {
      await updateFileAccessApi(props.file.id, props.activityVersion, editing.value)
      feedback.success('附件权限已更新')
      emit('update:show', false)
      emit('done')
    } catch (cause) {
      feedback.failure(cause)
    } finally {
      busy.value = false
    }
  }
  watch(() => props.show, initialize)
</script>
<template>
  <NModal :show="show" preset="card" title="单文件权限" style="width: min(560px, 95vw)" :mask-closable="!busy" @update:show="emit('update:show', $event)">
    <NAlert type="info" :bordered="false" class="mb">
      这里仅修改当前文件。默认选项直接显示当前节点或申请的实际范围；也可单独选择“流程内共享”“仅本节点办理人”或“指定人员或角色”。共享后有权查看该申请的后续审批人可查阅；下载还需角色下载权限。
    </NAlert>
    <p>{{ file?.name }}</p>
    <NSpin :show="loading">
      <NAlert v-if="error" type="error">{{ error }}</NAlert>
      <NForm v-if="directory" label-placement="top" :disabled="busy">
        <AccessRuleEditor
          v-model="editing.access"
          :config="directory"
          :node="!!file?.nodeId"
          inherit
          :inherit-label="inheritedView ? `${inheritedView}（${file?.nodeId ? '节点' : '申请'}默认）` : '默认权限待刷新'"
          :inherit-hint="`当前默认：${inheritedView || '请刷新详情'}。流程内共享包含有权查看申请的后续审批人；仅本节点或指定受众则按其限制执行。`"
          label="本文件查看范围"
        />
        <AccessRuleEditor
          v-model="editing.downloadAccess"
          :fallback="editing.access"
          :config="directory"
          :node="!!file?.nodeId"
          inherit
          :inherit-label="inheritedDownload ? `${inheritedDownload}（默认下载范围）` : '默认权限待刷新'"
          inherit-hint="这里显示实际沿用的下载范围；下载仍需角色具备下载权限。"
          label="本文件下载范围"
        />
      </NForm>
    </NSpin>
    <template #footer>
      <div class="gap">
        <NButton :disabled="busy" @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :disabled="loading || !!error || !directory" :loading="busy" @click="save">保存权限</NButton>
      </div>
    </template>
  </NModal>
</template>
