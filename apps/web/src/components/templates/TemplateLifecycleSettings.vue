<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NAlert, NButton, NDrawer, NDrawerContent, NFormItem, NSelect, NTag } from 'naive-ui'
  import { lifecycleOf, defaultRequestForm } from '@workflow/domain'
  import type { CompanyConfig, TemplateDefinition } from '@workflow/domain'
  import type { TemplateSettingsProps } from './types'
  import FormsPanel from '@/components/config/FormsPanel.vue'
  const props = defineProps<TemplateSettingsProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: TemplateDefinition] }>()
  const formOpen = ref(false)
  const lifecycle = computed(() => lifecycleOf(props.modelValue))
  const formContext = computed(() => ({ ...props.config, form: props.modelValue.form || defaultRequestForm() }))
  /** 切换未发布模板的业务类型，同步独立表单与允许的后续方案。
   * @param businessType 业务类型
   */
  function changeType(businessType: 'activity' | 'general'): void {
    if (props.disabled || props.typeLocked) return
    emit('update:modelValue', {
      ...props.modelValue,
      lifecycle: { businessType, afterApproval: businessType === 'general' ? 'complete' : 'activity_standard', version: 1 },
      form: businessType === 'general' ? defaultRequestForm() : undefined,
      activityTypeIds:
        businessType === 'general'
          ? []
          : props.types.slice(0, 1).map(
              /** 选取第一个可用活动类型。
               * @param type 活动类型
               * @returns 类型标识
               */ function id(type) {
                return type.id
              }
            ),
      defaultForTypeIds: [],
    })
  }
  /** 更新模板发布时冻结的接续方案，不修改正在运行的申请。
   * @param afterApproval 已注册接续方案
   */
  function changeProfile(afterApproval: 'complete' | 'activity_standard'): void {
    if (!props.disabled) emit('update:modelValue', { ...props.modelValue, lifecycle: { ...lifecycle.value, afterApproval } })
  }
  /** 应用独立申请表字段；由工作台统一保存模板草稿及发布快照。
   * @param value 字段设计器返回的上下文
   */
  function changeForm(value: CompanyConfig): void {
    if (!props.disabled) emit('update:modelValue', { ...props.modelValue, form: { ...value.form, businessType: 'general' } })
  }
</script>
<template>
  <section class="lifecycle-settings">
    <NFormItem label="业务类型">
      <NSelect
        :value="lifecycle.businessType"
        :disabled="disabled || typeLocked"
        :options="[
          { label: '活动申请', value: 'activity' },
          { label: '通用 OA 申请', value: 'general' },
        ]"
        @update:value="changeType"
      />
    </NFormItem>
    <p v-if="typeLocked" class="help-text">已发布模板保持业务类型；需要其他业务请新建模板。</p>
    <NFormItem label="审批通过后">
      <NSelect
        :value="lifecycle.afterApproval"
        :disabled="disabled"
        :options="
          lifecycle.businessType === 'general'
            ? [{ label: '直接办结', value: 'complete' }]
            : [
                { label: '接续活动执行与归档', value: 'activity_standard' },
                { label: '直接办结（仅审批）', value: 'complete' },
              ]
        "
        @update:value="changeProfile"
      />
    </NFormItem>
    <div class="profile-card">
      <NTag type="info" size="small" :bordered="false">{{ lifecycle.afterApproval === 'complete' ? '审批即办结' : '活动业务子流程 · V1' }}</NTag>
      <p>
        {{
          lifecycle.afterApproval === 'complete'
            ? '全部必办节点完成后自动办结，申请与审批记录持续留存。'
            : '审批通过 → 指派执行人 → 执行与持续汇报 → 提交成果 → 归档审核 → 办结。'
        }}
      </p>
      <p v-if="lifecycle.afterApproval !== 'complete'">最后审批人指派并审核归档；执行人汇报及提交成果。</p>
    </div>
    <NFormItem v-if="lifecycle.businessType === 'general'" label="独立申请表单">
      <div class="stack">
        <span>{{ (modelValue.form || defaultRequestForm()).fields.length }} 个字段 · 不要求活动时间或预算</span>
        <NButton :disabled="disabled" @click="formOpen = true">配置申请字段及附件</NButton>
      </div>
    </NFormItem>
    <NDrawer v-model:show="formOpen" :width="900" style="max-width: 96vw" :z-index="2400">
      <NDrawerContent title="通用申请表单" closable>
        <NAlert type="info" :bordered="false" class="mb">字段随本模板保存与发布，已有申请保留原表单快照。申请标题为公共必填字段。</NAlert>
        <FormsPanel :model-value="formContext" :saving="disabled" :overlay-z-index="2500" @update:model-value="changeForm" />
        <template #footer><NButton type="primary" @click="formOpen = false">完成字段配置</NButton></template>
      </NDrawerContent>
    </NDrawer>
  </section>
</template>
<style scoped>
  .profile-card {
    padding: 14px;
    background: #f2f6ff;
    border: 1px solid #dde7fa;
    border-radius: 10px;
    margin-bottom: 18px;
  }
  .profile-card p {
    font-size: 13px;
    line-height: 1.7;
    margin: 10px 0 0;
  }
</style>
