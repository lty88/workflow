import type { PageDefinition } from '@workflow/domain';
import type { Directory } from '@/typings/api';
import { request } from './http';

/**
 * 读取动态页面授权。
 * @param id 页面标识
 * @returns 页面定义
 */
export function pageApi(id: string): Promise<PageDefinition> {
  return request('/pages/' + encodeURIComponent(id));
}

/**
 * 获取授权人员选项。
 * @returns 成员与角色选项
 */
export function directoryApi(): Promise<Directory> {
  return request('/directory');
}
