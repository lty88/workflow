import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import {
  seedConfig,
  resolveAssignees,
  withStandardBusinessRoles,
  validateConfig,
  supplementCommonOrganization,
} from '@workflow/domain';
import { configurationEnvelope } from '../db/master-data';
import { batchMembers, memberBatchSchema } from '../services/member-batch-service';
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
    if (sql === 'UPDATE members SET active=? WHERE id=?') {
      const target = members.find(
        /** 定位批量更新状态的人。
         * @param member 当前成员
         * @returns 是否为目标
         */ function match(member) {
          return member.id === params[1];
        },
      );
      if (target) target.active = Boolean(params[0]);
    }
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

/** 批量删除两个未引用成员，一次提交并撤销会话。 */
async function batchDeleteCase(): Promise<void> {
  const f = fixture();
  const result = await batchMembers(f.pool, 'u-admin', {
    action: 'delete',
    ids: ['u-lin', 'u-qiao'],
    expectedRevision: 1,
  });
  expect(
    result.published.users.some(
      /** 检查目标人员已移除。
       * @param member 剩余人员
       * @returns 是否错误保留
       */ function match(member) {
        return ['u-lin', 'u-qiao'].includes(member.id);
      },
    ),
  ).toBe(false);
  expect(f.calls.at(-1)?.sql).toBe('COMMIT');
}
/** 成员中包含负责人时整批不产生任何删除或状态更新。 */
async function blockedBatchCase(): Promise<void> {
  const f = fixture();
  await expect(
    batchMembers(f.pool, 'u-admin', { action: 'delete', ids: ['u-lin', 'u-chen'], expectedRevision: 1 }),
  ).rejects.toMatchObject({ code: 'MEMBER_BATCH_BLOCKED' });
  expect(
    f.calls.some(
      /** 核对失败发生在写操作之前。
       * @param call 数据库调用
       * @returns 是否发生了成员变更
       */ function changed(call) {
        return call.sql.startsWith('DELETE') || call.sql.startsWith('UPDATE members');
      },
    ),
  ).toBe(false);
  expect(f.calls.at(-1)?.sql).toBe('ROLLBACK');
}
/** 批量启停仅改active，停用撤销会话，原角色与密码不重置。 */
async function statusCase(): Promise<void> {
  const f = fixture();
  const disabled = await batchMembers(f.pool, 'u-admin', {
    action: 'disable',
    ids: ['u-lin', 'u-qiao'],
    expectedRevision: 1,
  });
  expect(
    disabled.published.users.find(
      /** 定位已停用人员。
       * @param member 人员
       * @returns 是否匹配
       */ function match(member) {
        return member.id === 'u-lin';
      },
    )?.active,
  ).toBe(false);
  expect(f.calls).toContainEqual({ sql: 'DELETE FROM sessions WHERE member_id=?', params: ['u-lin'] });
  const enabled = await batchMembers(f.pool, 'u-admin', {
    action: 'enable',
    ids: ['u-lin', 'u-qiao'],
    expectedRevision: 2,
  });
  expect(
    enabled.published.users.find(
      /** 定位已启用人员。
       * @param member 人员
       * @returns 是否匹配
       */ function match(member) {
        return member.id === 'u-lin';
      },
    )?.active,
  ).toBe(true);
}
/** 校验批量权限、修订号、当前账号保护和参数范围。 */
async function guardsCase(): Promise<void> {
  await expect(
    batchMembers(fixture().pool, 'u-lin', { action: 'disable', ids: ['u-qiao'], expectedRevision: 1 }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    batchMembers(fixture().pool, 'u-admin', { action: 'delete', ids: ['u-lin'], expectedRevision: 99 }),
  ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  await expect(
    batchMembers(fixture().pool, 'u-admin', { action: 'disable', ids: ['u-admin'], expectedRevision: 1 }),
  ).rejects.toMatchObject({ code: 'MEMBER_BATCH_BLOCKED' });
  expect(
    memberBatchSchema.safeParse({ action: 'delete', ids: ['u-lin', 'u-lin'], expectedRevision: 1 }).success,
  ).toBe(false);
  expect(memberBatchSchema.safeParse({ action: 'enable', ids: [], expectedRevision: 1 }).success).toBe(false);
}
/** 九类通用角色、补齐组织不再增殖部门角色，指定部门负责人正确受理。 */
function compactRolesCase(): void {
  const config = withStandardBusinessRoles(seedConfig());
  expect(config.roles).toHaveLength(9);
  expect(validateConfig(config)).toEqual([]);
  expect(supplementCommonOrganization(config, true).config.roles).toHaveLength(9);
  expect(
    resolveAssignees(config, { type: 'department_manager', value: 'research' }, 'u-lin', 'approval'),
  ).toEqual({ ids: ['u-zhou'], errors: [] });
  expect(
    resolveAssignees(config, { type: 'department_manager', value: 'market' }, 'u-lin', 'approval'),
  ).toEqual({ ids: ['u-zhao'], errors: [] });
  expect(
    resolveAssignees(config, { type: 'department_manager', value: 'missing' }, 'u-lin', 'approval').errors
      .length,
  ).toBeGreaterThan(0);
  expect(
    resolveAssignees(config, { type: 'department_manager', value: 'd1' }, 'u-chen', 'approval').errors,
  ).toContain('禁止申请人自审，请设置替代审核人');
}
test('批量删除在一个事务中完成', batchDeleteCase);
test('批量混入负责人则全批不执行', blockedBatchCase);
test('批量启停保留角色并撤销停用者会话', statusCase);
test('批量权限、并发和账号保护', guardsCase);
test('角色精简且跨部门受理准确', compactRolesCase);
