import type { Pool } from 'mysql2/promise';
import { HttpError } from '../errors';
/** 拒绝旧的整包草稿接口，阻止历史调用覆盖业务主表。
 * @param _pool 历史连接参数
 * @param _actor 历史操作人参数
 * @param _input 历史草稿参数
 * @param _expectedVersion 历史修订号参数
 * @returns 始终抛出接口退役错误
 */
export async function saveConfigDraft(
  _pool: Pool,
  _actor: string,
  _input: unknown,
  _expectedVersion: number,
): Promise<never> {
  throw new HttpError(410, 'CONFIG_API_RETIRED', '请使用独立模块保存接口');
}
/** 拒绝旧整包发布入口，主数据保存后立即生效。
 * @param _pool 历史连接参数
 * @param _actor 历史操作人参数
 * @param _expectedVersion 历史修订号参数
 * @returns 始终抛出接口退役错误
 */
export async function publishConfig(_pool: Pool, _actor: string, _expectedVersion: number): Promise<never> {
  throw new HttpError(410, 'CONFIG_API_RETIRED', '主数据无需发布，请使用模块保存接口');
}
