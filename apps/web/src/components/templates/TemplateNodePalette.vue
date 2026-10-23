<script setup lang="tsx">
  import { WORKFLOW_NODE_THEMES } from '@/components/graph/workflow-node-theme'
  import type { CSSProperties } from 'vue'
  import { computed } from 'vue'
  import { NRadioButton, NRadioGroup, NTooltip } from 'naive-ui'
  import { topological } from '@workflow/domain'
  import type { NodeDefinition } from '@workflow/domain'
  import type { EditorPaletteProps, InsertPosition } from './types'
  const props = defineProps<EditorPaletteProps>()
  const emit = defineEmits<{
    add: [kind: NodeDefinition['kind']]
    select: [id: string]
    position: [value: InsertPosition]
  }>()
  const nodes = computed(() => topological(props.nodes).order)
  const kinds = [
    { value: 'approval' as const, label: '审批', subtitle: '审核意见 · 全员通过', symbol: '✓' },
    { value: 'task' as const, label: '任务', subtitle: '完成事项 · 全员完成', symbol: '▤' },
    { value: 'notice' as const, label: '知会', subtitle: '通知相关人 · 不阻断', symbol: 'i' },
  ]
  /** 让节点库和流程目录沿用画布中的同一套类型颜色。
   * @param kind 审批、任务或知会类型
   * @returns 节点卡片使用的颜色变量
   */
  function kindStyle(kind: NodeDefinition['kind']): CSSProperties {
    const theme = WORKFLOW_NODE_THEMES[kind]
    return { '--node-kind-fill': theme.fill, '--node-kind-accent': theme.accent }
  }
  /**
   * 从节点卡片拖出类型，让画布根据当前接入位置插入。
   * @param event 原生拖动事件
   * @param kind 节点类型
   */
  function dragStart(event: DragEvent, kind: NodeDefinition['kind']): void {
    if (props.disabled) {
      event.preventDefault()
      return
    }
    event.dataTransfer?.setData('application/workflow-node', kind)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }
  /**
   * 接受节点库选择的位置，仅传递有效的接入方向。
   * @param value 单选控件值
   */
  function changePosition(value: string | number | boolean): void {
    if (value === 'before' || value === 'after' || value === 'parallel') emit('position', value)
  }
</script>
<template>
  <aside class="node-palette" :class="{ 'is-collapsed': collapsed }" aria-label="节点库与流程目录">
    <div class="palette-top">
      <h3>{{ collapsed ? '添加' : '添加节点' }}</h3>
      <p v-if="!collapsed">拖到画布，或点击直接添加</p>
    </div>
    <div class="node-kinds">
      <NTooltip v-for="kind in kinds" :key="kind.value" placement="right">
        <template #trigger>
          <button
            type="button"
            class="node-kind"
            :class="kind.value"
            :style="kindStyle(kind.value)"
            :disabled="disabled || !selected || selected === 'stage:approved'"
            :draggable="!disabled && selected !== 'stage:approved'"
            @dragstart="dragStart($event, kind.value)"
            @click="emit('add', kind.value)"
          >
            <span class="kind-symbol">{{ kind.symbol }}</span>
            <span>
              <strong>
                {{ kind.label }}
                <template v-if="!collapsed">节点</template>
              </strong>
              <small v-if="!collapsed">{{ kind.subtitle }}</small>
            </span>
            <span v-if="!collapsed" class="kind-plus">＋</span>
          </button>
        </template>
        {{ kind.subtitle }}，加入{{ selected === 'stage:apply' ? '开始节点之后' : '所选节点'
        }}{{ selected === 'stage:apply' ? '' : { before: '之前', after: '之后', parallel: '并行分支' }[position] }}
      </NTooltip>
    </div>
    <div v-if="!collapsed && !selected.startsWith('stage:')" class="insert-position">
      <span>相对所选节点的位置</span>
      <NRadioGroup :value="position" size="small" :disabled="disabled" @update:value="changePosition">
        <NRadioButton value="before">前插</NRadioButton>
        <NRadioButton value="after">后插</NRadioButton>
        <NRadioButton value="parallel">并行</NRadioButton>
      </NRadioGroup>
    </div>
    <div v-if="!collapsed" class="node-outline">
      <div class="outline-title">
        <h3>流程目录</h3>
        <span>{{ nodes.length }}</span>
      </div>
      <button
        v-for="(node, index) in nodes"
        :key="node.id"
        type="button"
        class="outline-node"
        :class="{ selected: node.id === selected }"
        :style="kindStyle(node.kind)"
        :aria-current="node.id === selected ? 'step' : undefined"
        @click="emit('select', node.id)"
      >
        <span class="outline-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <strong :title="node.label">{{ node.label }}</strong>
      </button>
    </div>
  </aside>
</template>
<style scoped>
  .node-palette {
    height: 100%;
    min-height: 0;
    overflow: auto;
    background: #fff;
    border-right: 1px solid #e3e9f3;
    padding: 18px 14px;
  }
  .palette-top h3,
  .outline-title h3 {
    margin: 0;
    font-size: 14px;
  }
  .palette-top p {
    font-size: 12px;
    line-height: 1.6;
    color: #718098;
    margin: 8px 0 16px;
  }
  .node-kinds {
    display: grid;
    gap: 10px;
  }
  .node-kind {
    display: flex;
    align-items: center;
    gap: 9px;
    text-align: left;
    padding: 12px 10px;
    border: 1px solid #e3e9f3;
    border-radius: 9px;
    background: #fff;
    color: #2d3e58;
    width: 100%;
    cursor: grab;
  }
  .node-kind:hover {
    border-color: #8eaff9;
    background: #f7faff;
  }
  .node-kind:focus-visible,
  .outline-node:focus-visible {
    outline: 3px solid #8caff7;
    outline-offset: 2px;
  }
  .node-kind:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .kind-symbol {
    display: grid;
    place-items: center;
    width: 28px;
    height: 30px;
    flex-shrink: 0;
    border-radius: 7px;
    background: var(--node-kind-fill);
    color: var(--node-kind-accent);
    font-size: 17px;
  }
  .node-kind > span:nth-child(2) {
    min-width: 0;
    flex: 1;
  }
  .node-kind strong {
    display: block;
    font-size: 13px;
    font-weight: 600;
  }
  .node-kind small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: #77859a;
    white-space: nowrap;
    margin-top: 3px;
  }
  .kind-plus {
    margin-left: auto;
    color: #7b8a9e;
    font-size: 17px;
  }
  .insert-position {
    border-top: 1px solid #edf0f6;
    margin-top: 20px;
    padding-top: 18px;
  }
  .insert-position > span {
    font-size: 12px;
    color: #77859a;
    display: block;
    margin-bottom: 10px;
  }
  .insert-position :deep(.n-radio-button) {
    padding: 0 10px;
  }
  .node-outline {
    margin-top: 24px;
    border-top: 1px solid #edf0f6;
    padding-top: 18px;
  }
  .outline-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .outline-title > span {
    font-size: 12px;
    color: #7c8aa0;
  }
  .outline-node {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    border: none;
    background: transparent;
    padding: 10px 8px;
    border-radius: 7px;
    color: #5e6f89;
    text-align: left;
  }
  .outline-node:hover {
    background: #f4f7fd;
  }
  .outline-node.selected {
    color: #285bd7;
    background: #edf3ff;
  }
  .outline-index {
    display: grid;
    place-items: center;
    min-width: 24px;
    height: 24px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--node-kind-accent);
    background: var(--node-kind-fill);
  }
  .outline-node strong {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .is-collapsed {
    padding: 16px 8px;
  }
  .is-collapsed .palette-top h3 {
    text-align: center;
    margin-bottom: 14px;
    font-size: 12px;
    color: #7a879c;
  }
  .is-collapsed .node-kind {
    padding: 10px 3px;
    flex-direction: column;
    gap: 6px;
  }
  .is-collapsed .node-kind > span:nth-child(2) {
    min-width: 0;
    flex: 1;
  }
  .node-kind strong {
    font-size: 12px;
  }
</style>
