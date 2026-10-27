<script setup lang="tsx">
  import { computed, ref, watch } from 'vue'
  import { NAlert, NButton, NForm, NFormItem, NInput, NPopconfirm, NSelect, NTag, NTabs, NTabPane } from 'naive-ui'
  import type { NodeDefinition } from '@workflow/domain'
  import { defaultApprovalPolicy } from '@workflow/domain'
  import TemplateApprovalRules from './TemplateApprovalRules.vue'
  import type { NodeInspectorProps } from './types'
  import { clone } from '@/composables/format'
  import AssigneeEditor from '@/components/config/AssigneeEditor.vue'
  import ConditionEditor from '@/components/config/ConditionEditor.vue'
  import NodeAccessEditor from '@/components/security/NodeAccessEditor.vue'
  const props = defineProps<NodeInspectorProps>()
  const emit = defineEmits<{ apply: [node: NodeDefinition]; remove: [id: string]; dirty: [value: boolean] }>()
  const editing = ref<NodeDefinition | null>(null)
  const options = computed(() => props.nodes.filter(other).map(option))
  const typeDescription = computed(() =>
    editing.value?.kind === 'approval'
      ? '审批：多人受理时全员通过；退回、终止申请及评分由下方节点规则控制。'
      : editing.value?.kind === 'task'
        ? '任务：受理人提交办理结果，多人全部完成后继续。请为受理人配置任务办理权限。'
        : '知会：到达时点后自动发送通知，不需要确认完成，不阻断后续节点。'
  )
  const dirty = computed(() => JSON.stringify(editing.value) !== JSON.stringify(props.node))
  /**
   * 排除当前节点作为自身前置。
   * @param node 候选节点
   * @returns 是否允许作为前置
   */
  function other(node: NodeDefinition): boolean {
    return node.id !== editing.value?.id
  }
  /**
   * 转换节点下拉选项。
   * @param node 候选节点
   * @returns 下拉项
   */
  function option(node: NodeDefinition) {
    return { label: node.label, value: node.id }
  }
  /** 同步选中节点或撤销恢复后的属性，不直接修改父组件模板。 */
  function sync(): void {
    editing.value = props.node ? clone(props.node) : null
  }
  /** 校验后由父组件应用完整节点，并记录撤销历史。 */
  function apply(): void {
    if (editing.value && !props.disabled) emit('apply', clone(editing.value))
  }
  /**
   * 读取当前未应用属性，在保存、插入或切换节点前由父组件统一校验。
   * @returns 当前编辑节点的独立副本
   */
  function draft(): NodeDefinition | null {
    return editing.value ? clone(editing.value) : null
  }
  /**
   * 将属性未应用状态通知工作台，保护保存和页面退出操作。
   * @param value 是否存在未应用输入
   */
  function notifyDirty(value: boolean): void {
    emit('dirty', value)
  }
  /** 切换节点类型时同步专属操作配置，任务与知会不携带审批权限。
   * @param kind 新节点类型
   */
  function changeKind(kind: NodeDefinition['kind']): void {
    if (!editing.value) return
    editing.value.kind = kind
    if (kind === 'approval') editing.value.approvalPolicy ||= defaultApprovalPolicy()
    else delete editing.value.approvalPolicy
  }
  watch(() => JSON.stringify(props.node), sync, { immediate: true })
  watch(dirty, notifyDirty, { immediate: true })
  defineExpose({ draft })
</script>
<template>
  <aside class="node-inspector">
    <header class="inspector-heading">
      <div>
        <h3>节点属性</h3>
        <p>选中节点的办理规则</p>
      </div>
      <NTag v-if="dirty" size="small" type="warning" :bordered="false">未应用</NTag>
    </header>
    <div class="inspector-fields">
      <NForm v-if="editing" label-placement="top" :disabled="disabled">
        <NTabs type="line" animated>
          <NTabPane name="handling" tab="办理规则">
            <NFormItem label="节点名称" required><NInput v-model:value="editing.label" :maxlength="80" /></NFormItem>
            <NFormItem label="节点类型">
              <NSelect
                :value="editing.kind"
                @update:value="changeKind"
                :disabled="disabled"
                :options="[
                  { label: '审批 · 全员通过', value: 'approval' },
                  { label: '办理任务 · 全员完成', value: 'task' },
                  { label: '知会 · 不阻断', value: 'notice' },
                ]"
              />
            </NFormItem>
            <NFormItem label="前置节点（全部完成才进入）">
              <NSelect v-model:value="editing.deps" multiple clearable filterable :options="options" placeholder="不选表示提交后直接进入" />
            </NFormItem>
            <NAlert type="info" :bordered="false" class="mb">{{ typeDescription }}</NAlert>
            <AssigneeEditor v-model="editing.assignee" :config="config" />
            <ConditionEditor v-model="editing.condition" :fields="config.form.fields" />
            <TemplateApprovalRules
              v-if="editing.kind === 'approval'"
              v-model="editing.approvalPolicy"
              :node="editing"
              :nodes="nodes"
              :rating-enabled="!!ratingEnabled"
              :disabled="disabled"
            />
          </NTabPane>
          <NTabPane name="security" tab="数据权限"><NodeAccessEditor v-model="editing" :config="config" :disabled="disabled" /></NTabPane>
        </NTabs>
      </NForm>
      <p v-else class="help-text">点击画布节点，设置受理人、条件和前置关系。</p>
    </div>
    <footer v-if="editing" class="inspector-actions">
      <p>保存或切换节点前会自动应用当前属性。</p>
      <div class="gap">
        <NButton type="primary" :disabled="disabled || !dirty" @click="apply">应用修改</NButton>
        <NPopconfirm @positive-click="emit('remove', editing.id)">
          <template #trigger><NButton type="error" ghost :disabled="disabled">删除</NButton></template>
          删除后后继节点继承原前置。
        </NPopconfirm>
      </div>
    </footer>
  </aside>
</template>
<style scoped>
  .node-inspector {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid #e2e8f2;
    background: #fff;
    min-width: 0;
  }
  .inspector-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 14px;
    border-bottom: 1px solid #e9edf5;
    flex-shrink: 0;
  }
  .inspector-heading p {
    font-size: 12px;
    color: #7a879b;
    margin: 5px 0 0;
  }
  .inspector-fields {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 18px 20px 4px;
  }
  .inspector-actions {
    padding: 12px 20px 16px;
    border-top: 1px solid #e6ecf4;
    flex-shrink: 0;
    background: #fff;
  }
  .inspector-actions p {
    font-size: 12px;
    color: #7a879b;
    line-height: 1.6;
    margin: 0 0 10px;
  }
  h3 {
    margin: 0;
    font-size: 15px;
  }
  .gap {
    flex-wrap: wrap;
  }
</style>
