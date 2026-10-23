<script setup lang="tsx">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, RouterLink, RouterView } from 'vue-router';
import { useMediaQuery } from '@vueuse/core';
import { NButton, NDrawer, NDrawerContent, NBadge, NEmpty, NTag, NSpin } from 'naive-ui';
import { notificationsApi, readNotificationApi } from '@/api/notifications';
import type { Notification } from '@/typings/api';
import type { PageDefinition } from '@workflow/domain';
import {
  APP_PATHS,
  activityDestination,
  workspaceNavigation,
  menuDestination,
  isMenuActive,
  isModulePath,
  navigationTitle,
} from '@/navigation';
import { useAuthStore } from '@/stores/auth';
import { useConfigStore } from '@/stores/config';
import { useFeedback } from '@/composables/use-feedback';
import { formatTime } from '@/composables/format';
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const configuration = useConfigStore();
const feedback = useFeedback();
const mobile = useMediaQuery('(max-width: 850px)');
const menuOpen = ref(false);
const messagesOpen = ref(false);
const messages = ref<Notification[]>([]);
const loading = ref(false);
const unread = computed(() => messages.value.filter(isUnread).length);
const navigationMenus = computed(() => workspaceNavigation(auth.profile?.menus || []));
const configurationFallback = computed(
  () => auth.can('config:manage') && !navigationMenus.value.some(isConfigurationPage),
);
const title = computed(() => navigationTitle(route.path, navigationMenus.value));
/**
 * 判断站内消息是否未读。
 * @param item 消息
 * @returns 是否未读
 */
function isUnread(item: Notification): boolean {
  return !item.readAt;
}
/**
 * 匹配当前动态菜单。
 * @param item 页面
 * @returns 是否当前页
 */
function matchesPage(item: PageDefinition): boolean {
  return isMenuActive(item, route.path);
}
/**
 * 识别已有的配置中心导航，防止再次追加固定入口。
 * @param page 当前授权菜单
 * @returns 是否配置中心
 */
function isConfigurationPage(page: PageDefinition): boolean {
  return page.component === 'config_overview';
}
/**
 * 判断分组是否包含可见页面。
 * @param id 分组
 * @returns 是否可见
 */
function groupVisible(id: string): boolean {
  return navigationMenus.value.some(
    /**
     * 筛选当前导航分组下的授权页面。
     * @param page 当前集合项
     * @returns 是否符合筛选条件
     */ function inGroup(page) {
      return page.group === id;
    },
  );
}
/**
 * 页面切换时关闭移动导航。
 */
function closeMenu(): void {
  menuOpen.value = false;
}
watch(() => route.fullPath, closeMenu);
/**
 * 查询本人站内消息并打开消息抽屉。
 */
async function openMessages(): Promise<void> {
  messagesOpen.value = true;
  loading.value = true;
  try {
    messages.value = await notificationsApi();
  } catch (error) {
    feedback.failure(error);
  } finally {
    loading.value = false;
  }
}
/**
 * 标记消息并前往对应工单。
 * @param item 消息
 */
async function openMessage(item: Notification): Promise<void> {
  try {
    await readNotificationApi(item.id);
    item.readAt = new Date().toISOString();
    messagesOpen.value = false;
    await router.push(activityDestination(item.activityId));
  } catch (error) {
    feedback.failure(error);
  }
}
/**
 * 撤销服务端会话并清理配置资料。
 */
async function signOut(): Promise<void> {
  try {
    await auth.signOut();
    configuration.reset();
    await router.replace(APP_PATHS.login);
  } catch (error) {
    feedback.failure(error);
  }
}
</script>
<template>
  <RouterView v-if="route.path === APP_PATHS.login" />
  <div v-else class="app-shell">
    <aside v-if="!mobile" class="sidebar">
      <RouterLink :to="APP_PATHS.home" class="brand"
        ><span class="brand-symbol">流</span
        ><span>活动流程<span class="brand-sub">WORKFLOW · ERP</span></span></RouterLink
      >
      <nav class="navigation">
        <template v-for="group in auth.profile?.groups" :key="group.id"
          ><template v-if="group.active && groupVisible(group.id)"
            ><div class="nav-group">{{ group.name }}</div>
            <template v-for="page in navigationMenus" :key="page.id"
              ><RouterLink
                v-if="page.group === group.id"
                :to="menuDestination(page)"
                class="nav-item"
                :class="{ selected: matchesPage(page) }"
                ><span class="nav-dot" />{{ page.name }}</RouterLink
              ></template
            ></template
          ></template
        ><template v-if="configurationFallback"
          ><div class="nav-group">系统管理</div>
          <RouterLink
            :to="APP_PATHS.settings"
            class="nav-item"
            :class="{ selected: isModulePath(route.path, APP_PATHS.settings) }"
            ><span class="nav-dot" />配置中心</RouterLink
          ></template
        >
      </nav>
      <div class="sidebar-footer">
        <NTag size="small" :bordered="false" type="info">企业内部协同</NTag
        ><span>配置版本 V{{ auth.profile?.configVersion }}</span>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="topbar-title">
          <NButton v-if="mobile" quaternary @click="menuOpen = true">☰</NButton
          ><span class="muted desktop-only">活动流程 /</span> {{ title }}
        </div>
        <div class="topbar-actions">
          <NBadge :value="unread" :max="99"><NButton quaternary @click="openMessages">消息</NButton></NBadge
          ><RouterLink :to="APP_PATHS.account" class="account"
            ><span class="avatar">{{ auth.profile?.user.name.slice(0, 1) }}</span
            ><span class="desktop-only">{{ auth.profile?.user.name }}</span></RouterLink
          ><NButton quaternary size="small" @click="signOut">退出</NButton>
        </div>
      </header>
      <main class="main-content"><RouterView :key="route.path" /></main>
      <footer class="page-footer">活动流程 · 让每一次协作有迹可循</footer>
    </div>
  </div>
  <NDrawer v-model:show="menuOpen" placement="left" :width="280"
    ><NDrawerContent title="活动流程" closable
      ><nav class="mobile-nav">
        <RouterLink v-for="page in navigationMenus" :key="page.id" :to="menuDestination(page)">{{
          page.name
        }}</RouterLink
        ><RouterLink v-if="configurationFallback" :to="APP_PATHS.settings">配置中心</RouterLink>
      </nav></NDrawerContent
    ></NDrawer
  >
  <NDrawer v-model:show="messagesOpen" :width="mobile ? '100%' : 420"
    ><NDrawerContent title="站内消息" closable
      ><NSpin :show="loading"
        ><NEmpty v-if="!messages.length && !loading" description="暂无消息" /><button
          v-for="item in messages"
          :key="item.id"
          class="notification"
          @click="openMessage(item)"
        >
          <NBadge :dot="!item.readAt" /><strong>{{ item.title }}</strong
          ><small>{{ formatTime(item.createdAt) }}</small>
        </button></NSpin
      ></NDrawerContent
    ></NDrawer
  >
</template>
