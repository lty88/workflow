import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { resetAdminPassword } from '../services/admin-recovery';
import { verifyPassword } from '../services/auth';

/**
 * 构造无真实数据库的事务记录器，检查恢复操作的提交和回滚边界。
 * @param found 是否存在初始管理员
 * @param failAudit 是否模拟审计写入失败
 * @returns 连接池替身和调用记录
 */
function recoveryFixture(found = true, failAudit = false) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  /**
   * 记录SQL与参数，模拟管理员查询及审计失败。
   * @param sql 参数化语句
   * @param params 绑定参数
   * @returns 驱动查询结果
   */
  async function execute(sql: string, params: unknown[] = []): Promise<[unknown, unknown[]]> {
    calls.push({ sql, params });
    if (failAudit && sql.startsWith('INSERT INTO audit_events')) throw new Error('模拟审计失败');
    if (sql.startsWith('SELECT')) return [found ? [{ id: 'u-admin', username: 'admin' }] : [], []];
    return [{ affectedRows: 1 }, []];
  }
  /** 记录开启事务的副作用。 */
  async function beginTransaction(): Promise<void> {
    calls.push({ sql: 'BEGIN', params: [] });
  }
  /** 记录事务提交的副作用。 */
  async function commit(): Promise<void> {
    calls.push({ sql: 'COMMIT', params: [] });
  }
  /** 记录事务回滚的副作用。 */
  async function rollback(): Promise<void> {
    calls.push({ sql: 'ROLLBACK', params: [] });
  }
  /** 记录连接释放的副作用。 */
  function release(): void {
    calls.push({ sql: 'RELEASE', params: [] });
  }
  /**
   * 返回同一个事务连接替身。
   * @returns 可记录事务及查询操作的连接
   */
  async function getConnection() {
    return { execute, beginTransaction, commit, rollback, release };
  }
  return { pool: { getConnection } as unknown as Pool, calls };
}

/** 校验六位默认密码恢复后写入可验证的哈希，撤销会话且审计不包含密码。 */
async function recoveryCase(): Promise<void> {
  const fixture = recoveryFixture();
  const password = '123456';
  expect(await resetAdminPassword(fixture.pool, password)).toBe('admin');
  const update = fixture.calls[2];
  expect(update.sql).toBe('UPDATE members SET password_hash=? WHERE id=?');
  expect(update.params[1]).toBe('u-admin');
  expect(await verifyPassword(password, update.params[0] as string)).toBe(true);
  expect(await verifyPassword('incorrect', update.params[0] as string)).toBe(false);
  expect(fixture.calls[3]).toEqual({
    sql: 'DELETE FROM sessions WHERE member_id=?',
    params: ['u-admin'],
  });
  expect(JSON.stringify(fixture.calls)).not.toContain(password);
  expect(fixture.calls.slice(-2)).toEqual([
    { sql: 'COMMIT', params: [] },
    { sql: 'RELEASE', params: [] },
  ]);
}
test('管理员恢复事务写入scrypt哈希、撤销会话且不记录明文', recoveryCase);

/** 校验无效维护密码在任何数据库操作前被拒绝。 */
async function invalidPasswordCase(): Promise<void> {
  const fixture = recoveryFixture();
  await expect(resetAdminPassword(fixture.pool, 'short')).rejects.toThrow();
  await expect(resetAdminPassword(fixture.pool, 'replace-with-a-real-password')).rejects.toThrow(
    '不能使用示例占位值',
  );
  expect(fixture.calls).toEqual([]);
}
test('拒绝过短及占位密码，不修改数据库', invalidPasswordCase);

/** 校验管理员缺失或审计失败均回滚事务并释放连接。 */
async function rollbackCase(): Promise<void> {
  for (const fixture of [recoveryFixture(false), recoveryFixture(true, true)]) {
    await expect(resetAdminPassword(fixture.pool, 'LocalRecovery!2026')).rejects.toThrow();
    expect(fixture.calls.slice(-2)).toEqual([
      { sql: 'ROLLBACK', params: [] },
      { sql: 'RELEASE', params: [] },
    ]);
  }
}
test('管理员缺失或审计失败时回滚恢复事务', rollbackCase);
