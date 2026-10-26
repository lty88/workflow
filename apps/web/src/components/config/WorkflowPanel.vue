<script setup lang="tsx">
  import { computed, nextTick, ref } from 'vue'
  import { useMediaQuery } from '@vueuse/core'
  import { NAlert, NButton, NCard, NDrawer, NDrawerContent, NForm, NFormItem, NInput, NSelect, NTag, NPopconfirm } from 'naive-ui'
  import { topological, instantiateWorkflow, defaultValues } from '@workflow/domain'
  import type { CompanyConfig, NodeDefinition } from '@workflow/domain'
  import type { ConfigPanelProps } from './types'
  import type { WorkflowPreview } from '@/typings/api'
  import { clone, newId } from '@/composables/format'
  import { useFeedback } from '@/composables/use-feedback'
  import AssigneeEditor from './AssigneeEditor.vue'
  import ConditionEditor from './ConditionEditor.vue'
  import NodeAccessEditor from '@/components/security/NodeAccessEditor.vue'
  import BusinessGraph from '@/components/graph/BusinessGraph.vue'
  import { templateGraph, runtimeGraph } from '@/components/graph/models'
  import type { GraphSelection } from '@/components/graph/types'
  const props = defineProps<ConfigPanelProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: CompanyConfig] }>()
  const feedback = useFeedback()
  const mobile = useMediaQuery('(max-width: 850px)')
  const editing = ref<NodeDefinition | null>(null)
  const open = ref(false)
  const preview = ref<WorkflowPreview | null>(null)
  const applicant = ref('u-lin')
  const budget = ref('10000')
  const selectedNode = ref('')
  const workflowGraph = computed(() => templateGraph(props.modelValue))
  const simulatedGraph = computed(() =>
    preview.value
      ? runtimeGraph({
          activity: { nodes: preview.value.nodes, tasks: [] },
          participants: preview.value.participants,
        })
      : null
  )
  /**
   * 选择模板图节点后打开对应的规则编辑抽屉。
   * @param selection 图节点选择
   */
  function selectGraphNode(selection: GraphSelection): void {
    if (selection.kind !== 'workflow') return
    for (const node of props.modelValue.workflow.nodes)
      if (node.id === selection.id) {
        selectedNode.value = node.id
        edit(node)
        return
      }
  }
  /**
   * 清除模板图的高亮选择。
   */
  function clearGraphSelection(): void {
    selectedNode.value = ''
  }
  /**
   * 保存当前节点修改后，按选定位置插入新节点。
   * @param position 插入方向
   */
  async function insertFromEditor(position: 'before' | 'after' | 'parallel'): Promise<void> {
    const anchor = editing.value
    if (!anchor) return
    save()
    if (open.value) return
    await nextTick()
    insert(anchor, position)
  }
  const graph = computed(() => topological(props.modelValue.workflow.nodes))
  const nodes = computed(() => (graph.value.error ? props.modelValue.workflow.nodes : graph.value.order))
  const deps = computed(() => props.modelValue.workflow.nodes.filter(otherNode).map(nodeOption))
  const applicants = computed(() => props.modelValue.users.filter(activeUser).map(memberOption))
  /**
   * 排除自身作为前置节点。
   * @param node 节点
   * @returns 是否候选
   */
  function otherNode(node: NodeDefinition): boolean {
    return node.id !== editing.value?.id
  }
  /**
   * 筛选有效人员。
   * @param user 人员
   * @returns 是否启用
   */
  function activeUser(user: { active: boolean }): boolean {
    return user.active
  }
  /**
   * 转换人员选项。
   * @param user 人员
   * @returns 下拉项
   */
  function memberOption(user: { id: string; name: string }): { label: string; value: string } {
    return { label: user.name, value: user.id }
  }
  /**
   * 转换节点选项。
   * @param node 节点
   * @returns 下拉项
   */
  function nodeOption(node: NodeDefinition): { label: string; value: string } {
    return { label: node.label, value: node.id }
  }
  /**
   * 获取前置节点名称。
   * @param id 节点标识
   * @returns 节点名称
   */
  function nodeName(id: string): string {
    return (
      props.modelValue.workflow.nodes.find(
        /**
         * 按当前目标标识查找配置项或参与人。
         * @param node 当前集合项
         * @returns 是否符合筛选条件
         */ function match(node) {
          return node.id === id
        }
      )?.label || '缺失节点'
    )
  }
  /**
   * 显示受理规则。
   * @param node 节点
   * @returns 规则文本
   */
  function assigneeName(node: NodeDefinition): string {
    if (node.assignee.type === 'manager') return '申请人部门负责人'
    if (node.assignee.type === 'department_manager')
      return (
        (props.modelValue.departments.find(
          /** 匹配指定受理部门。
           * @param department 部门
           * @returns 是否匹配
           */ function matches(department) {
            return department.id === node.assignee.value
          }
        )?.name || '待设置部门') + '负责人'
      )
    const items = node.assignee.type === 'role' ? props.modelValue.roles : props.modelValue.users
    return (
      items.find(
        /**
         * 按当前目标标识查找配置项或参与人。
         * @param item 当前集合项
         * @returns 是否符合筛选条件
         */ function match(item) {
          return item.id === node.assignee.value
        }
      )?.name || '待设置'
    )
  }
  /**
   * 编辑模板节点，变更仅写入配置草案。
   * @param node 已有节点
   */
  function edit(node?: NodeDefinition): void {
    selectedNode.value = node?.id || ''
    editing.value = node ? clone(node) : { id: newId('n'), label: '', kind: 'approval', deps: [], assignee: { type: 'manager', value: '' } }
    open.value = true
  }
  /**
   * 快速在模板前、后或平行加入新节点，并更新汇合依赖。
   * @param anchor 参考节点
   * @param position 位置
   */
  function insert(anchor: NodeDefinition, position: 'before' | 'after' | 'parallel'): void {
    const next = clone(props.modelValue)
    const current = next.workflow.nodes.find(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param node 当前集合项
       * @returns 是否符合筛选条件
       */ function match(node) {
        return node.id === anchor.id
      }
    )!
    const added: NodeDefinition = {
      id: newId('n'),
      label: '新增审核',
      kind: 'approval',
      deps: position === 'after' ? [current.id] : [...current.deps],
      assignee: { type: 'manager', value: '' },
    }
    for (const node of next.workflow.nodes) {
      if (node.id === current.id || !node.deps.includes(current.id)) continue
      if (position === 'after')
        node.deps = node.deps.map(
          /**
           * 用新增节点替换原前置引用。
           * @param id 当前集合项
           * @returns 替换后的节点标识
           */ function replace(id) {
            return id === current.id ? added.id : id
          }
        )
      if (position === 'parallel') node.deps.push(added.id)
    }
    if (position === 'before') current.deps = [added.id]
    next.workflow.nodes.push(added)
    selectedNode.value = added.id
    emit('update:modelValue', next)
    editing.value = clone(added)
    open.value = true
  }
  /**
   * 保存节点并提前检查环路。
   */
  function save(): void {
    if (!editing.value || editing.value.label.trim().length === 0) {
      feedback.failure(new Error('请填写节点名称'))
      return
    }
    const next = clone(props.modelValue)
    const index = next.workflow.nodes.findIndex(matchesEditing)
    if (index < 0) next.workflow.nodes.push(clone(editing.value))
    else next.workflow.nodes[index] = clone(editing.value)
    const result = topological(next.workflow.nodes)
    if (result.error) {
      feedback.failure(new Error(result.error))
      return
    }
    emit('update:modelValue', next)
    open.value = false
  }
  /**
   * 匹配编辑中的节点。
   * @param node 节点
   * @returns 是否同一节点
   */
  function matchesEditing(node: NodeDefinition): boolean {
    return node.id === editing.value?.id
  }
  /**
   * 删除非必要节点，并让其后继继承原前置。
   * @param id 节点标识
   */
  function remove(id: string): void {
    const next = clone(props.modelValue)
    const index = next.workflow.nodes.findIndex(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param node 当前集合项
       * @returns 是否符合筛选条件
       */ function match(node) {
        return node.id === id
      }
    )
    const node = next.workflow.nodes[index]
    if (!node || node.protected) return
    next.workflow.nodes.splice(index, 1)
    for (const child of next.workflow.nodes)
      if (child.deps.includes(id)) {
        const result: string[] = []
        for (const dep of child.deps) result.push(...(dep === id ? node.deps : [dep]))
        child.deps = [...new Set(result)]
      }
    emit('update:modelValue', next)
  }
  /**
   * 用草案规则演算条件路线与受理权限，不创建业务工单。
   */
  function simulate(): void {
    const payload = defaultValues(props.modelValue.form)
    payload.budget = budget.value
    const result = instantiateWorkflow(clone(props.modelValue), payload, applicant.value)
    preview.value = {
      ...result,
      participants: props.modelValue.users.map(
        /**
         * 生成路线演算的参与人显示信息。
         * @param user 当前集合项
         * @returns 人员标识和姓名
         */ function person(user) {
          return { id: user.id, name: user.name }
        }
      ),
    }
  }
</script>
<template>
  <div class="stack">
    <NCard title="流程节点与依赖">
      <template #header-extra><NButton type="primary" size="small" @click="edit()">＋ 新增节点</NButton></template>
      <NAlert type="info" :bordered="false" class="mb">没有前置的节点同时开始；多个前置全部完成后激活。多人审批采用全员通过，任一退回或拒绝将结束本轮。</NAlert>
      <NAlert v-if="graph.error" type="error" class="mb">{{ graph.error }}</NAlert>
      <BusinessGraph
        :model="workflowGraph"
        :selected-key="selectedNode ? 'workflow:' + selectedNode : ''"
        :height="mobile ? 420 : 640"
        label="活动审批模板依赖图"
        class="mb"
        @select="selectGraphNode"
        @clear="clearGraphSelection"
      />
      <div v-for="node in nodes" :key="node.id" class="node-card">
        <div class="spread">
          <div>
            <strong>{{ node.label }}</strong>
            <NTag size="small" :bordered="false" :type="node.protected ? 'warning' : 'info'">
              {{ node.protected ? '必要审核' : { approval: '审批', task: '任务', notice: '知会' }[node.kind] }}
            </NTag>
            <div class="node-meta">{{ assigneeName(node) }}{{ node.condition ? ' · 条件触发' : ' · 始终进入' }}</div>
          </div>
          <div class="gap">
            <NButton size="tiny" @click="insert(node, 'before')">前插</NButton>
            <NButton size="tiny" @click="insert(node, 'after')">后插</NButton>
            <NButton size="tiny" @click="insert(node, 'parallel')">并行</NButton>
            <NButton size="small" text type="primary" @click="edit(node)">编辑</NButton>
            <NPopconfirm v-if="!node.protected" @positive-click="remove(node.id)">
              <template #trigger><NButton size="small" text type="error">删除</NButton></template>
              删除后将继承原节点前置。
            </NPopconfirm>
          </div>
        </div>
        <div class="flow-dependency">
          前置：
          <template v-if="node.deps.length">
            <span v-for="(dep, index) in node.deps" :key="dep">{{ index ? ' ＋ ' : '' }}{{ nodeName(dep) }}</span>
          </template>
          <span v-else>申请提交</span>
          <span v-if="node.condition">· 当 {{ node.condition.field }} {{ node.condition.operator }} {{ node.condition.value }}</span>
        </div>
      </div>
    </NCard>
    <NCard title="路线演算">
      <div class="filters">
        <NSelect v-model:value="applicant" :options="applicants" filterable style="width: 200px" />
        <NInput v-model:value="budget" placeholder="预算总额" style="width: 170px" />
        <NButton @click="simulate">演算草案路线</NButton>
      </div>
      <template v-if="preview">
        <NAlert v-if="preview.errors.length" type="warning" class="mb">
          <div v-for="error in preview.errors" :key="error">{{ error }}</div>
        </NAlert>
        <BusinessGraph v-if="simulatedGraph" :model="simulatedGraph" :height="mobile ? 420 : 560" label="条件分支与实际受理人演算图" class="mb" />
        <div v-for="node in preview.nodes" :key="node.id" class="config-item">
          <div>
            {{ node.label }}
            <small>{{ node.assignees.join('、') || '无受理人' }}</small>
          </div>
          <NTag :bordered="false" :type="node.status === 'skipped' ? 'default' : 'info'">{{ node.status === 'skipped' ? '跳过' : '进入' }}</NTag>
        </div>
      </template>
      <p v-else class="help-text">可切换申请人和预算，检查负责人、角色成员与条件分支。演算使用其他字段的默认值。</p>
    </NCard>
  </div>
  <NDrawer v-model:show="open" :width="mobile ? '100%' : 540">
    <NDrawerContent title="节点配置" closable>
      <NForm v-if="editing" label-placement="top">
        <NFormItem label="节点名称" required><NInput v-model:value="editing.label" :maxlength="80" /></NFormItem>
        <NFormItem label="节点类型">
          <NSelect
            v-model:value="editing.kind"
            :disabled="editing.protected"
            :options="[
              { label: '审批（全员通过）', value: 'approval' },
              { label: '任务（全员完成）', value: 'task' },
              { label: '知会（不阻断流转）', value: 'notice' },
            ]"
          />
        </NFormItem>
        <NFormItem label="前置节点（全部完成后进入）">
          <NSelect v-model:value="editing.deps" :options="deps" multiple clearable placeholder="不选表示提交后直接进入" />
        </NFormItem>
        <AssigneeEditor v-model="editing.assignee" :config="modelValue" />
        <ConditionEditor v-if="!editing.protected" v-model="editing.condition" :fields="modelValue.form.fields" />
        <NAlert v-else type="info">必要审核节点始终进入，不设置跳过条件。</NAlert>
        <NodeAccessEditor v-model="editing" :config="modelValue" />
      </NForm>
      <template #footer>
        <div class="gap">
          <NButton @click="insertFromEditor('before')">保存并前插</NButton>
          <NButton @click="insertFromEditor('after')">保存并后插</NButton>
          <NButton @click="insertFromEditor('parallel')">保存并并行新增</NButton>
          <NButton type="primary" @click="save">应用到草案</NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>
