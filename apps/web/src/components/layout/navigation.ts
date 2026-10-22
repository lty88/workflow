import type { PageDefinition } from '@workflow/domain';

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
  return page.component === 'config_overview' ? '/settings' : '/workspace/' + page.id;
}
