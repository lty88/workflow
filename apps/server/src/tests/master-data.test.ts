import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { seedConfig, configSchema } from '@workflow/domain';
import { loadConfig } from '../db/repository';
import { configurationEnvelope } from '../db/master-data';
import { saveSettings } from '../services/settings-service';

/** 构造没有真实数据库的主表替身，用于检查配置残留与事务提交边界。
 * @returns 可修改成员行、数据库连接池和写入记录
 */
function fixture() {
  const original = seedConfig();
  let revision = 1;
  const members = original.users.map(
    /** 将领域人员转换为真实成员表列。
     * @param user 原始人员
     * @returns 成员表行
     */ function toRow(user) {
      return {
        id: user.id,
        username: user.username,
        name: user.name,
        department_id: user.department,
        active: Number(user.active),
        roles: user.roles,
      };
    },
  );
  const calls: string[] = [];
  /** 按SQL职责返回主表行，记录写入与提交操作。
   * @param sql SQL语句
   * @param params 绑定参数
   * @returns 驱动结果
   */
  async function execute(sql: string, params: unknown[] = []): Promise<[unknown, unknown[]]> {
    if (sql.startsWith('SELECT published,draft'))
      return [
        [
          {
            published: { ...configurationEnvelope(original), users: original.users },
            draft: original,
            revision,
            draft_revision: revision,
          },
        ],
        [],
      ];
    if (sql.startsWith('SELECT id,username')) return [members, []];
    if (sql.startsWith('SELECT id,parent_id'))
      return [
        original.departments.map(
          /** 转换部门主列并故意注入错误副本。
           * @param d 部门
           * @returns 主表行
           */ function toRow(d) {
            return {
              id: d.id,
              parent_id: d.parent,
              name: d.name,
              manager_id: d.manager,
              active: Number(d.active),
              data: { name: '错误副本' },
            };
          },
        ),
        [],
      ];
    if (sql.startsWith('SELECT id,name,data FROM roles'))
      return [
        original.roles.map(
          /** 转换角色行。
           * @param role 角色
           * @returns 角色记录
           */ function toRow(role) {
            return { id: role.id, name: role.name, data: role };
          },
        ),
        [],
      ];
    if (sql.startsWith('SELECT id,name,active,data'))
      return [
        original.pages.map(
          /** 转换菜单行。
           * @param page 菜单
           * @returns 菜单记录
           */ function toRow(page) {
            return { ...page, data: page };
          },
        ),
        [],
      ];
    if (sql.startsWith('SELECT id,name,active FROM menu_groups')) return [original.groups, []];
    if (sql.startsWith('SELECT definition')) return [[{ definition: original.form }], []];
    if (sql.startsWith('SELECT draft,published')) return [[], []];
    calls.push(sql);
    if (sql.startsWith('UPDATE members SET username')) {
      const row = members.find(
        /** 定位待保存成员。
         * @param user 成员行
         * @returns 标识是否相同
         */ function match(user) {
          return user.id === params[5];
        },
      );
      if (row) row.name = String(params[1]);
    }
    if (sql.startsWith('UPDATE configuration')) revision++;
    return [{ affectedRows: 1 }, []];
  }
  /** 记录事务开启。 */
  async function beginTransaction(): Promise<void> {
    calls.push('BEGIN');
  }
  /** 记录事务提交。 */
  async function commit(): Promise<void> {
    calls.push('COMMIT');
  }
  /** 记录事务回滚。 */
  async function rollback(): Promise<void> {
    calls.push('ROLLBACK');
  }
  /** 释放替身连接，无外部副作用。 */
  function release(): void {}
  /** 提供同一事务连接。
   * @returns 可记录主表读写的连接
   */
  async function getConnection() {
    return { execute, beginTransaction, commit, rollback, release };
  }
  return { original, members, calls, pool: { execute, getConnection } as unknown as Pool };
}
/** 验证主表删除立即反映到聚合结果，不从残留JSON恢复人员。 */
async function deletedMemberCase(): Promise<void> {
  const f = fixture();
  f.members.splice(1, 1);
  const result = await loadConfig(f.pool);
  expect(result.published.users).toHaveLength(f.original.users.length - 1);
  expect(
    result.published.users.some(
      /** 查找已删除成员。
       * @param user 当前主表人员
       * @returns 是否被错误恢复
       */ function match(user) {
        return user.id === f.original.users[1]!.id;
      },
    ),
  ).toBe(false);
  expect(result.published.departments[0]!.name).toBe(f.original.departments[0]!.name);
  expect(configSchema.safeParse(result.published).success).toBe(true);
  expect(result.draft).toEqual(result.published);
}
/** 验证模块保存直接更新成员主表而不写整包人员JSON。 */
async function directSaveCase(): Promise<void> {
  const f = fixture();
  const changes = structuredClone(f.original);
  changes.users[1]!.name = '新的测试姓名';
  const result = await saveSettings(
    f.pool,
    'u-admin',
    'organization',
    { users: changes.users, departments: changes.departments, roles: changes.roles },
    1,
  );
  expect(result.published.users[1]!.name).toBe('新的测试姓名');
  expect(f.calls).toContain('COMMIT');
  expect(
    f.calls.some(
      /** 检查是否执行了旧整包删除。
       * @param sql 写入语句
       * @returns 是否存在危险清空
       */ function dangerous(sql) {
        return sql === 'DELETE FROM departments' || sql === 'DELETE FROM members';
      },
    ),
  ).toBe(false);
}
/** 验证并发修订冲突在写入主表前回滚。 */
async function conflictCase(): Promise<void> {
  const f = fixture();
  await expect(
    saveSettings(f.pool, 'u-admin', 'permissions', { roles: f.original.roles }, 99),
  ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  expect(f.calls).toEqual(['BEGIN', 'ROLLBACK']);
}
test('人员从members读取，配置残留不能复活已删除人员', deletedMemberCase);
test('组织保存直接写主表并提交，无需整包发布', directSaveCase);
test('并发设置冲突不会覆盖主表', conflictCase);
