<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NAlert, NCollapse, NCollapseItem, NSpin } from 'naive-ui'
  import type { DataAccessRule } from '@workflow/domain'
  import type { FileUploadAccessProps } from './types'
  import type { Directory } from '@/typings/api'
  import { directoryApi } from '@/api/workspace'
  import { fileAccessRequiredErrors } from './access-validation'
  import AccessRuleEditor from './AccessRuleEditor.vue'
  const props = defineProps<FileUploadAccessProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: FileUploadAccessProps['modelValue']] }>()
  const directory = ref<Directory | null>(null)
  const loading = ref(false)
  const error = ref('')
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
    <p class="upload-permission-hint">以下设置仅影响新文件；已上传文件请点击对应的“单文件权限”。</p>
    <NCollapse class="upload-access" @update:expanded-names="expand">
      <NCollapseItem title="新上传文件的默认权限" name="permissions">
        <NAlert type="info" :bordered="false" class="mb">
          这里仅影响随后上传的新文件。默认继承所属节点；选择“活动内共享”后，申请人等有权访问本活动的人员可查看该附件，其他文件保持各自权限。下载还需具备下载权限并满足文件下载范围。
        </NAlert>
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
              inherit-label="继承所属节点或活动"
              inherit-hint="节点附件默认仅向节点授权人员开放；若要让申请人查看，请选择活动内共享或指定授权并勾选申请人。"
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
              inherit-hint="沿用本文件查看范围；查看也未单独设置时，沿用节点下载规则。"
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
    margin: 12px 0 18px;
    padding: 14px 16px;
    background: #f7f9fd;
    border: 1px solid #e4eaf4;
    border-radius: 10px;
  }
  .upload-permission-hint {
    font-size: 12px;
    color: #7889a2;
    line-height: 1.8;
    margin: 0 0 10px;
  }
  .upload-access {
    margin: 12px 0 16px;
    font-size: 13px;
  }
</style>
