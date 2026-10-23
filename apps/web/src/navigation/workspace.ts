import type { PageDefinition } from '@workflow/domain';
import { APP_PATHS, isModulePath, workspaceDestination } from './paths';

/**
 * 合并同一配置中心的重复动态入口，保持其余授权菜单的名称、顺序和分组。
 * @param pages 服务端已授权菜单
 * @returns 只保留一个配置中心的菜单列表
 */
export function workspaceNavigation(pages: PageDefinition[]): PageDefinition[] {
  const result: PageDefinition[] = [];
  let configurationShown = false;
  for (const page of pages) {
    if (page.component === 'config_overview') {
      if (configurationShown) continue;
      configurationShown = true;
    }
    result.push(page);
  }
  return result;
}

/**
 * 将配置中心导航到统一管理入口，其余页面沿用动态工作区地址。
 * @param page 已授权菜单
 * @returns 对应页面地址
 */
export function menuDestination(page: PageDefinition): string {
  return page.component === 'config_overview' ? APP_PATHS.settings : workspaceDestination(page.id);
}

/**
 * 判断授权菜单是否对应当前页面，配置模块的子页面沿用同一入口高亮。
 * @param page 已授权菜单
 * @param path 当前页面路径
 * @returns 是否激活该菜单
 */
export function isMenuActive(page: PageDefinition, path: string): boolean {
  return (
    path === workspaceDestination(page.id) ||
    (page.component === 'config_overview' && isModulePath(path, APP_PATHS.settings))
  );
}

/**
 * 返回当前账号可访问的活动工单入口，缺少入口时回到首页。
 * @param pages 当前账号由服务端授权的菜单
 * @returns 活动列表或首页地址
 */
export function activityListDestination(pages: PageDefinition[]): string {
  const page = pages.find((item) => item.active && item.component === 'activity_list');
  return page ? menuDestination(page) : APP_PATHS.home;
}

/**
 * 计算布局标题，动态菜单名称由服务端授权资料提供。
 * @param path 当前页面路径
 * @param pages 去重后的授权菜单
 * @returns 当前页面的导航标题
 */
export function navigationTitle(path: string, pages: PageDefinition[]): string {
  if (isModulePath(path, APP_PATHS.settings)) return '配置中心';
  if (path === APP_PATHS.activityCreate) return '发起活动';
  if (isModulePath(path, '/activities')) return '活动详情';
  if (path === APP_PATHS.account) return '账号安全';
  return pages.find((page) => isMenuActive(page, path))?.name || '工作台';
}
