<script setup lang="tsx">
import { ref } from 'vue';
import { NAlert, NCollapse, NCollapseItem, NSpin } from 'naive-ui';
import type { DataAccessRule } from '@workflow/domain';
import type { FileUploadAccessProps } from './types';
import type { Directory } from '@/typings/api';
import { directoryApi } from '@/api';
import AccessRuleEditor from './AccessRuleEditor.vue';
const props = defineProps<FileUploadAccessProps>();
const emit = defineEmits<{ 'update:modelValue': [value: FileUploadAccessProps['modelValue']] }>();
const directory = ref<Directory | null>(null);
const loading = ref(false);
const error = ref('');
/**
 * 展开附件授权配置时才读取当前组织选项，避免详情页多个上传区重复请求。
 * @param names 已展开面板名称
 */
async function expand(names: Array<string | number>): Promise<void> {
  if (!names.length || directory.value || loading.value) return;
  loading.value = true;
  try {
    directory.value = await directoryApi();
    error.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '授权选项读取失败，请收起后重试';
  } finally {
    loading.value = false;
  }
}
/**
 * 为本次上传设置附加受众，服务端始终同时校验所属节点约束。
 * @param key 查看或下载授权
 * @param value 附加规则，空值表示继承
 */
function update(key: 'access' | 'downloadAccess', value: DataAccessRule | undefined): void {
  if (!props.disabled) emit('update:modelValue', { ...props.modelValue, [key]: value });
}
</script>
<template>
  <NCollapse class="upload-access" @update:expanded-names="expand"
    ><NCollapseItem title="本次上传的资料权限" name="permissions"
      ><NAlert type="info" :bordered="false" class="mb"
        >默认继承所属{{
          node ? '节点' : '活动阶段'
        }}范围。附加授权只会收紧可见人员；敏感内容查看授权仍由角色管理。</NAlert
      ><NSpin :show="loading"
        ><NAlert v-if="error" type="warning">{{ error }}</NAlert
        ><template v-if="directory"
          ><AccessRuleEditor
            :model-value="modelValue.access"
            :config="directory"
            :disabled="disabled"
            :node="node"
            inherit
            inherit-label="继承所属节点或活动"
            label="附件附加查看范围"
            @update:model-value="update('access', $event)" /><AccessRuleEditor
            :model-value="modelValue.downloadAccess"
            :fallback="modelValue.access"
            :config="directory"
            :disabled="disabled"
            :node="node"
            inherit
            label="附件附加下载范围"
            @update:model-value="update('downloadAccess', $event)" /></template></NSpin></NCollapseItem
  ></NCollapse>
</template>
<style scoped>
.upload-access {
  margin: 12px 0 16px;
  font-size: 13px;
}
</style>
