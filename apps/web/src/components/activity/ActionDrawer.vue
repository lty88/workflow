<script setup lang="tsx">
import { computed, ref, watch } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import {
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NDatePicker,
  NSelect,
  NButton,
  NCheckbox,
  NAlert,
  NRadioGroup,
  NRadioButton,
} from 'naive-ui';
import { actionApi, decisionApi, directoryApi } from '../../api';
import type { Directory } from '../../typings/api';
import type { ActionProps } from './types';
import { ACTION_LABELS } from './types';
import { useFeedback } from '../../composables/use-feedback';
const props = defineProps<ActionProps>();
const emit = defineEmits<{ 'update:show': [value: boolean]; done: [] }>();
const feedback = useFeedback();
const mobile = useMediaQuery('(max-width: 850px)');
const busy = ref(false);
const directory = ref<Directory | null>(null);
const decision = ref<'approve' | 'return' | 'reject'>('approve');
const comment = ref('');
const executor = ref<string | null>(null);
const url = ref('');
const disposal = ref('');
const checks = ref([false, false, false]);
const report = ref({ start: '', end: '', people: 0, summary: '', spend: '', exception: '' });
const nodeKind = computed(() => props.detail.activity.nodes.find(matchesNode)?.kind);
const executors = computed(() => (directory.value?.users || []).filter(canExecute).map(memberOption));
const title = computed(() =>
  props.task
    ? nodeKind.value === 'approval'
      ? '办理审批'
      : '完成节点任务'
    : ACTION_LABELS[props.action] || '办理工单',
);
/**
 * 找到当前任务节点。
 * @param node 节点
 * @returns 是否对应
 */
function matchesNode(node: { id: string }): boolean {
  return node.id === props.task?.nodeId;
}
/**
 * 筛选可执行成员。
 * @param user 成员
 * @returns 是否有执行权限
 */
function canExecute(user: Directory['users'][number]): boolean {
  return user.canExecute;
}
/**
 * 转换成员下拉项。
 * @param user 成员
 * @returns 下拉项
 */
function memberOption(user: Directory['users'][number]): { label: string; value: string } {
  return { label: user.name, value: user.id };
}
/**
 * 每次打开时清空意见，并按需加载执行人员。
 * @param open 是否打开
 */
async function initialize(open: boolean): Promise<void> {
  if (!open) return;
  comment.value = '';
  decision.value = 'approve';
  executor.value = null;
  url.value = props.detail.activity.archive?.url || '';
  disposal.value = '';
  checks.value = [false, false, false];
  const start = props.detail.activity.actualStart || new Date().toISOString();
  report.value = {
    start,
    end: new Date().toISOString(),
    people: Number(props.detail.activity.payload.people || 0),
    summary: '',
    spend: '',
    exception: '',
  };
  if (props.action === 'assign')
    try {
      directory.value = await directoryApi();
    } catch (error) {
      feedback.failure(error);
    }
}
watch(() => props.show, initialize);
/**
 * 显示时间戳。
 * @param value ISO日期
 * @returns 时间戳
 */
function timestamp(value: string): number | null {
  return value ? Date.parse(value) : null;
}
/**
 * 更新汇报的实际时间。
 * @param key 时间字段
 * @param value 时间戳
 */
function setTime(key: 'start' | 'end', value: number | null): void {
  report.value[key] = value === null ? '' : new Date(value).toISOString();
}
/**
 * 提交个人任务或当前业务动作，服务端检查版本与实时权限。
 */
async function submit(): Promise<void> {
  busy.value = true;
  try {
    if (props.task) {
      if (nodeKind.value !== 'approval' && decision.value !== 'approve') throw new Error('任务节点只能完成');
      await decisionApi(props.task.id, props.task.version, decision.value, comment.value);
    } else {
      await actionApi(props.detail.activity.id, {
        action: props.action as Parameters<typeof actionApi>[1]['action'],
        expectedVersion: props.detail.activity.version,
        comment: comment.value,
        ...(props.action === 'assign' ? { executor: executor.value || '' } : {}),
        ...(props.action === 'report' ? { report: report.value } : {}),
        ...(props.action === 'archive-submit' ? { url: url.value } : {}),
        ...(props.action === 'archive-approve' ? { checks: checks.value } : {}),
        ...(props.action === 'cancel-request' ? { disposal: disposal.value } : {}),
      });
    }
    feedback.success('操作已完成');
    emit('update:show', false);
    emit('done');
  } catch (error) {
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <NDrawer :show="show" :width="mobile ? '100%' : 520" @update:show="emit('update:show', $event)"
    ><NDrawerContent :title="title" closable
      ><NAlert type="info" :bordered="false" class="mb"
        >{{ detail.activity.name || '未命名活动' }} · {{ detail.activity.code }}</NAlert
      ><NForm :disabled="busy" label-placement="top"
        ><NFormItem v-if="task && nodeKind === 'approval'" label="审批结论"
          ><NRadioGroup v-model:value="decision"
            ><NRadioButton value="approve">通过</NRadioButton
            ><NRadioButton value="return">退回补充</NRadioButton
            ><NRadioButton value="reject">拒绝</NRadioButton></NRadioGroup
          ></NFormItem
        ><NFormItem v-if="action === 'assign'" label="执行负责人" required
          ><NSelect
            v-model:value="executor"
            :options="executors"
            filterable
            placeholder="选择有效执行人" /></NFormItem
        ><template v-if="action === 'report'"
          ><NFormItem label="实际开始时间" required
            ><NDatePicker
              :value="timestamp(report.start)"
              type="datetime"
              style="width: 100%"
              @update:value="setTime('start', $event)" /></NFormItem
          ><NFormItem label="实际结束时间" required
            ><NDatePicker
              :value="timestamp(report.end)"
              type="datetime"
              style="width: 100%"
              @update:value="setTime('end', $event)" /></NFormItem
          ><NFormItem label="实到人数" required
            ><NInputNumber v-model:value="report.people" :min="0" :max="100000" :precision="0" /></NFormItem
          ><NFormItem label="执行情况与成果（至少10字）" required
            ><NInput
              v-model:value="report.summary"
              type="textarea"
              :maxlength="3000"
              :autosize="{ minRows: 4 }" /></NFormItem
          ><NFormItem label="实际支出（元）"
            ><NInput v-model:value="report.spend" placeholder="非负金额，最多两位小数" /></NFormItem
          ><NFormItem label="异常说明"
            ><NInput
              v-model:value="report.exception"
              type="textarea"
              :maxlength="1000" /></NFormItem></template
        ><NFormItem v-if="action === 'archive-submit'" label="成果链接"
          ><NInput v-model:value="url" placeholder="https://，已上传成果附件时可不填" /></NFormItem
        ><NFormItem
          v-if="action === 'cancel-request' && detail.activity.status === 'executing'"
          label="已发生费用处置方式"
          required
          ><NInput v-model:value="disposal" type="textarea" :maxlength="1000"
        /></NFormItem>
        <div v-if="action === 'archive-approve'" class="stack mb">
          <NCheckbox v-model:checked="checks[0]">活动信息与执行情况一致</NCheckbox
          ><NCheckbox v-model:checked="checks[1]">成果资料完整且可访问</NCheckbox
          ><NCheckbox v-model:checked="checks[2]">费用与异常情况已说明</NCheckbox>
        </div>
        <NFormItem
          :label="
            action === 'archive-submit'
              ? '成果摘要（至少10字）'
              : action === 'assign'
                ? '执行安排（至少5字）'
                : '意见 / 原因'
          "
          :required="
            decision !== 'approve' ||
            ['assign', 'archive-submit', 'archive-return', 'cancel-request', 'cancel-reject'].includes(action)
          "
          ><NInput
            v-model:value="comment"
            type="textarea"
            :maxlength="task ? 500 : 1000"
            show-count
            :autosize="{ minRows: 4 }"
            :placeholder="
              task && decision !== 'approve' ? '至少填写5字原因' : '请填写具体意见或说明'
            " /></NFormItem></NForm
      ><template #footer
        ><div class="gap">
          <NButton :disabled="busy" @click="emit('update:show', false)">取消</NButton
          ><NButton type="primary" :loading="busy" @click="submit">确认{{ title }}</NButton>
        </div></template
      ></NDrawerContent
    ></NDrawer
  >
</template>
