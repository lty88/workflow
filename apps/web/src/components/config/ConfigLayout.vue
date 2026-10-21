<script setup lang="tsx">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { NAlert, NButton, NCard, NPopconfirm, NSpin, NTag } from 'naive-ui';
import { validateConfig } from '@workflow/domain';
import type { ConfigSlot } from './types';
import { useConfigStore } from '../../stores/config';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/use-feedback';
const store = useConfigStore();
const auth = useAuthStore();
const feedback = useFeedback();
const route = useRoute();
const errorText = ref('');
defineSlots<{ default(props: ConfigSlot): unknown }>();
const validation = computed(() => (store.draft ? validateConfig(store.draft) : []));
const tabs = [
  { path: '/settings', name: '配置概览' },
  { path: '/settings/forms', name: '动态表单' },
  { path: '/settings/workflow', name: '动态流程' },
  { path: '/settings/organization', name: '组织架构' },
  { path: '/settings/permissions', name: '角色权限' },
  { path: '/settings/menus', name: '菜单页面' },
];
/**
 * 读取配置；跨配置页切换时保留同一份未保存草案。
 */
async function load(): Promise<void> {
  try {
    await store.load();
    errorText.value = '';
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '加载失败';
    feedback.failure(error);
  }
}
/**
 * 初次进入配置中心时读取草案。
 */
async function initialize(): Promise<void> {
  if (!store.state) await load();
}
/**
 * 保存草案但不影响业务运行。
 */
async function save(): Promise<void> {
  if (!auth.can('config:manage')) return;
  try {
    await store.save();
    feedback.success('草案已保存，发布后生效');
  } catch (error) {
    feedback.failure(error);
  }
}
/**
 * 校验并发布草案，再刷新当前身份与动态菜单。
 */
async function publish(): Promise<void> {
  if (!auth.can('config:manage')) return;
  try {
    await store.publish();
    await auth.restore();
    feedback.success('配置已发布');
  } catch (error) {
    feedback.failure(error);
  }
}
onMounted(initialize);
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <span class="eyebrow">CONFIGURATION CENTER</span>
        <h1>配置中心</h1>
        <p>统一维护表单、流程、组织与授权。新申请使用发布版本，在途实例保留快照。</p>
      </div>
      <div class="gap">
        <NTag type="info" :bordered="false">已发布 V{{ store.state?.published.version || '—' }}</NTag
        ><NTag v-if="store.dirty" type="warning" :bordered="false">本地未保存</NTag
        ><NTag v-else-if="store.unpublished" type="warning" :bordered="false">草案待发布</NTag>
      </div>
    </div>
    <nav class="config-tabs">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        :class="{ 'router-link-exact-active': route.path === tab.path }"
        >{{ tab.name }}</RouterLink
      >
    </nav>
    <NAlert v-if="errorText" type="error" class="mb"
      >{{ errorText }} <NButton text @click="load">重试</NButton></NAlert
    ><NSpin :show="store.busy"
      ><template v-if="store.draft"
        ><NAlert v-if="validation.length" type="warning" title="发布前需解决的配置问题" class="mb"
          ><div v-for="error in validation" :key="error">{{ error }}</div></NAlert
        ><slot :config="store.draft" :update="store.update" />
        <div class="sticky-actions">
          <span class="help-text"
            >草案版本 R{{ store.state?.draftRevision }} · 发布前将校验引用、必要审核及管理员资格</span
          >
          <div class="gap">
            <NPopconfirm @positive-click="load"
              ><template #trigger><NButton :disabled="store.busy">重新读取</NButton></template
              >重新读取会丢弃本地未保存修改，是否继续？</NPopconfirm
            ><NButton :loading="store.busy" @click="save">保存草案</NButton
            ><NPopconfirm @positive-click="publish"
              ><template #trigger
                ><NButton
                  type="primary"
                  :disabled="store.busy || !!validation.length || !store.unpublished"
                  :loading="store.busy"
                  >发布配置</NButton
                ></template
              >发布后新申请、菜单及当前权限立即使用新配置。确认发布？</NPopconfirm
            >
          </div>
        </div></template
      ><NCard v-else-if="!store.busy">暂未读取到配置，请确认数据库已初始化。</NCard></NSpin
    >
  </div>
</template>
