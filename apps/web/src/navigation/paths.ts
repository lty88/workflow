/** 固定页面的导航地址；实际路由由 pages 目录自动生成。 */
export const APP_PATHS = {
  home: '/',
  login: '/login',
  account: '/account',
  activityCreate: '/activities/new',
  requests: '/requests',
  requestCreate: '/requests/new',
  settings: '/settings',
} as const;

/**
 * 创建活动详情链接，对业务标识进行路径编码。
 * @param id 活动标识
 * @param businessType 业务类型，旧活动默认保持原地址
 * @returns 申请或活动详情地址
 */
export function activityDestination(id: string, businessType: 'activity' | 'general' = 'activity'): string {
  return `/${businessType === 'general' ? 'requests' : 'activities'}/${encodeURIComponent(id)}`;
}

/**
 * 创建动态菜单页面链接，对页面标识进行路径编码。
 * @param id 服务端授权页面标识
 * @returns 动态工作区地址
 */
export function workspaceDestination(id: string): string {
  return `/workspace/${encodeURIComponent(id)}`;
}

/**
 * 精确匹配业务模块或其子页面，避免相似前缀误判。
 * @param path 当前页面路径
 * @param base 模块入口路径
 * @returns 是否属于该模块
 */
export function isModulePath(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}
