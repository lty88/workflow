<script setup lang="tsx">
import { computed, nextTick, ref, watch } from 'vue';
import { useElementBounding, useEventListener, useMediaQuery, useWindowSize } from '@vueuse/core';
import { NAlert, NDrawer, NDrawerContent } from 'naive-ui';
import { findById, topological } from '@workflow/domain';
import type { NodeDefinition, TemplateDefinition, TemplateLayout } from '@workflow/domain';
import type { GraphConnection, InsertPosition, NodeInspectorHandle, TemplateDesignerProps } from './types';
import type { GraphDirection } from '@/components/graph/types';
import { clone } from '@/composables/format';
import { useFeedback } from '@/composables/use-feedback';
import { useGraphExpansion } from '@/components/graph/use-graph-expansion';
import { changeConnection, insertNode, removeNode } from './editing';
import TemplateEditorHeader from './TemplateEditorHeader.vue';
import TemplateNodePalette from './TemplateNodePalette.vue';
import TemplateSettingsPanel from './TemplateSettingsPanel.vue';
import TemplateCanvas from './TemplateCanvas.vue';
import TemplateNodeInspector from './TemplateNodeInspector.vue';
import TemplateSimulation from './TemplateSimulation.vue';
const props = defineProps<TemplateDesignerProps>();
const emit = defineEmits<{
  'update:modelValue': [value: TemplateDefinition];
  save: [];
  publish: [];
  validate: [];
  back: [];
  discard: [];
  pending: [value: boolean];
}>();
const feedback = useFeedback();
const root = ref<HTMLElement | null>(null);
const inspector = ref<NodeInspectorHandle | null>(null);
const { expanded, placeholderHeight, toggleExpanded } = useGraphExpansion(root);
const { top } = useElementBounding(root);
const { height: windowHeight } = useWindowSize();
const mobile = useMediaQuery('(max-width: 850px)');
const compact = useMediaQuery('(max-width: 1450px)');
const paletteOverride = ref<boolean | null>(null);
const inspectorOpen = ref(true);
const settingsOpen = ref(false);
const simulationOpen = ref(false);
const inspectorDirty = ref(false);
const position = ref<InsertPosition>('after');
const selected = ref(props.modelValue.nodes[0]?.id || '');
const past = ref<TemplateDefinition[]>([]);
const future = ref<TemplateDefinition[]>([]);
const selectedNode = computed(() => findById(props.modelValue.nodes, selected.value) || null);
const paletteOpen = computed(() => paletteOverride.value ?? (expanded.value || !compact.value));
const disabled = computed(() => props.busy || mobile.value);
const frameHeight = computed(() =>
  expanded.value
    ? '100dvh'
    : Math.max(560, Math.min(960, windowHeight.value - Math.max(100, top.value) - 20)) + 'px',
);
/**
 * 记录有限撤销历史并更新模板定义，不修改已有活动的流程快照。
 * @param value 新草稿定义
 */
function apply(value: TemplateDefinition): void {
  if (disabled.value || JSON.stringify(value) === JSON.stringify(props.modelValue)) return;
  past.value.push(clone(props.modelValue));
  if (past.value.length > 40) past.value.shift();
  future.value = [];
  emit('update:modelValue', value);
}
/**
 * 校验并应用属性表单，拒绝无效名称、环路及必要审核降级。
 * @param node 编辑后的节点
 * @returns 是否成功应用属性
 */
function applyNode(node: NodeDefinition): boolean {
  if (disabled.value) return false;
  const next = clone(props.modelValue);
  let index = -1;
  for (let i = 0; i < next.nodes.length; i++) if (next.nodes[i]!.id === node.id) index = i;
  if (index < 0) return false;
  if (node.label.trim().length < 2) {
    feedback.failure(new Error('节点名称至少2字，请先修正右侧属性'));
    inspectorOpen.value = true;
    return false;
  }
  const previous = next.nodes[index]!;
  if (
    previous.protected &&
    (node.kind !== 'approval' ||
      !node.protected ||
      node.condition ||
      node.assignee.type !== previous.assignee.type ||
      node.assignee.value !== previous.assignee.value)
  ) {
    feedback.failure(new Error('必须保留必要审核及受理规则'));
    inspectorOpen.value = true;
    return false;
  }
  next.nodes[index] = clone(node);
  const checked = topological(next.nodes);
  if (checked.error) {
    feedback.failure(new Error(checked.error));
    inspectorOpen.value = true;
    return false;
  }
  apply(next);
  return true;
}
/**
 * 将尚未应用的属性先写入模板，等待父组件回传后再继续下一步。
 * @returns 属性有效且可以继续操作时为真
 */
async function flushNode(): Promise<boolean> {
  if (!inspectorDirty.value) return true;
  const draft = inspector.value?.draft();
  if (!draft || !applyNode(draft)) return false;
  await nextTick();
  return true;
}
/**
 * 切换参考节点并展开属性，保留原节点尚未应用的有效输入。
 * @param id 目标节点标识
 */
async function selectNode(id: string): Promise<void> {
  if (props.busy || !(await flushNode())) return;
  selected.value = id;
  inspectorOpen.value = true;
}
/**
 * 在选中节点周围新增审批、任务或知会，并将新节点定位到可编辑状态。
 * @param kind 新节点类型
 * @param placement 接入方向，默认使用节点库当前选择
 */
async function insert(
  kind: NodeDefinition['kind'],
  placement: InsertPosition = position.value,
): Promise<void> {
  if (disabled.value || !(await flushNode())) return;
  try {
    position.value = placement;
    const result = insertNode(props.modelValue, selected.value, kind, placement);
    apply({ ...result.definition, layout: { ...result.definition.layout, positions: {} } });
    selected.value = result.id;
    inspectorOpen.value = true;
  } catch (error) {
    feedback.failure(error);
  }
}
/**
 * 删除可选节点并保留后续可达性，明确删除时丢弃该节点的待应用输入。
 * @param id 节点标识
 */
function remove(id: string): void {
  if (disabled.value) return;
  try {
    const next = removeNode(props.modelValue, id);
    apply(next);
    selected.value = next.nodes[0]?.id || '';
  } catch (error) {
    feedback.failure(error);
  }
}
/**
 * 应用或删除自由连线，先合并当前节点属性，再校验环路与重复边。
 * @param connection 连线端点
 * @param removing 是否删除依赖
 */
async function updateConnection(connection: GraphConnection, removing = false): Promise<void> {
  if (disabled.value || !(await flushNode())) return;
  try {
    apply(changeConnection(props.modelValue, connection, removing));
  } catch (error) {
    feedback.failure(error);
  }
}
/**
 * 保存拖动坐标，保持节点定义引用稳定，避免清除属性输入。
 * @param value 节点坐标
 */
function positions(value: TemplateLayout['positions']): void {
  apply({ ...props.modelValue, layout: { ...props.modelValue.layout, positions: value } });
}
/** 清除手工坐标，按当前依赖自动排列，支持撤销。 */
function arrange(): void {
  apply({ ...props.modelValue, layout: { ...props.modelValue.layout, positions: {} } });
}
/**
 * 切换并保存模板布局方向，清除旧方向的手动坐标。
 * @param value 纵向或横向方向
 */
function direction(value: GraphDirection): void {
  if (value !== props.modelValue.layout.direction)
    apply({ ...props.modelValue, layout: { direction: value, positions: {} } });
}
/** 撤销最近修改；尚未应用的属性先进入历史再撤销，保持操作可恢复。 */
async function undo(): Promise<void> {
  if (disabled.value || !(await flushNode()) || !past.value.length) return;
  future.value.push(clone(props.modelValue));
  emit('update:modelValue', past.value.pop()!);
}
/** 重做上次撤销，存在待应用属性时由用户先应用或撤销输入。 */
function redo(): void {
  if (disabled.value || inspectorDirty.value || !future.value.length) return;
  past.value.push(clone(props.modelValue));
  emit('update:modelValue', future.value.pop()!);
}
/**
 * 保存、发布或校验前统一应用属性，避免只保存画布旧值。
 * @param command 工作台命令
 */
async function requestCommand(command: 'save' | 'publish' | 'validate'): Promise<void> {
  if (disabled.value || !(await flushNode())) return;
  if (command === 'save') emit('save');
  else if (command === 'publish') emit('publish');
  else emit('validate');
}
/** 打开路线演算前合并当前有效属性，确保使用最新草稿。 */
async function openSimulation(): Promise<void> {
  if (!props.busy && (await flushNode())) simulationOpen.value = true;
}
/** 切换节点库展示宽度，保留用户选择并为画布释放空间。 */
function togglePalette(): void {
  paletteOverride.value = !paletteOpen.value;
}
/**
 * 通知外层页面保护尚未应用的属性，避免切换路由时丢失输入。
 * @param value 属性是否尚未应用
 */
function notifyPending(value: boolean): void {
  emit('pending', value);
}
/**
 * 输入框保持原生撤销，画布区域支持保存、撤销和重做快捷键。
 * @param event 工作台键盘事件
 */
function keyboard(event: KeyboardEvent): void {
  if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault();
    void requestCommand('save');
    return;
  }
  if (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable="true"]'))
    return;
  if (key === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else void undo();
  }
}
/** 节点因撤销被移除时回到首个节点，保持画布与属性面板一致。 */
function ensureSelection(): void {
  if (!findById(props.modelValue.nodes, selected.value)) selected.value = props.modelValue.nodes[0]?.id || '';
}
watch(inspectorDirty, notifyPending);
watch(() => props.modelValue.nodes, ensureSelection);
useEventListener(root, 'keydown', keyboard);
</script>
<template>
  <div
    class="designer-placeholder"
    :style="expanded && placeholderHeight ? { height: placeholderHeight + 'px' } : undefined"
  >
    <Teleport to="body" :disabled="!expanded">
      <section
        ref="root"
        class="template-designer"
        :class="{
          'is-expanded': expanded,
          'palette-collapsed': !paletteOpen,
          'inspector-collapsed': !inspectorOpen,
        }"
        :style="{ height: frameHeight }"
        aria-label="流程模板编辑工作台"
      >
        <TemplateEditorHeader
          :name="modelValue.name"
          :code="template.code"
          :version="template.currentVersion"
          :revision="template.draftRevision"
          :dirty="dirty || inspectorDirty"
          :busy="busy"
          :readonly="mobile"
          :expanded="expanded"
          :can-undo="!!past.length || inspectorDirty"
          :can-redo="!!future.length && !inspectorDirty"
          :palette-open="paletteOpen"
          :inspector-open="inspectorOpen"
          @back="emit('back')"
          @discard="emit('discard')"
          @undo="undo"
          @redo="redo"
          @validate="requestCommand('validate')"
          @save="requestCommand('save')"
          @publish="requestCommand('publish')"
          @expand="toggleExpanded"
          @settings="settingsOpen = true"
          @simulate="openSimulation"
          @palette="togglePalette"
          @inspector="inspectorOpen = !inspectorOpen"
        />
        <NAlert v-if="mobile" type="info" :bordered="false"
          >手机端可查看流程；节点编排、编辑和发布请在PC端完成。</NAlert
        >
        <NAlert
          v-if="errors?.length"
          type="warning"
          :bordered="false"
          title="请修正流程后再发布"
          class="designer-errors"
          ><div v-for="error in errors" :key="error">{{ error }}</div></NAlert
        >
        <div class="designer-columns">
          <TemplateNodePalette
            :nodes="modelValue.nodes"
            :selected="selected"
            :position="position"
            :collapsed="!paletteOpen"
            :disabled="disabled"
            @add="insert"
            @select="selectNode"
            @position="position = $event"
          />
          <TemplateCanvas
            :definition="modelValue"
            :config="config"
            :selected="selected"
            :position="position"
            :disabled="disabled"
            @select="selectNode"
            @insert="insert"
            @positions="positions"
            @connect="updateConnection"
            @disconnect="updateConnection($event, true)"
            @arrange="arrange"
            @direction="direction"
          />
          <TemplateNodeInspector
            v-show="inspectorOpen"
            ref="inspector"
            :node="selectedNode"
            :nodes="modelValue.nodes"
            :config="config"
            :disabled="disabled"
            @apply="applyNode"
            @remove="remove"
            @dirty="inspectorDirty = $event"
          />
        </div>
      </section>
    </Teleport>
    <NDrawer
      v-model:show="settingsOpen"
      :width="480"
      :z-index="2100"
      style="max-width: 100vw"
      display-directive="show"
      ><NDrawerContent title="模板设置" closable
        ><TemplateSettingsPanel
          :model-value="modelValue"
          :config="config"
          :types="types"
          :disabled="disabled"
          @update:model-value="apply"
        /><template #footer
          ><span class="drawer-hint">设置即时进入草稿，关闭面板后统一保存或发布。</span></template
        ></NDrawerContent
      ></NDrawer
    >
    <NDrawer
      v-model:show="simulationOpen"
      :width="680"
      :z-index="2100"
      style="max-width: 100vw"
      display-directive="show"
      ><NDrawerContent title="路线演算" closable
        ><TemplateSimulation
          :template-id="template.id"
          :definition="modelValue"
          :config="config"
          :disabled="busy" /></NDrawerContent
    ></NDrawer>
  </div>
</template>
<style scoped src="./template-designer.css"></style>
