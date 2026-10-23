import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { seedConfig } from '@workflow/domain';
import { configurationEnvelope } from '../db/master-data';
import { deleteMember, memberDeleteSchema } from '../services/member-deletion';

/** 构造主数据事务替身，不连接真实数据库。
 * @param referenced 是否模拟成员已有活动引用
 * @param failAudit 是否模拟删除审计失败
 * @returns 主数据、可调用的连接池和SQL记录
 */
function fixture(referenced = false, failAudit = false) {
  const config = seedConfig();
  let revision = 1;
  let members = [...config.users];
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  /** 提供主表查询，并模拟删除与审计错误。
   * @param sql 数据库语句
   * @param params 绑定参数
   * @returns 驱动格式结果
   */
  async function execute(sql: string, params: unknown[] = []): Promise<[unknown, unknown[]]> {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT published,draft'))
      return [
        [
          {
            published: configurationEnvelope(config),
            draft: configurationEnvelope(config),
            revision,
            draft_revision: revision,
          },
        ],
        [],
      ];
    if (sql.startsWith('SELECT id,username'))
      return [
        members.map(
          /** 转换人员列。
           * @param user 人员
           * @returns 成员主表记录
           */ function row(user) {
            return {
              id: user.id,
              username: user.username,
              name: user.name,
              department_id: user.department,
              active: Number(user.active),
              roles: user.roles,
            };
          },
        ),
        [],
      ];
    if (sql.startsWith('SELECT id,parent_id'))
      return [
        config.departments.map(
          /** 转换部门列。
           * @param department 部门
           * @returns 部门主表记录
           */ function row(department) {
            return {
              id: department.id,
              parent_id: department.parent,
              name: department.name,
              manager_id: department.manager,
              active: Number(department.active),
            };
          },
        ),
        [],
      ];
    if (sql.startsWith('SELECT id,name,data FROM roles'))
      return [
        config.roles.map(
          /** 转换角色记录。
           * @param role 角色
           * @returns 角色表行
           */ function row(role) {
            return { ...role, data: role };
          },
        ),
        [],
      ];
    if (sql.startsWith('SELECT id,name,active,data'))
      return [
        config.pages.map(
          /** 转换页面记录。
           * @param page 页面
           * @returns 页面表行
           */ function row(page) {
            return { ...page, data: page };
          },
        ),
        [],
      ];
    if (sql.startsWith('SELECT id,name,active FROM menu_groups')) return [config.groups, []];
    if (sql.startsWith('SELECT definition')) return [[{ definition: config.form }], []];
    if (sql.startsWith('SELECT 1 FROM'))
      return [referenced && sql.includes('FROM activities') ? [{ found: 1 }] : [], []];
    if (sql === 'DELETE FROM members WHERE id=?')
      members = members.filter(
        /** 删除目标成员行。
         * @param user 当前人员
         * @returns 是否保留
         */ function keep(user) {
          return user.id !== params[0];
        },
      );
    if (sql.startsWith('UPDATE configuration')) revision++;
    if (failAudit && sql.startsWith('INSERT INTO audit_events')) throw new Error('审计写入失败');
    return [{ affectedRows: 1 }, []];
  }
  /** 记录事务开启。 */
  async function beginTransaction(): Promise<void> {
    calls.push({ sql: 'BEGIN', params: [] });
  }
  /** 记录事务提交。 */
  async function commit(): Promise<void> {
    calls.push({ sql: 'COMMIT', params: [] });
  }
  /** 记录事务回滚。 */
  async function rollback(): Promise<void> {
    calls.push({ sql: 'ROLLBACK', params: [] });
  }
  /** 释放替身连接。 */
  function release(): void {}
  /** 提供事务连接替身。
   * @returns 连接对象
   */
  async function getConnection() {
    return { execute, beginTransaction, commit, rollback, release };
  }
  return { config, calls, pool: { getConnection } as unknown as Pool };
}
/** 核对空闲成员物理删除、个人会话清理、审计以及主数据返回。 */
async function unusedCase(): Promise<void> {
  const f = fixture();
  const result = await deleteMember(f.pool, 'u-admin', 'u-lin', 1);
  expect(
    result.published.users.some(
      /** 查找被删除成员。
       * @param user 返回人员
       * @returns 是否为目标
       */ function match(user) {
        return user.id === 'u-lin';
      },
    ),
  ).toBe(false);
  expect(result.revision).toBe(2);
  for (const sql of [
    'DELETE FROM members WHERE id=?',
    'DELETE FROM sessions WHERE member_id=?',
    'DELETE FROM notifications WHERE recipient_id=?',
    'DELETE FROM outbox_events WHERE recipient_id=?',
  ])
    expect(f.calls).toContainEqual({ sql, params: ['u-lin'] });
  expect(f.calls.at(-1)?.sql).toBe('COMMIT');
  const audit = f.calls.find(
    /** 查找删除审计。
     * @param call 数据库调用
     * @returns 是否为审计
     */ function match(call) {
      return call.sql.startsWith('INSERT INTO audit_events');
    },
  );
  expect(String(audit?.params[3])).toContain('linxiao');
  expect(String(audit?.params[3])).not.toContain('password');
}
/** 核对部门负责人不能直接删除，失败没有产生删除语句。 */
async function managerCase(): Promise<void> {
  const f = fixture();
  await expect(deleteMember(f.pool, 'u-admin', 'u-chen', 1)).rejects.toMatchObject({ code: 'MEMBER_IN_USE' });
  expect(
    f.calls.some(
      /** 检查是否误删数据。
       * @param call 数据库调用
       * @returns 是否为删除语句
       */ function deleting(call) {
        return call.sql.startsWith('DELETE');
      },
    ),
  ).toBe(false);
  expect(f.calls.at(-1)?.sql).toBe('ROLLBACK');
}
/** 核对活动历史引用会阻止物理删除。 */
async function referencedCase(): Promise<void> {
  const f = fixture(true);
  await expect(deleteMember(f.pool, 'u-admin', 'u-lin', 1)).rejects.toMatchObject({
    code: 'MEMBER_IN_USE',
    details: ['已有活动申请、执行或历史记录，请使用停用保留历史身份'],
  });
  expect(f.calls.at(-1)?.sql).toBe('ROLLBACK');
}
/** 核对接口权限、自删保护、过期修订及成员不存在。 */
async function protectionCase(): Promise<void> {
  await expect(deleteMember(fixture().pool, 'u-lin', 'u-chen', 1)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(deleteMember(fixture().pool, 'u-admin', 'u-admin', 1)).rejects.toMatchObject({
    code: 'MEMBER_SELF_DELETE',
  });
  await expect(deleteMember(fixture().pool, 'u-admin', 'u-lin', 2)).rejects.toMatchObject({
    code: 'CONFIG_CONFLICT',
  });
  await expect(deleteMember(fixture().pool, 'u-admin', 'missing', 1)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  const f = fixture();
  f.config.users
    .find(
      /** 定位第二位管理员，用来检查初始管理员保护。
       * @param user 成员
       * @returns 是否为陈宁
       */ function match(user) {
        return user.id === 'u-chen';
      },
    )!
    .roles.push('admin');
  await expect(deleteMember(f.pool, 'u-chen', 'u-admin', 1)).rejects.toMatchObject({
    code: 'MEMBER_PROTECTED',
  });
}
/** 核对审计失败时事务回滚，避免出现无审计的成功删除。 */
async function rollbackCase(): Promise<void> {
  const f = fixture(false, true);
  await expect(deleteMember(f.pool, 'u-admin', 'u-lin', 1)).rejects.toThrow('审计写入失败');
  expect(f.calls.at(-1)?.sql).toBe('ROLLBACK');
}
/** 核对请求必须携带正确修订号。 */
function schemaCase(): void {
  expect(memberDeleteSchema.safeParse({}).success).toBe(false);
  expect(memberDeleteSchema.safeParse({ expectedRevision: 1 }).success).toBe(true);
}
test('未使用成员可直接物理删除并撤销会话', unusedCase);
test('部门负责人需先完成交接', managerCase);
test('活动历史引用保护成员身份', referencedCase);
test('权限、管理员、并发及不存在保护', protectionCase);
test('删除审计失败触发整体回滚', rollbackCase);
test('删除请求必须携带修订号', schemaCase);
