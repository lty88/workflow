<script setup lang="tsx">
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NCard, NInput, NSelect } from 'naive-ui';
import { activeMember, defaultValues, hasPermission, templateContext, lifecycleOf } from '@workflow/domain';
import type { CompanyConfig, Member, TemplateDefinition } from '@workflow/domain';
import type { WorkflowPreview } from '@/typings/api';
import { simulateTemplateApi } from '@/api/templates';
import { useFeedback } from '@/composables/use-feedback';
import DynamicForm from '@/components/activity/DynamicForm.vue';
import WorkflowTimeline from '@/components/activity/WorkflowTimeline.vue';
const props = defineProps<{
  templateId: string;
  definition: TemplateDefinition;
  config: CompanyConfig;
  disabled: boolean;
}>();
const feedback = useFeedback();
const applicant = ref('');
const budget = ref('12000');
const busy = ref(false);
const result = ref<WorkflowPreview | null>(null);
const general = computed(() => lifecycleOf(props.definition).businessType === 'general');
const simulationForm = computed(() => templateContext(props.config, props.definition, props.config.form).form);
const payload = ref<Record<string,string>>(defaultValues(simulationForm.value));
const inputKeys = computed(() => simulationForm.value.fields.filter(
  /** 路线演算只填写判断条件所需字段，不创建文件上传记录。
   * @param field 表单字段
   * @returns 是否非附件输入
   */ function input(field) { return field.type !== 'attachment'; },
).map(
  /** 提取可用于演算的表单字段键。
   * @param field 表单字段
   * @returns 字段键
   */ function key(field) { return field.key; },
));
const options = computed(() => props.config.users.filter(canApply).map(option));
/**
 * 筛选有效申请人员，演算仍由服务端重新校验。
 * @param member 公司成员
 * @returns 是否有申请权限
 */
function canApply(member: Member): boolean {
  return activeMember(props.config, member.id) && hasPermission(props.config, member.id, 'activity:create');
}
/**
 * 转换申请人选项。
 * @param member 公司成员
 * @returns 人员下拉选项
 */
function option(member: Member) {
  return { label: member.name, value: member.id };
}
/** 请求服务端按当前草稿演算实际人员与分支，不创建活动或任务。 */
async function simulate(): Promise<void> {
  if (props.disabled || busy.value) return;
  if (!general.value && !/^\d+(\.\d{1,2})?$/.test(budget.value)) {
    feedback.failure(new Error('预算必须为非负金额，最多两位小数'));
    return;
  }
  busy.value = true;
  try {
    result.value = await simulateTemplateApi(
      props.templateId,
      props.definition,
      applicant.value || options.value[0]?.value || '',
      general.value ? payload.value : { ...defaultValues(simulationForm.value), budget: budget.value },
    );
  } catch (error) {
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/** 模板规则变化后清除旧演算，避免将旧结果当作新版本。 */
function invalidate(): void {
  result.value = null;
  const next = defaultValues(simulationForm.value);
  for (const key of inputKeys.value) if (Object.hasOwn(payload.value,key)) next[key] = payload.value[key]!;
  payload.value = next;
}
/** 演算参数变化后清除旧路线，要求重新计算实际分支。 */
function clearResult(): void { result.value = null; }
watch([applicant,budget,payload], clearResult, { deep:true });
watch(() => props.definition, invalidate, { deep: true });
</script>
<template>
  <NCard title="发布前路线演算"
    ><p class="help-text">{{ general ? '按本模板的申请字段和申请人演算条件分支，附件无需上传；不会创建业务工单。' : '使用当前草稿与已发布表单默认值，按所选申请人及预算计算条件；不会创建业务工单。' }}</p>
    <div class="filters">
      <NSelect
        v-model:value="applicant"
        :options="options"
        placeholder="选择申请人"
        style="width: 200px"
      /><NInput v-if="!general" v-model:value="budget" placeholder="预算金额" style="width: 180px" /><NButton
        :loading="busy"
        :disabled="disabled"
        @click="simulate"
        >演算草稿路线</NButton
      >
    </div>
    <DynamicForm v-if="general" v-model="payload" :schema="simulationForm" :keys="inputKeys" :disabled="busy || disabled" />
    <template v-if="result"
      ><NAlert v-if="result.errors.length" type="warning" class="mb"
        ><div v-for="error in result.errors" :key="error">{{ error }}</div></NAlert
      ><WorkflowTimeline
        :detail="{
          activity: { nodes: result.nodes, tasks: [], status: 'approving', lifecycle: definition.lifecycle },
          participants: result.participants,
        }" /></template
  ></NCard>
</template>
