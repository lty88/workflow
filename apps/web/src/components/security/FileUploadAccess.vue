<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NAlert, NCollapse, NCollapseItem, NSpin } from 'naive-ui'
  import { dataAccessScopeLabel } from '@workflow/domain'
  import type { DataAccessRule } from '@workflow/domain'
  import type { FileUploadAccessProps } from './types'
  import type { Directory } from '@/typings/api'
  import { directoryApi } from '@/api/workspace'
  import { fileAccessRequiredErrors } from './access-validation'
  import AccessRuleEditor from './AccessRuleEditor.vue'
  import PermissionHint from './PermissionHint.vue'
  const props = defineProps<FileUploadAccessProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: FileUploadAccessProps['modelValue']] }>()
  const directory = ref<Directory | null>(null)
  const loading = ref(false)
  const error = ref('')
  const inheritedView = computed(() => props.node ? props.nodeScope?.view : '流程内共享')
  const selectedView = computed(() => props.modelValue.access ? dataAccessScopeLabel(props.modelValue.access, props.node) : inheritedView.value)
  const inheritedDownload = computed(() => props.modelValue.access ? dataAccessScopeLabel(props.modelValue.access, props.node) : props.node ? props.nodeScope?.download : '流程内共享')
  const defaultViewLabel = computed(() => inheritedView.value ? `${props.node ? '节点' : '申请'}默认：${inheritedView.value}` : '默认权限待刷新')
  const defaultViewHint = computed(() => inheritedView.value === '流程内共享' ? '当前默认允许有权查看本申请的后续审批人查阅，上传时无需另行设置。' : inheritedView.value === '仅本节点办理人' ? '当前默认仅本节点办理人可见，后续审批人不会自动看到；需要共享时可在下方主动选择流程内共享。' : inheritedView.value ? '当前默认按指定人员或角色授权，后续审批人仅在授权范围内可见。' : '请刷新申请详情后查看本节点的实际默认范围。')
  const permissionIssues = computed(() => fileAccessRequiredErrors(props.modelValue))
  /**
   * 展开附件授权配置时才读取当前组织选项，避免详情页多个上传区重复请求。
   * @param names 已展开面板名称
   */
  async function expand(names: Array<string | number>): Promise<void> {
    if (!names.length || directory.value || loading.value) return
    loading.value = true
    try {
      directory.value = await directoryApi()
      error.value = ''
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '授权选项读取失败，请收起后重试'
    } finally {
      loading.value = false
    }
  }
  /**
   * 设置新文件的初始受众，空查看规则继承节点，显式选择按文件单独授权。
   * @param key 查看或下载授权
   * @param value 文件规则，空值表示继承
   */
  function update(key: 'access' | 'downloadAccess', value: DataAccessRule | undefined): void {
    if (!props.disabled) emit('update:modelValue', { ...props.modelValue, [key]: value })
  }
</script>
<template>
  <div class="upload-access-card">
    <NCollapse class="upload-access" @update:expanded-names="expand">
      <NCollapseItem name="permissions">
        <template #header>
          <span class="upload-access-title">
            新文件权限
            <span class="upload-access-summary">{{ selectedView || '待刷新' }}</span>
            <PermissionHint label="新文件权限说明">
              <p>仅影响之后上传的文件；已有文件请使用“单文件权限”。</p>
              <p>查看、下载范围的详细说明在各字段旁的信息图标中。</p>
            </PermissionHint>
          </span>
        </template>
        <NAlert v-if="permissionIssues.length" type="warning" :bordered="false" class="mb">{{ permissionIssues.join('；') }}</NAlert>
        <NSpin :show="loading">
          <NAlert v-if="error" type="warning">{{ error }}</NAlert>
          <template v-if="directory">
            <AccessRuleEditor
              :model-value="modelValue.access"
              :config="directory"
              :disabled="disabled"
              :node="node"
              inherit
              :inherit-label="defaultViewLabel"
              :inherited-scope="inheritedView"
              :inherit-hint="defaultViewHint"
              label="新文件查看范围"
              @update:model-value="update('access', $event)"
            />
            <AccessRuleEditor
              :model-value="modelValue.downloadAccess"
              :fallback="modelValue.access"
              :config="directory"
              :disabled="disabled"
              :node="node"
              inherit
              operation="download"
              :inherited-scope="inheritedDownload"
              :inherit-label="inheritedDownload ? `默认：${inheritedDownload}` : '默认权限待刷新'"
              inherit-hint="这里显示实际沿用的下载范围；下载仍需角色具备下载权限。"
              label="新文件下载范围"
              @update:model-value="update('downloadAccess', $event)"
            />
          </template>
        </NSpin>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>
<style scoped>
  .upload-access-card {
    margin: 10px 0 14px;
    padding: 10px 12px;
    background: #f7f9fd;
    border: 1px solid #e4eaf4;
    border-radius: 10px;
  }
  .upload-access-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .upload-access-summary {
    font-size: 12px;
    font-weight: 400;
    color: #7b899e;
  }
  .upload-access {
    margin: 0;
    font-size: 13px;
  }
</style>
