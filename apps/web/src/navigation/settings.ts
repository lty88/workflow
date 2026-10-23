import { APP_PATHS } from './paths';
import type { SettingsSection } from './types';

/** 配置中心页签与概览卡片共用的模块目录，不注册路由。 */
export const SETTINGS_SECTIONS = [
  {
    path: `${APP_PATHS.settings}/forms`,
    name: '动态表单',
    description: '字段、选项、必填、默认值与条件显隐',
  },
  {
    path: `${APP_PATHS.settings}/workflow`,
    name: '流程模板',
    description: '多模板、活动类型、拖拽编排、版本发布与授权',
  },
  {
    path: `${APP_PATHS.settings}/organization`,
    name: '组织架构',
    description: '部门、负责人、成员账号和启停状态',
  },
  {
    path: `${APP_PATHS.settings}/permissions`,
    name: '角色权限',
    description: '操作权限、页面授权与数据范围',
  },
  { path: `${APP_PATHS.settings}/menus`, name: '菜单页面', description: '分组、内置模板、排序与角色关联' },
] as const satisfies readonly SettingsSection[];

export const SETTINGS_TABS = [{ path: APP_PATHS.settings, name: '配置概览' }, ...SETTINGS_SECTIONS];
