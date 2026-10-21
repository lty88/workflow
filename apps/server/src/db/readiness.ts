import type { Pool } from 'mysql2/promise';
import { loadConfig } from './repository';

/** 启动监听端口前读取项目配置，数据库未连接或未初始化时给出操作步骤。
 * @param pool 项目数据库连接池
 */
export async function requireDatabaseReady(pool: Pool): Promise<void> {
  try { await loadConfig(pool); } catch { throw new Error('数据库连接或初始化未完成。使用本机MySQL请先运行 pnpm db:setup，再运行 pnpm db:init；已有数据库请检查.env连接配置。初始化成功后再启动服务。'); }
}
