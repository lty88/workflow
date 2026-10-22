<script setup lang="tsx">
import { computed, ref } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import {
  NButton,
  NCard,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSwitch,
  NTag,
  NPopconfirm,
  NAlert,
} from 'naive-ui';
import type { CompanyConfig, FormField } from '@workflow/domain';
import type { ConfigPanelProps } from './types';
import { FIELD_TYPES } from './types';
import { clone, newId } from '@/composables/format';
import { useFeedback } from '@/composables/use-feedback';
import ConditionEditor from './ConditionEditor.vue';
import FieldAccessEditor from '@/components/security/FieldAccessEditor.vue';
import DynamicForm from '@/components/activity/DynamicForm.vue';
import { defaultValues } from '@workflow/domain';
const props = defineProps<ConfigPanelProps>();
const emit = defineEmits<{ 'update:modelValue': [value: CompanyConfig] }>();
const feedback = useFeedback();
const mobile = useMediaQuery('(max-width: 850px)');
const editing = ref<FormField | null>(null);
const open = ref(false);
const previewOpen = ref(false);
const preview = ref<Record<string, string>>({});
const optionText = ref('');
const existing = ref(false);
const typeOptions = Object.entries(FIELD_TYPES).map(typeOption);
const fields = computed(() => props.modelValue.form.fields);
/**
 * 转换字段类型选项。
 * @param pair 类型键值
 * @returns 下拉项
 */
function typeOption(pair: [string, string]): { label: string; value: string } {
  return { label: pair[1], value: pair[0] };
}
/**
 * 打开新增或已有字段的编辑抽屉。
 * @param field 既有字段
 */
function edit(field?: FormField): void {
  existing.value = !!field;
  editing.value = field
    ? clone(field)
    : { id: newId('f'), key: '', label: '', type: 'text', required: false, default: '', options: [] };
  optionText.value = editing.value.options.join('\n');
  open.value = true;
}
/**
 * 校验稳定键并写回整份草案。
 */
function save(): void {
  if (!editing.value) return;
  const item = clone(editing.value);
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(item.key) || !item.label.trim()) {
    feedback.failure(new Error('请填写名称与2至40位英文小写字段键'));
    return;
  }
  for (const field of fields.value)
    if (field.id !== item.id && field.key === item.key) {
      feedback.failure(new Error('字段键已存在'));
      return;
    }
  item.options = ['select', 'checkboxes'].includes(item.type)
    ? optionText.value.split('\n').map(trimOption).filter(Boolean)
    : [];
  const next = clone(props.modelValue);
  const index = next.form.fields.findIndex(matchesEditing);
  if (index < 0) next.form.fields.push(item);
  else next.form.fields[index] = item;
  emit('update:modelValue', next);
  open.value = false;
}
/**
 * 匹配当前编辑字段。
 * @param field 字段
 * @returns 是否同一字段
 */
function matchesEditing(field: FormField): boolean {
  return field.id === editing.value?.id;
}
/**
 * 清理选项两端空格。
 * @param value 选项
 * @returns 清理后的文本
 */
function trimOption(value: string): string {
  return value.trim();
}
/**
 * 删除非系统字段，跨模块引用由发布校验提示。
 * @param id 字段标识
 */
function remove(id: string): void {
  const next = clone(props.modelValue);
  const index = next.form.fields.findIndex(
    /**
     * 按当前目标标识查找配置项或参与人。
     * @param field 当前集合项
     * @returns 是否符合筛选条件
     */ function match(field) {
      return field.id === id;
    },
  );
  if (index < 0 || next.form.fields[index]?.system) return;
  next.form.fields.splice(index, 1);
  emit('update:modelValue', next);
}
/**
 * 调整字段展示顺序。
 * @param index 当前索引
 * @param offset 移动方向
 */
function move(index: number, offset: number): void {
  const next = clone(props.modelValue);
  const other = index + offset;
  if (other < 0 || other >= next.form.fields.length) return;
  const item = next.form.fields.splice(index, 1)[0]!;
  next.form.fields.splice(other, 0, item);
  emit('update:modelValue', next);
}
/**
 * 使用当前草案初始化动态表单试填。
 */
function showPreview(): void {
  preview.value = defaultValues(props.modelValue.form);
  previewOpen.value = true;
}
</script>
<template>
  <NCard title="活动申请表"
    ><template #header-extra
      ><div class="gap">
        <NButton size="small" @click="showPreview">试填预览</NButton
        ><NButton type="primary" size="small" @click="edit()">＋ 新增字段</NButton>
      </div></template
    >
    <p class="help-text">字段键发布后保持稳定。系统字段用于金额、时间和流程计算，保留类型与必填要求。</p>
    <div class="config-list">
      <div v-for="(field, index) in fields" :key="field.id" class="config-item">
        <div>
          <strong>{{ field.label }}</strong>
          <NTag v-if="field.required" size="small" type="info" :bordered="false">必填</NTag>
          <NTag v-if="field.system" size="small" :bordered="false">系统</NTag
          ><small
            >{{ field.key }} · {{ FIELD_TYPES[field.type] }}{{ field.visible ? ' · 条件显示' : '' }}</small
          >
        </div>
        <div class="gap">
          <NButton size="tiny" :disabled="index === 0" @click="move(index, -1)">↑</NButton
          ><NButton size="tiny" :disabled="index === fields.length - 1" @click="move(index, 1)">↓</NButton
          ><NButton size="small" text type="primary" @click="edit(field)">编辑</NButton
          ><NPopconfirm v-if="!field.system" @positive-click="remove(field.id)"
            ><template #trigger><NButton size="small" text type="error">删除</NButton></template
            >删除后请检查条件与流程引用。</NPopconfirm
          >
        </div>
      </div>
    </div></NCard
  ><NDrawer v-model:show="open" :width="mobile ? '100%' : 520"
    ><NDrawerContent :title="existing ? '编辑字段' : '新增字段'" closable
      ><NForm v-if="editing" label-placement="top"
        ><NFormItem label="字段名称" required
          ><NInput v-model:value="editing.label" :maxlength="80" /></NFormItem
        ><NFormItem label="字段键（英文小写 / 数字 / 下划线）" required
          ><NInput v-model:value="editing.key" :disabled="existing" :maxlength="40" /></NFormItem
        ><NFormItem label="控件类型"
          ><NSelect
            v-model:value="editing.type"
            :options="typeOptions"
            :disabled="editing.system" /></NFormItem
        ><NFormItem label="必填"
          ><NSwitch v-model:value="editing.required" :disabled="editing.system" /></NFormItem
        ><NFormItem v-if="['select', 'checkboxes'].includes(editing.type)" label="选项（每行一个）" required
          ><NInput v-model:value="optionText" type="textarea" :autosize="{ minRows: 4 }" /></NFormItem
        ><NFormItem label="默认值"
          ><NInput
            v-model:value="editing.default"
            placeholder="多选使用顿号连接，日期使用ISO格式"
            :maxlength="3000" /></NFormItem
        ><ConditionEditor
          v-if="!editing.system"
          v-model="editing.visible"
          :fields="fields"
          :excluded="editing.key"
          label="满足条件时显示" /><NAlert v-else type="info"
          >此字段参与系统计算，条件显隐保持固定；数据权限可单独配置。</NAlert
        ><FieldAccessEditor v-model="editing.access" :config="modelValue" /></NForm
      ><template #footer><NButton type="primary" @click="save">应用到草案</NButton></template></NDrawerContent
    ></NDrawer
  ><NDrawer v-model:show="previewOpen" :width="mobile ? '100%' : 820"
    ><NDrawerContent title="动态表单试填" closable
      ><NAlert type="info" class="mb">试填只保留在当前页面，可检查条件显隐与费用合计。</NAlert
      ><DynamicForm v-model="preview" :schema="modelValue.form" /></NDrawerContent
  ></NDrawer>
</template>
