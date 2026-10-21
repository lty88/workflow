import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * 使用随机盐对账号密码派生哈希，供初始化、配置发布和密码修改共用。
 * @param password 原始密码
 * @returns 带随机盐的scrypt哈希
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
