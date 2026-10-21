import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { buildApp } from '../app';
import { readEnv } from '../env';
import { seedConfig } from '@workflow/domain';

/**
 * 校验无监听端口且无数据库的HTTP基础边界。
 */
async function httpCase(): Promise<void> {
  const env = readEnv({ NODE_ENV: 'test', MYSQL_PASSWORD: 'unused-in-local-test' });
  const app = await buildApp({} as Pool, env);
  try {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    const anonymous = await app.inject({ method: 'GET', url: '/api/activities' });
    expect(anonymous.statusCode).toBe(401);
    const origin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://other.example.com' },
      payload: { username: 'admin', password: 'x' },
    });
    expect(origin.statusCode).toBe(403);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'a', password: '' },
    });
    expect(invalid.statusCode).toBe(422);
  } finally {
    await app.close();
  }
}
test('接口注入检查存活、未登录、跨站来源和参数校验', httpCase);

/**
 * 使用只读内存仓储检查真实会话解析、页面授权和CSRF边界。
 */
async function sessionCase(): Promise<void> {
  const config = seedConfig();
  /**
   * 返回会话与发布配置的最小查询结果，不连接外部数据库。
   * @param sql SQL查询
   * @returns 查询结果
   */
  async function execute(sql: string): Promise<[unknown[], unknown[]]> {
    if (sql.includes('FROM sessions')) return [[{ member_id: 'u-lin', csrf_token: 'b'.repeat(64) }], []];
    if (sql.includes('FROM configuration'))
      return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
    return [[], []];
  }
  const app = await buildApp(
    { execute } as unknown as Pool,
    readEnv({ NODE_ENV: 'test', MYSQL_PASSWORD: 'unused' }),
  );
  const cookie = 'workflow_session=' + 'a'.repeat(64);
  try {
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe('u-lin');
    const page = await app.inject({ method: 'GET', url: '/api/pages/p-config', headers: { cookie } });
    expect(page.statusCode).toBe(403);
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/activities',
      headers: { cookie },
      payload: { payload: {} },
    });
    expect(noCsrf.statusCode).toBe(403);
    const invalidBytes = await app.inject({
      method: 'POST',
      url: '/api/activities',
      headers: { cookie, 'x-csrf-token': '中'.repeat(64) },
      payload: { payload: {} },
    });
    expect(invalidBytes.statusCode).toBe(403);
  } finally {
    await app.close();
  }
}
test('会话实时解析权限，未授权页面和缺失或异常CSRF均被拒绝', sessionCase);
