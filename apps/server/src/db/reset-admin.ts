import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { readEnv } from '../env';
import { resetAdminPassword } from '../services/admin-recovery';
import { createPool } from './repository';
import { initialPassword } from './local-config';

/**
 * 显式读取项目.env恢复管理员密码，未配置时使用123456，并撤销旧会话。
 */
async function resetAdmin(): Promise<void> {
  const localEnv = parseEnv(await readFile(new URL('../../../../.env', import.meta.url), 'utf8'));
  const env = readEnv({ ...process.env, ...localEnv });
  const pool = createPool(env);
  try {
    const username = await resetAdminPassword(pool, initialPassword(localEnv.ADMIN_PASSWORD));
    console.info(`管理员密码已恢复。账号：${username}；使用.env中的ADMIN_PASSWORD，未配置时使用123456。`);
    console.info('该账号的旧会话已撤销；业务数据及其他成员密码保持不变。');
  } finally {
    await pool.end();
  }
}

await resetAdmin();
