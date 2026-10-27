<script setup lang="tsx">
  import { computed } from 'vue'
  import { NAlert, NFormItem, NSelect, NSwitch } from 'naive-ui'
  import { defaultApprovalPolicy, upstreamNodeIds } from '@workflow/domain'
  import type { NodeApprovalPolicy } from '@workflow/domain'
  import type { ApprovalRulesProps } from './types'
  const props = defineProps<ApprovalRulesProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: NodeApprovalPolicy] }>()
  const policy = computed(() => props.modelValue || defaultApprovalPolicy())
  const targets = computed(() => {
    const ancestors = new Set(upstreamNodeIds(props.nodes, props.node.id))
    return props.nodes
      .filter(
        /** 排除无关分支与知会，前后顺序由依赖关系判定。
         * @param node 候选节点
         * @returns 是否为可配置退回目标
         */ function upstream(node) {
          return ancestors.has(node.id) && node.kind !== 'notice'
        }
      )
      .map(
        /** 转换上游节点为选择项。
         * @param node 上游节点
         * @returns 节点名称和标识
         */ function option(node) {
          return { label: node.label, value: node.id }
        }
      )
  })
  const ratingNames = computed(() =>
    props.nodes
      .filter(
        /** 找出本节点将评价的直接前置审批。
         * @param node 候选节点
         * @returns 是否直接前置审批
         */ function upstream(node) {
          return props.node.deps.includes(node.id) && node.kind === 'approval'
        }
      )
      .map(
        /** 提取评分对象名称。
         * @param node 前置审批
         * @returns 名称
         */ function name(node) {
          return node.label
        }
      )
      .join('、')
  )
  const allSelected = computed(
    () =>
      !!targets.value.length &&
      targets.value.every(
        /** 检查是否已经选择所有当前上游。
         * @param target 合格上游
         * @returns 是否被选中
         */ function included(target) {
          return policy.value.returnNodeIds.includes(target.value)
        }
      )
  )
  /** 更新独立节点规则，不修改其他节点或模板全局开关。
   * @param key 操作规则属性
   * @param value 新配置值
   */
  function update<K extends keyof NodeApprovalPolicy>(key: K, value: NodeApprovalPolicy[K]): void {
    if (!props.disabled) emit('update:modelValue', { ...policy.value, [key]: value })
  }
  /** 快速允许全部当前上游，保存的仍是明确节点列表。
   * @param value 是否选择全部
   */
  function selectAll(value: boolean): void {
    update(
      'returnNodeIds',
      value
        ? targets.value.map(
            /** 收集当前可退回节点标识。
             * @param target 选择项
             * @returns 节点标识
             */ function id(target) {
              return target.value
            }
          )
        : []
    )
  }
</script>
<template>
  <section class="approval-rules">
    <h4>审批操作</h4>
    <div class="rule-switch">
      <span>允许退回修改</span>
      <NSwitch :value="policy.returnEnabled" :disabled="disabled" @update:value="update('returnEnabled', $event)" />
    </div>
    <template v-if="policy.returnEnabled">
      <NFormItem label="退回范围">
        <NSelect
          :value="policy.returnScope"
          :disabled="disabled"
          :options="[
            { label: '上一步', value: 'previous' },
            { label: '指定上游节点', value: 'selected' },
          ]"
          @update:value="update('returnScope', $event)"
        />
      </NFormItem>
      <template v-if="policy.returnScope === 'selected'">
        <div class="rule-switch">
          <span>选择全部合格上游</span>
          <NSwitch :value="allSelected" :disabled="disabled || !targets.length" @update:value="selectAll" />
        </div>
        <NFormItem label="可退回的上游节点" required>
          <NSelect
            :value="policy.returnNodeIds"
            multiple
            filterable
            :disabled="disabled"
            :options="targets"
            placeholder="请选择审批或任务节点"
            @update:value="update('returnNodeIds', $event)"
          />
        </NFormItem>
      </template>
      <div class="rule-switch">
        <span>允许退回发起人修改申请</span>
        <NSwitch :value="policy.returnToApplicant" :disabled="disabled" @update:value="update('returnToApplicant', $event)" />
      </div>
      <p class="help-text">退回节点将重办目标及依赖后续；修改申请内容请退回发起人。首节点没有上一步。</p>
    </template>
    <div class="rule-switch">
      <span>允许终止整个申请</span>
      <NSwitch :value="policy.allowTerminate" :disabled="disabled" @update:value="update('allowTerminate', $event)" />
    </div>
    <NAlert v-if="policy.allowTerminate" type="warning" :bordered="false">任何一位当前办理人均可终止申请，剩余待办取消。</NAlert>
    <h4>上游办理质量评分</h4>
    <template v-if="ratingEnabled">
      <NFormItem label="评分要求">
        <NSelect
          :value="policy.rating"
          :disabled="disabled || !ratingNames"
          :options="[
            { label: '不评分', value: 'off' },
            { label: '选填', value: 'optional' },
            { label: '通过审批时必填', value: 'required' },
          ]"
          @update:value="update('rating', $event)"
        />
      </NFormItem>
      <p class="help-text">{{ ratingNames ? `本节点评分对象：${ratingNames}。采用0～100整数；多人分别评价。` : '没有直接前置审批节点，无需评分。' }}</p>
    </template>
    <NAlert v-else type="info" :bordered="false">请先在“模板设置”开启节点办理质量评分，再配置本节点的评分要求。</NAlert>
  </section>
</template>
<style scoped>
  .approval-rules {
    padding-top: 8px;
    border-top: 1px solid #e8edf5;
    margin-top: 16px;
  }
  h4 {
    margin: 16px 0;
    font-size: 14px;
  }
  .rule-switch {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
    font-size: 13px;
  }
  .help-text {
    line-height: 1.7;
    margin-bottom: 16px;
  }
</style>
