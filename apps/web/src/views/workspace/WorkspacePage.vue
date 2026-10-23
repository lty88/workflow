<script setup lang="tsx">
import { computed } from 'vue';
import { NAlert, NButton, NSpin } from 'naive-ui';
import type { WorkspacePageProps } from './types';
import { useWorkspacePage } from './use-workspace-page';
import { resolveWorkspaceView, workspaceViewProps } from './view-registry';

const props = defineProps<WorkspacePageProps>();
const { page, busy, errorText, load } = useWorkspacePage(computed(() => props.pageKey));
const currentView = computed(() => (page.value ? resolveWorkspaceView(page.value.component) : undefined));
const currentProps = computed(() => (page.value ? workspaceViewProps(page.value) : {}));
</script>
<template>
  <NSpin :show="busy">
    <NAlert v-if="errorText" type="error" :title="errorText">
      <NButton text @click="load">重新加载</NButton>
    </NAlert>
    <component v-else-if="currentView && page" :is="currentView" :key="page.id" v-bind="currentProps" />
    <NAlert v-else-if="page" type="warning" title="该页面类型尚未提供实现，请联系管理员检查菜单配置。" />
  </NSpin>
</template>
