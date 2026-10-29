<script setup lang="tsx">
  import { NAlert } from 'naive-ui'
  import { SHARED_ACCESS } from '@workflow/domain'
  import type { DataAccessRule, NodeDefinition } from '@workflow/domain'
  import type { NodeAccessEditorProps } from './types'
  import AccessRuleEditor from './AccessRuleEditor.vue'
  const props = defineProps<NodeAccessEditorProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: NodeDefinition] }>()
  /**
   * 将节点内容或下载规则写入独立草稿，随流程版本统一保存。
   * @param key 规则类别
   * @param value 新授权或继承状态
   */
  function update(key: 'access' | 'downloadAccess', value: DataAccessRule | undefined): void {
    if (!props.disabled) emit('update:modelValue', { ...props.modelValue, [key]: value })
  }
</script>
<template>
  <NAlert type="info" :bordered="false" class="mb">新提交申请的普通节点附件默认流程内共享，后续审批人可查阅。敏感资料可选择“仅本节点办理人”或“指定人员或角色”。规则随申请提交冻结，已有申请保持原权限，可通过“单文件权限”调整。</NAlert>
  <AccessRuleEditor
    :model-value="modelValue.access"
    :fallback="SHARED_ACCESS"
    :config="config"
    :disabled="disabled"
    node
    force-node-assignees
    label="节点附件查看范围"
    @update:model-value="update('access', $event)"
  />
  <AccessRuleEditor
    :model-value="modelValue.downloadAccess"
    :fallback="modelValue.access || SHARED_ACCESS"
    :config="config"
    :disabled="disabled"
    node
    inherit
    label="节点附件下载范围"
    @update:model-value="update('downloadAccess', $event)"
  />
  <p class="permission-note">附件默认按节点设置。单文件选择共享、仅本节点或指定人员后独立生效。下载还需角色具备“下载申请附件”权限。</p>
</template>
<style scoped>
  .permission-note {
    font-size: 12px;
    line-height: 1.7;
    color: #718098;
    margin: 0 0 16px;
  }
</style>
