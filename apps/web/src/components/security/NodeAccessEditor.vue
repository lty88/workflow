<script setup lang="tsx">
  import { NAlert } from 'naive-ui'
  import { NODE_PRIVATE_ACCESS } from '@workflow/domain'
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
  <NAlert type="info" :bordered="false" class="mb">
    内部说明是办理人员的详细备注，默认仅本节点受理人及有敏感查看权限的人员可见，同部门不会自动开放。若希望申请人也查看，请在下方勾选“申请人”；面向活动相关人员的意见请填写公开结论。
  </NAlert>
  <AccessRuleEditor
    :model-value="modelValue.access"
    :fallback="NODE_PRIVATE_ACCESS"
    :config="config"
    :disabled="disabled"
    node
    force-node-assignees
    label="节点内容查看范围"
    @update:model-value="update('access', $event)"
  />
  <AccessRuleEditor
    :model-value="modelValue.downloadAccess"
    :fallback="modelValue.access || NODE_PRIVATE_ACCESS"
    :config="config"
    :disabled="disabled"
    node
    inherit
    label="节点附件下载范围"
    @update:model-value="update('downloadAccess', $event)"
  />
  <p class="permission-note">附件默认继承节点规则；单文件明确选择“活动内共享”或“指定授权”后单独生效，不会公开内部说明。下载还需角色具备“下载活动附件”权限。</p>
</template>
<style scoped>
  .permission-note {
    font-size: 12px;
    line-height: 1.7;
    color: #718098;
    margin: 0 0 16px;
  }
</style>
