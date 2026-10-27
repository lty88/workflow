<script setup lang="tsx">
  import { computed } from 'vue'
  import { NAlert, NForm, NFormItem, NInput, NSelect, NSwitch } from 'naive-ui'
  import type { TemplateDefinition } from '@workflow/domain'
  import type { TemplateSettingsProps } from './types'
  import { clone } from '@/composables/format'
  const props = defineProps<TemplateSettingsProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: TemplateDefinition] }>()
  const typeOptions = computed(() => props.types.map(option))
  const departmentOptions = computed(() => props.config.departments.map(option))
  const roleOptions = computed(() => props.config.roles.map(option))
  const defaultOptions = computed(() => props.types.filter(included).map(option))
  /**
   * 将活动类型、部门或角色转换成下拉项。
   * @param item 配置对象
   * @returns 选择项
   */
  function option(item: { id: string; name: string }) {
    return { label: item.name, value: item.id }
  }
  /**
   * 限制默认推荐只能引用已包含的活动类型。
   * @param item 活动类型
   * @returns 是否已适用
   */
  function included(item: { id: string }): boolean {
    return props.modelValue.activityTypeIds.includes(item.id)
  }
  /**
   * 即时更新模板设置，随主工作台统一保存，并清理失效的默认类型。
   * @param key 模板属性
   * @param value 新值
   */
  function update<K extends keyof TemplateDefinition>(key: K, value: TemplateDefinition[K]): void {
    if (props.disabled) return
    const next = clone(props.modelValue)
    next[key] = value
    const defaults = []
    for (const id of next.defaultForTypeIds) if (next.activityTypeIds.includes(id)) defaults.push(id)
    next.defaultForTypeIds = defaults
    emit('update:modelValue', next)
  }
</script>
<template>
  <NForm label-placement="top" :disabled="disabled">
    <NFormItem label="模板名称" required><NInput :value="modelValue.name" :maxlength="80" @update:value="update('name', $event)" /></NFormItem>
    <NFormItem label="适用活动类型" required>
      <NSelect :value="modelValue.activityTypeIds" multiple :options="typeOptions" @update:value="update('activityTypeIds', $event)" />
    </NFormItem>
    <NFormItem label="默认推荐给哪些活动类型">
      <NSelect :value="modelValue.defaultForTypeIds" multiple clearable :options="defaultOptions" @update:value="update('defaultForTypeIds', $event)" />
    </NFormItem>
    <NFormItem label="可使用的部门">
      <NSelect
        :value="modelValue.departmentIds"
        multiple
        clearable
        :options="departmentOptions"
        placeholder="留空表示全部部门，含下级"
        @update:value="update('departmentIds', $event)"
      />
    </NFormItem>
    <NFormItem label="可使用的角色">
      <NSelect
        :value="modelValue.roleIds"
        multiple
        clearable
        :options="roleOptions"
        placeholder="留空表示所有具备申请权限的角色"
        @update:value="update('roleIds', $event)"
      />
    </NFormItem>
    <NFormItem label="节点办理质量评分">
      <div class="stack">
        <NSwitch :value="!!modelValue.ratingEnabled" @update:value="update('ratingEnabled', $event)" />
        <span class="help-text">开启后，在具体审批节点设置上游评分为选填或必填。评分不自动改变审批结论。</span>
      </div>
    </NFormItem>
    <NFormItem label="保存的布局方向">
      <NSelect
        :value="modelValue.layout.direction"
        :options="[
          { label: '纵向', value: 'TB' },
          { label: '横向', value: 'LR' },
        ]"
        @update:value="update('layout', { direction: $event, positions: {} })"
      />
    </NFormItem>
  </NForm>
  <NAlert type="info" :bordered="false">点击下方“保存模板设置”即可提交服务器，无需先启用。启用版本时采用当前活动表单，已有活动保留原快照。</NAlert>
</template>
