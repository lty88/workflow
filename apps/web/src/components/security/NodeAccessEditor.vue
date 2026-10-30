<script setup lang="tsx">
  import { SHARED_ACCESS, dataAccessScopeLabel } from '@workflow/domain'
  import type { DataAccessRule, NodeDefinition } from '@workflow/domain'
  import type { NodeAccessEditorProps } from './types'
  import AccessRuleEditor from './AccessRuleEditor.vue'
  import PermissionHint from './PermissionHint.vue'
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
  <div class="node-access-heading">
    节点默认权限
    <PermissionHint label="节点默认权限说明"><p>新申请默认流程内共享，可为敏感资料改为本节点或指定受众。</p><p>模板修改只影响后续提交，已有附件通过“单文件权限”调整。</p></PermissionHint>
  </div>
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
    operation="download"
    :inherited-scope="dataAccessScopeLabel(modelValue.access || SHARED_ACCESS, true)"
    inherit-label="沿用本节点查看范围"
    inherit-hint="下载默认沿用上方的节点查看范围，仍需角色具备下载权限。"
    label="节点附件下载范围"
    @update:model-value="update('downloadAccess', $event)"
  />
</template>
<style scoped>
  .node-access-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 12px;
    color: #718098;
    font-size: 13px;
  }
</style>
