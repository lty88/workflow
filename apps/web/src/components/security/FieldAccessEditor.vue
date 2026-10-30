<script setup lang="tsx">
import { NAlert, NCollapse, NCollapseItem, NFormItem, NSelect } from 'naive-ui';
import { SHARED_ACCESS } from '@workflow/domain';
import type { DataAccessRule, FieldAccess } from '@workflow/domain';
import type { FieldAccessEditorProps } from './types';
import AccessRuleEditor from './AccessRuleEditor.vue';
import { clone } from '@/composables/format';
const props = defineProps<FieldAccessEditorProps>();
const emit = defineEmits<{ 'update:modelValue': [value: FieldAccess] }>();
const applicantDefault = { ...SHARED_ACCESS, applicant: true };
/**
 * 更新字段查看、编辑或脱敏规则，保留其他属性配置。
 * @param key 规则键
 * @param value 对应新值
 */
function update(key: 'read' | 'write' | 'mask', value: DataAccessRule | string | undefined): void {
  if (props.disabled) return;
  const next: FieldAccess = { read: clone(SHARED_ACCESS), mask: 'hidden', ...props.modelValue };
  if (key === 'mask' && (value === 'hidden' || value === 'partial')) next.mask = value;
  if ((key === 'read' || key === 'write') && typeof value === 'object') next[key] = value;
  emit('update:modelValue', next);
}
</script>
<template>
  <NCollapse
    ><NCollapseItem title="数据权限与脱敏" name="access"
      ><NAlert type="info" :bordered="false" class="mb"
        >字段显隐用于表单交互；这里控制真实数据授权。申请必填字段须允许申请人查看和填写。</NAlert
      ><AccessRuleEditor
        :model-value="modelValue?.read"
        :fallback="applicantDefault"
        :config="config"
        :disabled="disabled"
        label="字段原文查看范围"
        @update:model-value="update('read', $event)"
      /><NFormItem label="无原文查看权限时"
        ><NSelect
          :value="modelValue?.mask || 'hidden'"
          :options="[
            { label: '隐藏字段和内容', value: 'hidden' },
            { label: '仅显示部分脱敏值', value: 'partial' },
          ]"
          :disabled="disabled"
          @update:value="update('mask', $event)" /></NFormItem
      ><AccessRuleEditor
        :model-value="modelValue?.write"
        :fallback="applicantDefault"
        :config="config"
        :disabled="disabled"
        operation="edit"
        label="字段编辑范围"
        @update:model-value="update('write', $event)"
      />
      <p class="field-access-note">
        编辑还需要活动的编辑资格和字段原文阅读权限。敏感字段导出需另授“敏感导出与跨节点下载”。
      </p></NCollapseItem
    ></NCollapse
  >
</template>
<style scoped>
.field-access-note {
  font-size: 12px;
  line-height: 1.7;
  color: #718098;
}
</style>
