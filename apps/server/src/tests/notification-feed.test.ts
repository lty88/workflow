import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { seedConfig } from '@workflow/domain';
import { notificationFeed } from '../services/notification-service';

/**
 * 构造同一毫秒内多条通知的只读事务替身，记录分页和账号过滤参数。
 * @param total 通知数量
 * @param permitted 是否保留当前成员的活动访问权
 * @returns 连接池及查询参数记录
 */
function fixture(total: number, permitted = true) {
  const config = seedConfig();
  const statements: unknown[][] = [];
  const notices = Array.from({ length: total }, (_, index) => ({
    id: String(index + 1).padStart(4, '0'),
    title: '活动知会',
    activityId: 'a-notice',
    readAt: null,
    createdAt: '2026-10-23 10:00:00.000',
    cursorAt: '2026-10-23 10:00:00.000000',
  }));
  /**
   * 仅实现通知页、实时授权和活动读取查询，未知SQL直接失败。
   * @param sql 参数化SQL
   * @param params 绑定值
   * @returns 驱动形状的查询结果
   */
  async function execute(sql: string, params: unknown[] = []) {
    statements.push(params);
    if (sql.includes('FROM configuration'))
      return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
    if (sql.includes('FROM notifications')) {
      expect(params[0]).toBe('u-lin');
      const rows =
        params.length > 1 ? notices.filter((item) => item.id > String(params[3])) : [...notices].reverse();
      return [rows.slice(0, 101), []];
    }
    if (sql.includes('SELECT data FROM activities'))
      return [
        [
          {
            data: {
              id: 'a-notice',
              applicant: permitted ? 'u-lin' : 'u-qiao',
              department: permitted ? 'd1' : 'd2',
              nodes: [],
              executor: '',
              cancellation: null,
            },
          },
        ],
        [],
      ];
    if (/SELECT data FROM (workflow_nodes|workflow_tasks|audit_events)/.test(sql)) return [[], []];
    if (sql.includes('UTC_TIMESTAMP')) return [[{ at: '2026-10-23 10:00:00.000000' }], []];
    throw new Error('未知SQL:' + sql);
  }
  /** 开始只读内存事务。 */
  async function beginTransaction(): Promise<void> {}
  /** 提交只读内存事务。 */
  async function commit(): Promise<void> {}
  /** 结束失败的只读内存事务。 */
  async function rollback(): Promise<void> {}
  /** 释放无外部资源的连接。 */
  function release(): void {}
  /**
   * 返回只读内存连接。
   * @returns 事务连接替身
   */
  async function getConnection() {
    return { execute, beginTransaction, commit, rollback, release };
  }
  return { pool: { getConnection } as unknown as Pool, statements };
}
/** 核对首次只读取最近消息，并用最高标识建立基线。 */
async function baselineCase(): Promise<void> {
  const result = await notificationFeed(fixture(120).pool, 'u-lin');
  expect(result.items).toHaveLength(100);
  expect(result.items[0]!.id).toBe('0120');
  expect(result.hasMore).toBe(false);
  expect(JSON.parse(Buffer.from(result.cursor, 'base64url').toString()).id).toBe('0120');
}
test('首次取得最近100条并建立静默基线', baselineCase);
/** 核对同毫秒超过100条新消息按标识完整分页，无重漏。 */
async function paginationCase(): Promise<void> {
  const db = fixture(220);
  const cursor = Buffer.from(JSON.stringify({ at: '2026-10-23 10:00:00.000', id: '0000' })).toString(
    'base64url',
  );
  const first = await notificationFeed(db.pool, 'u-lin', cursor);
  const second = await notificationFeed(db.pool, 'u-lin', first.cursor);
  const third = await notificationFeed(db.pool, 'u-lin', second.cursor);
  expect([first.items.length, second.items.length, third.items.length]).toEqual([100, 100, 20]);
  expect(new Set([...first.items, ...second.items, ...third.items].map((item) => item.id)).size).toBe(220);
  expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
}
test('同毫秒的220条通知分三页完整补拉', paginationCase);
/** 核对当前范围撤销后不返回旧通知内容，候选游标仍能前进。 */
async function permissionCase(): Promise<void> {
  const result = await notificationFeed(fixture(2, false).pool, 'u-lin');
  expect(result.items).toEqual([]);
  expect(JSON.parse(Buffer.from(result.cursor, 'base64url').toString()).id).toBe('0002');
}
test('通知保持当前活动权限隔离，无权内容不返回', permissionCase);
/** 核对空收件箱仍返回后续可用游标，畸形游标给出业务错误。 */
async function emptyCase(): Promise<void> {
  const db = fixture(0);
  expect((await notificationFeed(db.pool, 'u-lin')).cursor).toBeTruthy();
  await expect(notificationFeed(db.pool, 'u-lin', 'invalid-json')).rejects.toMatchObject({
    status: 422,
    code: 'NOTIFICATION_CURSOR_INVALID',
  });
}
test('空列表保留游标，非法游标返回422', emptyCase);
