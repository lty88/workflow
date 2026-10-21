import { readFile } from 'node:fs/promises';
import { configSchema, seedConfig, validateConfig } from '@workflow/domain';
import { readEnv } from '../env';
import { createPool, materializeConfig, query, transaction } from './repository';
import { hashPassword } from '../services/auth';

/**
 * 显式初始化迁移和种子账号，已有业务配置不会覆盖。
 * @returns 初始化完成状态
 */
async function initialize(): Promise<void> {
  const env = readEnv();
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const demoPassword = process.env.SEED_USER_PASSWORD || '';
  if (adminPassword.length < 12 || adminPassword.startsWith('replace-'))
    throw new Error('请在项目.env设置至少12位的ADMIN_PASSWORD');
  if (demoPassword && (demoPassword.length < 12 || demoPassword.startsWith('replace-')))
    throw new Error('SEED_USER_PASSWORD需至少12位且不能使用占位值；留空则只开通管理员密码');
  const pool = createPool(env);
  try {
    const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    for (const statement of sql.split(';')) if (statement.trim()) await pool.query(statement);
    const existing = await query<{ id: string }>(pool, 'SELECT id FROM configuration LIMIT 1');
    if (existing.length) {
      console.info('数据库结构已检查，现有配置和密码均保留。');
      return;
    }
    const config = configSchema.parse(seedConfig());
    const errors = validateConfig(config);
    if (errors.length) throw new Error(errors.join('；'));
    /**
     * 在一次事务中初始化配置、组织与账号密码。
     * @param connection 事务连接
     */
    async function seed(connection: import('mysql2/promise').PoolConnection): Promise<void> {
      await connection.execute('INSERT INTO configuration(id,published,draft) VALUES (?,?,?)', [
        'company',
        JSON.stringify(config),
        JSON.stringify(config),
      ]);
      await connection.execute('INSERT INTO configuration_releases(version,data,actor) VALUES (?,?,?)', [
        1,
        JSON.stringify(config),
        'system',
      ]);
      await materializeConfig(connection, config);
      for (const user of config.users) {
        const password = user.id === 'u-admin' ? adminPassword : demoPassword;
        if (password)
          await connection.execute('UPDATE members SET password_hash=? WHERE id=?', [
            await hashPassword(password),
            user.id,
          ]);
      }
      await connection.execute('INSERT IGNORE INTO schema_migrations(version) VALUES (1)');
    }
    await transaction(pool, seed);
    console.info('初始化完成。管理员账号：admin；示例员工是否可登录取决于SEED_USER_PASSWORD。');
  } finally {
    await pool.end();
  }
}

await initialize();
