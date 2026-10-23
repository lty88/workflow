<script setup lang="tsx">
  import { NButton, NPopconfirm, NTooltip } from 'naive-ui'
  import type { EditorHeaderProps } from './types'
  defineProps<EditorHeaderProps>()
  const emit = defineEmits<{
    back: []
    discard: []
    undo: []
    redo: []
    validate: []
    save: []
    publish: []
    expand: []
    settings: []
    simulate: []
    palette: []
    inspector: []
  }>()
</script>
<template>
  <header class="editor-header">
    <div class="editor-identity">
      <NPopconfirm v-if="dirty" @positive-click="emit('discard')">
        <template #trigger><NButton quaternary :disabled="busy" aria-label="返回模板库">←</NButton></template>
        丢弃尚未保存的修改并返回模板库？
      </NPopconfirm>
      <NButton v-else quaternary :disabled="busy" aria-label="返回模板库" @click="emit('back')">←</NButton>
      <div>
        <h2 :title="name + ' · ' + code">{{ name }}</h2>
        <div class="editor-meta">
          <span>{{ version ? '已发布 V' + version : '尚未发布' }} · 草稿 R{{ revision }}</span>
          <span class="save-state" :class="{ 'is-dirty': dirty }">{{ dirty ? '● 有未保存修改' : '● 已保存修改' }}</span>
        </div>
      </div>
    </div>
    <div class="editor-actions">
      <div class="history-actions">
        <NTooltip>
          <template #trigger><NButton quaternary :disabled="busy || readonly || !canUndo" @click="emit('undo')">撤销</NButton></template>
          画布操作支持 Ctrl / ⌘ Z
        </NTooltip>
        <NButton quaternary :disabled="busy || readonly || !canRedo" @click="emit('redo')">重做</NButton>
      </div>
      <NButton quaternary :disabled="busy" @click="emit('settings')">模板设置</NButton>
      <NButton quaternary :disabled="busy" @click="emit('simulate')">路线演算</NButton>
      <NButton :disabled="busy || readonly" @click="emit('validate')">检查流程</NButton>
      <NButton :loading="busy" :disabled="readonly" @click="emit('save')">保存修改</NButton>
      <NPopconfirm @positive-click="emit('publish')">
        <template #trigger><NButton type="primary" :disabled="busy || readonly">启用版本</NButton></template>
        保存并启用新版本，已提交活动继续按原版本运行。
      </NPopconfirm>
      <NButton data-graph-expand :aria-expanded="expanded" @click="emit('expand')">{{ expanded ? '退出全屏 · Esc' : '⛶ 全屏编辑' }}</NButton>
    </div>
    <nav class="panel-switches" aria-label="工作台面板">
      <NButton size="small" quaternary :type="paletteOpen ? 'primary' : 'default'" :aria-pressed="paletteOpen" @click="emit('palette')">
        {{ paletteOpen ? '收起' : '展开' }}节点库
      </NButton>
      <span>编辑审批流程 · 拖动空白平移，点击节点配置</span>
      <NButton size="small" quaternary :type="inspectorOpen ? 'primary' : 'default'" :aria-pressed="inspectorOpen" @click="emit('inspector')">
        {{ inspectorOpen ? '收起' : '展开' }}属性面板
      </NButton>
    </nav>
  </header>
</template>
<style scoped>
  .editor-header {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    padding: 16px 20px 0;
    background: #fff;
    border-bottom: 1px solid #e3e9f3;
    flex-shrink: 0;
  }
  .editor-identity {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 220px;
    flex: 1;
  }
  .editor-identity h2 {
    font-size: 18px;
    line-height: 1.5;
    margin: 0 0 4px;
    max-width: 330px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 12px;
    color: #65758d;
  }
  .save-state {
    color: #45836d;
  }
  .save-state.is-dirty {
    color: #ad6d13;
  }
  .editor-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .history-actions {
    display: flex;
    border-right: 1px solid #e2e8f2;
    padding-right: 8px;
  }
  .panel-switches {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 0;
    margin-top: 0;
  }
  .panel-switches > span {
    flex: 1;
    font-size: 12px;
    color: #748198;
  }
  .panel-switches > .n-button:last-child {
    margin-left: auto;
  }
  @media (max-width: 1100px) {
    .editor-header {
      padding: 12px 14px 0;
    }
    .editor-identity h2 {
      max-width: 260px;
    }
    .editor-actions {
      gap: 6px;
    }
  }
  @media (max-width: 850px) {
    .history-actions {
      display: none;
    }
    .panel-switches > span {
      display: none;
    }
    .editor-identity {
      min-width: 150px;
    }
  }
</style>
