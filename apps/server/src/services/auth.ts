import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Pool } from 'mysql2/promise';
import { activeMember, findById, pagesFor, permissionsFor } from '@workflow/domain';
import type { SessionProfile } from '@workflow/domain';
import { loadConfig, query } from '../db/repository';
import { ensure } from '../errors';
import type { Environment } from '../env';

const scryptAsync = promisify(scrypt);
/**
 * 计算会话或幂等请求摘要，数据库不保存原始会话令牌。
 * @param value 原文
 * @returns SHA256摘要
 */
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * 使用随机盐对账号密码派生哈希。
 * @param password 原始密码
 * @returns 带盐派生结果
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}

/**
 * 恒定时间校验密码，格式异常时拒绝。
 * @param password 输入密码
 * @param encoded 存储哈希
 * @returns 密码是否正确
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [kind, salt, hash] = encoded.split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = (await scryptAsync(password, salt, 64)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * 登录并创建服务端会话，权限从当前已发布配置解析。
 * @param pool 连接池
 * @param env 环境配置
 * @param username 登录账号
 * @param password 密码
 * @returns 令牌及会话资料
 */
export async function login(
  pool: Pool,
  env: Environment,
  username: string,
  password: string,
): Promise<{ token: string; profile: SessionProfile }> {
  const rows = await query<{ id: string; password_hash: string | null }>(
    pool,
    'SELECT id,password_hash FROM members WHERE username=? LIMIT 1',
    [username],
  );
  const stored = rows[0]?.password_hash;
  const valid = await verifyPassword(password, stored || 'scrypt:invalid:00');
  ensure(rows[0] && valid, 401, 'INVALID_CREDENTIALS', '账号或密码错误');
  const config = (await loadConfig(pool)).published;
  ensure(activeMember(config, rows[0].id), 403, 'ACCOUNT_DISABLED', '账号或部门已停用');
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  await pool.execute('INSERT INTO sessions(token_hash,member_id,csrf_token,expires_at) VALUES (?,?,?,?)', [
    digest(token),
    rows[0].id,
    csrfToken,
    new Date(Date.now() + env.SESSION_HOURS * 3600000),
  ]);
  return {
    token,
    profile: {
      user: findById(config.users, rows[0].id)!,
      permissions: permissionsFor(config, rows[0].id),
      menus: pagesFor(config, rows[0].id),
      groups: config.groups,
      form: config.form,
      configVersion: config.version,
      csrfToken,
    },
  };
}

/**
 * 验证会话与当前账号有效性并返回最新菜单和权限。
 * @param pool 连接池
 * @param token Cookie会话令牌
 * @returns 当前身份资料
 */
export async function sessionProfile(pool: Pool, token: string | undefined): Promise<SessionProfile> {
  ensure(token && /^[a-f0-9]{64}$/.test(token), 401, 'UNAUTHENTICATED', '请先登录');
  const rows = await query<{ member_id: string; csrf_token: string }>(
    pool,
    'SELECT member_id,csrf_token FROM sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3)',
    [digest(token)],
  );
  ensure(rows[0], 401, 'SESSION_EXPIRED', '登录已过期，请重新登录');
  const config = (await loadConfig(pool)).published;
  ensure(activeMember(config, rows[0].member_id), 403, 'ACCOUNT_DISABLED', '账号或所属部门已停用');
  return {
    user: findById(config.users, rows[0].member_id)!,
    permissions: permissionsFor(config, rows[0].member_id),
    menus: pagesFor(config, rows[0].member_id),
    groups: config.groups,
    form: config.form,
    configVersion: config.version,
    csrfToken: rows[0].csrf_token,
  };
}
