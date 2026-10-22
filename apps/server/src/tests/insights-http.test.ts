import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { buildApp } from '../app';
import { readEnv } from '../env';

/**
 * 构造有敏感原始字段的内存连接池，检查公开投影和评价提交去重，不连接数据库。
 * @param state 问卷开关、有效期与活动状态覆盖值
 * @returns 内存连接池及提交次数读取能力
 */
function publicPool(state: { active?: number; expiresAt?: string; status?: string } = {}): {
  pool: Pool;
  submissions: () => number;
} {
  let count = 0;
  const activity = {
    id: 'a-test',
    name: '匿名评价测试活动',
    status: state.status || 'archived',
    report: { end: '2026-01-01T10:00:00Z', spend: '9999' },
    payload: { budget: '99999', contact_info: 'private' },
    nodes: [],
    audit: [],
    tasks: [],
  };
  /**
   * 返回问卷和活动查询结果，记录评价插入并模拟唯一提交。
   * @param sql 服务生成的SQL
   * @param params SQL绑定参数
   * @returns 最小驱动查询结果
   */
  async function execute(sql: string, params: unknown[] = []): Promise<[unknown[], unknown[]]> {
    if (sql.includes('FROM activity_surveys')) {
      if (sql.includes('WHERE token=') && params[0] !== 'a'.repeat(64)) return [[], []];
      return [
        [
          {
            activity_id: 'a-test',
            token: 'a'.repeat(64),
            active: state.active ?? 1,
            expires_at: state.expiresAt || '2099-01-01 00:00:00.000',
            version: 1,
          },
        ],
        [],
      ];
    }
    if (sql.includes('FROM activities')) return [[{ data: activity }], []];
    if (sql.includes('SELECT id FROM activity_evaluations'))
      return [count ? [{ id: 'evaluation-one' }] : [], []];
    if (sql.startsWith('INSERT INTO activity_evaluations')) count += 1;
    return [[], []];
  }
  /** 返回事务所需的空结果，保持无外部副作用。 */
  async function noop(): Promise<void> {}
  /** 结束内存连接的使用，无外部副作用。 */
  function release(): void {}
  /**
   * 获取同一内存连接用于局部事务校验。
   * @returns 内存事务连接
   */
  async function getConnection() {
    return {
      execute,
      beginTransaction: noop,
      commit: noop,
      rollback: noop,
      release,
    };
  }
  /**
   * 读取实际插入次数，供重复提交断言。
   * @returns 写入评价数
   */
  function submissions(): number {
    return count;
  }
  return { pool: { execute, getConnection } as unknown as Pool, submissions };
}

/** 核对匿名GET和POST无需账号、不会返回敏感字段，同浏览器重试只写入一次。 */
async function publicEvaluationCase(): Promise<void> {
  const memory = publicPool();
  const app = await buildApp(memory.pool, readEnv({ NODE_ENV: 'test', MYSQL_PASSWORD: 'unused' }));
  const url = '/api/public/evaluations/' + 'a'.repeat(64);
  try {
    const info = await app.inject({ method: 'GET', url });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toEqual({
      activityName: '匿名评价测试活动',
      completedAt: '2026-01-01T10:00:00Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      submitted: false,
    });
    const cookie = info.cookies[0]!;
    const headers = { cookie: `${cookie.name}=${cookie.value}` };
    const payload = {
      overall: 5,
      content: 4,
      organization: 5,
      usefulness: 4,
      comment: '内容很实用',
    };
    const first = await app.inject({ method: 'POST', url, headers, payload });
    expect(first.statusCode).toBe(200);
    expect(first.json().duplicate).toBe(false);
    const repeated = await app.inject({
      method: 'POST',
      url,
      headers,
      payload,
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().duplicate).toBe(true);
    expect(memory.submissions()).toBe(1);
    const protectedRoute = await app.inject({
      method: 'GET',
      url: '/api/leadership/dashboard?start=2026-01-01&end=2026-12-31',
    });
    expect(protectedRoute.statusCode).toBe(401);
  } finally {
    await app.close();
  }
}
test('匿名评价精确免登录、敏感资料不返回、提交重试去重、领导看板仍需登录', publicEvaluationCase);

/** 核对匿名写入仍受来源和Cookie约束，公开前缀不会豁免其他内部接口。 */
async function publicBoundaryCase(): Promise<void> {
  const app = await buildApp(publicPool().pool, readEnv({ NODE_ENV: 'test', MYSQL_PASSWORD: 'unused' }));
  const url = '/api/public/evaluations/' + 'a'.repeat(64);
  try {
    const missing = await app.inject({ method: 'POST', url, payload: {} });
    expect(missing.statusCode).toBe(422);
    const origin = await app.inject({
      method: 'POST',
      url,
      headers: { origin: 'https://untrusted.example' },
      payload: {},
    });
    expect(origin.statusCode).toBe(403);
    const unknown = await app.inject({ method: 'GET', url: url + '/internal' });
    expect(unknown.statusCode).toBe(401);
    const internal = await app.inject({
      method: 'POST',
      url: '/api/activities/a-test/evaluation-survey',
      payload: { action: 'open', expectedVersion: 0 },
    });
    expect(internal.statusCode).toBe(401);
  } finally {
    await app.close();
  }
}
test('匿名评价只开放指定方法与路由，内部链接管理继续登录校验', publicBoundaryCase);

/** 检查关闭、过期、取消及旧令牌的公开链接不会返回问卷或接受提交。 */
async function unavailableSurveyCase(): Promise<void> {
  for (const state of [{ active: 0 }, { expiresAt: '2020-01-01 00:00:00.000' }, { status: 'cancelled' }]) {
    const app = await buildApp(
      publicPool(state).pool,
      readEnv({ NODE_ENV: 'test', MYSQL_PASSWORD: 'unused' }),
    );
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/public/evaluations/' + 'a'.repeat(64),
      });
      expect(response.statusCode).toBe(410);
    } finally {
      await app.close();
    }
  }
  const app = await buildApp(publicPool().pool, readEnv({ NODE_ENV: 'test', MYSQL_PASSWORD: 'unused' }));
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/public/evaluations/' + 'b'.repeat(64),
    });
    expect(response.statusCode).toBe(404);
  } finally {
    await app.close();
  }
}
test('关闭、到期、取消或已换码的评价链接不可填写', unavailableSurveyCase);
