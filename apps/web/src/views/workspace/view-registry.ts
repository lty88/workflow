import { defineAsyncComponent } from 'vue';
import type { AsyncComponentLoader, Component } from 'vue';
import type { PageComponent, PageDefinition } from '@workflow/domain';
import type { WorkspaceViewProps } from './types';
import WorkspaceViewError from './WorkspaceViewError.vue';

/**
 * 创建带加载失败提示的懒加载业务视图，只加载当前授权页面所需模块。
 * @param loader 本地可信组件加载器
 * @returns 可直接渲染的异步组件
 */
function lazyView(loader: AsyncComponentLoader): Component {
  return defineAsyncComponent({ loader, errorComponent: WorkspaceViewError, timeout: 20000 });
}

const activityListView = lazyView(
  /**
   * 按需加载授权活动列表，供工单、待办和档案页面共用。
   * @returns 活动列表组件模块
   */
  function loadActivityList() {
    return import('@/components/workspace/ActivityList.vue');
  },
);

/** 服务端组件码只匹配本地白名单；新增码时 TypeScript 要求同步提供实现。 */
export const WORKSPACE_VIEWS = {
  summary: lazyView(
    /**
     * 按需加载个人工作台。
     * @returns 工作台组件模块
     */
    function loadDashboard() {
      return import('@/components/workspace/Dashboard.vue');
    },
  ),
  activity_list: activityListView,
  task_list: activityListView,
  archive_list: activityListView,
  activity_form: lazyView(
    /**
     * 按需加载活动申请编辑器。
     * @returns 申请编辑器组件模块
     */
    function loadActivityEditor() {
      return import('@/components/activity/ActivityEditor.vue');
    },
  ),
  config_overview: lazyView(
    /**
     * 按需加载兼容旧动态链接的配置中心入口。
     * @returns 配置中心入口组件模块
     */
    function loadConfigurationEntry() {
      return import('./ConfigurationEntry.vue');
    },
  ),
  leadership_dashboard: lazyView(
    /**
     * 按需加载领导数据看板。
     * @returns 领导看板组件模块
     */
    function loadLeadershipDashboard() {
      return import('@/components/leadership/LeadershipDashboard.vue');
    },
  ),
} satisfies Record<PageComponent, Component>;

/**
 * 将授权页面定义转换为业务组件入参，保留工单、待办与档案的数据范围。
 * @param page 已通过服务端页面授权检查的定义
 * @returns 页面标题与适用的列表范围
 */
export function workspaceViewProps(page: PageDefinition): WorkspaceViewProps {
  if (page.component === 'task_list') return { title: page.name, scope: 'tasks' };
  if (page.component === 'archive_list') return { title: page.name, scope: 'archives' };
  if (page.component === 'activity_list') return { title: page.name, scope: 'all' };
  return {};
}

/**
 * 从本地白名单解析业务视图，拒绝未知值及对象原型上的同名属性。
 * @param component 服务端页面组件码
 * @returns 对应异步组件，未知码返回 undefined
 */
export function resolveWorkspaceView(component: string): Component | undefined {
  return Object.hasOwn(WORKSPACE_VIEWS, component) ? WORKSPACE_VIEWS[component as PageComponent] : undefined;
}
