import { readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import {
  configuredPassword,
  grantDatabaseName,
  initialPassword,
  localPassword,
  updateEnv,
} from './local-config';
import { passwordSchema } from '@workflow/domain';

const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
const examplePath = fileURLToPath(new URL('../../../../.env.example', import.meta.url));

/** 读取现有环境文件；首次配置时使用示例内容，不覆盖已填写信息。
 * @returns 环境文本与是否存在本地文件
 */
async function localEnv(): Promise<{ source: string; exists: boolean }> {
  try {
    return { source: await readFile(envPath, 'utf8'), exists: true };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { source: await readFile(examplePath, 'utf8'), exists: false };
    throw error;
  }
}

/** 将数据库错误转换为不含密码、SQL正文或连接字符串的中文提示。
 * @param error 数据库或文件异常
 * @returns 可安全显示的错误说明
 */
function setupError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'ER_ACCESS_DENIED_ERROR')
    return 'MySQL管理账号或密码不正确，请使用本机MySQL的管理密码重新运行。';
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT')
    return '本机127.0.0.1:3306无法连接，请先启动本机MySQL服务。';
  if (code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR' || code === 'ER_DBACCESS_DENIED_ERROR')
    return '此MySQL账号缺少创建数据库、创建用户或授权权限，请换用数据库管理员账号。';
  if (code) return `配置未完成（${code}），已有业务数据保留。`;
  return error instanceof Error ? error.message : '本机数据库配置未完成';
}

/** 检查既有本机项目凭据和应用初始密码是否可用，成功时直接复用。
 * @param env 当前环境配置
 * @returns 是否已经配置成功
 */
async function alreadyConfigured(env: Record<string, string | undefined>): Promise<boolean> {
  if (
    env.MYSQL_HOST !== '127.0.0.1' ||
    env.MYSQL_PORT !== '3306' ||
    !env.MYSQL_USER ||
    !env.MYSQL_DATABASE ||
    !configuredPassword(env.MYSQL_PASSWORD) ||
    !configuredPassword(env.ADMIN_PASSWORD) ||
    !passwordSchema.safeParse({ password: env.ADMIN_PASSWORD }).success
  )
    return false;
  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3306,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      database: env.MYSQL_DATABASE,
      connectTimeout: 3000,
    });
    await connection.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await connection?.end();
  }
}

/** 交互式建立本机MySQL账号并写入.env，应用密码默认123456；不启动应用或重置已有账号。
 */
async function setup(): Promise<void> {
  if (!process.stdin.isTTY) throw new Error('请在交互式终端运行 pnpm db:setup，以便安全输入MySQL管理密码。');
  const local = await localEnv();
  const env = parseEnv(local.source);
  if (await alreadyConfigured(env)) {
    console.info(
      '现有本机数据库配置连接成功，配置和密码保持不变。继续执行 pnpm db:init，成功后再 pnpm dev。',
    );
    return;
  }
  let muted = false;
  const output = new Writable({
    /** 在密码输入期间抑制回显，管理密码只保存在当前进程内存。
     * @param chunk 终端输出内容
     * @param _encoding 输出编码
     * @param callback 写入完成回调
     */
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  const controller = new AbortController();
  /** 用户中断时结束提问，避免继续创建数据库资源。 */
  function abort(): void {
    controller.abort();
    input.close();
  }
  input.once('SIGINT', abort);
  let connection: mysql.Connection | undefined;
  try {
    console.info('将使用本机MySQL 127.0.0.1:3306；管理密码不会写入项目.env。');
    const user =
      (await input.question('MySQL管理账号 [root]：', { signal: controller.signal })).trim() || 'root';
    process.stdout.write('MySQL管理密码（输入不回显）：');
    muted = true;
    let password: string;
    try {
      password = await input.question('', { signal: controller.signal });
    } finally {
      muted = false;
      process.stdout.write('\n');
    }
    input.close();
    connection = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3306,
      user,
      password,
      connectTimeout: 5000,
    });
    password = '';
    const database = env.MYSQL_DATABASE || 'activity_workflow';
    if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('MYSQL_DATABASE仅支持英文字母、数字与下划线。');
    const [tables] = await connection.execute<RowDataPacket[]>(
      'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=?',
      [database],
    );
    const hasConfig = tables.some(
      /** 检查是否已有本项目配置表。
       * @param row 表元数据
       * @returns 是否配置表
       */ function configurationTable(row) {
        return row.TABLE_NAME === 'configuration';
      },
    );
    if (tables.length && !hasConfig)
      throw new Error('目标数据库已有其他表，请在.env为MYSQL_DATABASE设置一个新的项目库名后重试。');
    if (hasConfig) {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM ??.configuration',
        [database],
      );
      if (Number(rows[0]?.total || 0) > 0)
        throw new Error('项目库已有初始化数据，请恢复之前的.env连接账号与密码；向导保留原数据和登录密码。');
    }
    const appUser = 'wf_local_' + randomBytes(6).toString('hex');
    const appPassword = localPassword();
    const adminPassword = initialPassword(env.ADMIN_PASSWORD);
    const seedPassword = initialPassword(env.SEED_USER_PASSWORD);
    await connection.query(
      'CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci',
      [database],
    );
    await connection.query('CREATE USER ?@? IDENTIFIED BY ?', [appUser, 'localhost', appPassword]);
    const [modes] = await connection.query<RowDataPacket[]>("SHOW VARIABLES LIKE 'partial_revokes'");
    const grantName = grantDatabaseName(database, String(modes[0]?.Value || '').toUpperCase() === 'ON');
    await connection.query('GRANT ALL PRIVILEGES ON ??.* TO ?@?', [grantName, appUser, 'localhost']);
    const app = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3306,
      user: appUser,
      password: appPassword,
      database,
      connectTimeout: 5000,
    });
    try {
      await app.query('SELECT 1');
    } finally {
      await app.end();
    }
    const values = {
      MYSQL_HOST: '127.0.0.1',
      MYSQL_PORT: '3306',
      MYSQL_DATABASE: database,
      MYSQL_USER: appUser,
      MYSQL_PASSWORD: appPassword,
      ADMIN_PASSWORD: adminPassword,
      SEED_USER_PASSWORD: seedPassword,
      APP_ORIGIN: env.APP_ORIGIN || 'http://localhost:5173',
    };
    if (local.exists)
      await writeFile(envPath + '.' + Date.now() + '.local', local.source, { flag: 'wx', mode: 0o600 });
    const temporary = envPath + '.setup-' + randomBytes(6).toString('hex') + '.local';
    try {
      await writeFile(temporary, updateEnv(local.source, values), { flag: 'wx', mode: 0o600 });
      await rename(temporary, envPath);
      await chmod(envPath, 0o600);
    } finally {
      await unlink(temporary).catch(
        /** 忽略临时文件已完成原子替换的情况。 */ function ignoreMissing(): void {},
      );
    }
    console.info(`本机数据库连接成功：127.0.0.1:3306 / ${database}`);
    console.info('项目专用账号及随机密码已写入.env，原.env已备份（原文件存在时）。');
    console.info('继续执行 pnpm db:init，成功后再执行 pnpm dev。');
    console.info(
      `浏览器访问 ${values.APP_ORIGIN}；管理员账号admin，密码查看.env的ADMIN_PASSWORD。示例员工密码查看SEED_USER_PASSWORD。`,
    );
  } finally {
    input.close();
    await connection?.end();
  }
}

try {
  await setup();
} catch (error) {
  console.error(setupError(error));
  process.exitCode = 1;
}
