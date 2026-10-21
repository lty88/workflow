import { readFile } from 'node:fs/promises';
import { DEFAULT_PASSWORD, configSchema, seedConfig, validateConfig } from '@workflow/domain';
import { readEnv } from '../env';
import { createPool, materializeConfig, query, transaction } from './repository';
import { hashPassword } from '../services/auth';
import { initialPassword } from './local-config';

/**
 * 显式初始化迁移和种子账号，默认密码123456，已有业务配置和密码不会覆盖。
 */
async function initialize(): Promise<void> {
  const env = readEnv();
  const adminPassword = initialPassword(process.env.ADMIN_PASSWORD);
  const demoPassword = initialPassword(process.env.SEED_USER_PASSWORD);
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
        if (password !== DEFAULT_PASSWORD)
          await connection.execute('UPDATE members SET password_hash=? WHERE id=?', [
            await hashPassword(password),
            user.id,
          ]);
      }
      await connection.execute('INSERT IGNORE INTO schema_migrations(version) VALUES (1)');
    }
    await transaction(pool, seed);
    console.info('初始化完成。管理员账号：admin；管理员和示例员工默认密码123456，可由.env配置初始值。');
  } finally {
    await pool.end();
  }
}

await initialize();
