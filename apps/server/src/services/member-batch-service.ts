import type { Pool, PoolConnection } from 'mysql2/promise';
import type { ConfigState, Member } from '@workflow/domain';
import { activeMember, configSchema, hasPermission, validateConfig } from '@workflow/domain';
import { z } from 'zod';
import { loadConfig, transaction } from '../db/repository';
import { configurationEnvelope } from '../db/master-data';
import { memberReferences, eraseMemberRecords } from './member-deletion';
import { ensure, HttpError } from '../errors';
export const memberBatchSchema = z
  .object({
    action: z.enum(['delete', 'enable', 'disable']),
    ids: z.array(z.string().min(1).max(80)).min(1).max(200).refine(uniqueIds, '成员ID不能重复'),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
/** 检查批量ID唯一，防止重复执行与错误计数。
 * @param ids 所选成员ID
 * @returns 是否没有重复项
 */
function uniqueIds(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}
/**
 * 原子批量删除、启用或停用成员；先校验整批，任一成员不符合规则时整批不执行。
 * @param pool 项目连接池
 * @param actor 操作管理员ID
 * @param input 批量动作、成员ID及技术修订号
 * @returns 操作后的实时组织主数据
 */
export async function batchMembers(pool: Pool, actor: string, input: unknown): Promise<ConfigState> {
  const body = memberBatchSchema.parse(input);
  const selected = new Set(body.ids);
  /** 在主数据排他锁下校验与提交整批，失败回滚。
   * @param db 事务连接
   * @returns 新的人员上下文
   */
  async function apply(db: PoolConnection): Promise<ConfigState> {
    const state = await loadConfig(db, 'update');
    const config = state.published;
    ensure(hasPermission(config, actor, 'config:manage'), 403, 'FORBIDDEN', '无成员批量管理权限');
    ensure(
      state.revision === body.expectedRevision,
      409,
      'CONFIG_CONFLICT',
      '人员数据已更新，请重新读取后再批量操作',
    );
    const members = config.users.filter(isSelected);
    ensure(members.length === selected.size, 404, 'NOT_FOUND', '部分成员不存在或已删除，请重新读取');
    const errors: string[] = [];
    if (body.action !== 'enable')
      for (const member of members) {
        if (member.id === actor)
          errors.push(`${member.name}（${member.username}）：不能删除或停用当前登录账号`);
        else if (member.id === 'u-admin' || member.username === 'admin')
          errors.push(`${member.name}（${member.username}）：初始管理员不能删除或停用`);
      }
    if (errors.length) throw new HttpError(409, 'MEMBER_BATCH_BLOCKED', '批量操作未执行', errors);
    const users = body.action === 'delete' ? config.users.filter(keepMember) : config.users.map(changeStatus);
    const next = configSchema.parse({ ...config, version: config.version + 1, users });
    ensure(
      activeMember(next, actor) && hasPermission(next, actor, 'config:manage'),
      422,
      'LAST_ADMIN',
      '需保留当前操作人的管理资格和至少一个有效管理员',
    );
    if (body.action !== 'enable')
      for (const department of config.departments)
        if (selected.has(department.manager)) {
          const manager = members.find(
            /** 找出当前部门受影响的负责人。
             * @param member 所选人员
             * @returns 是否为负责人
             */ function matches(member) {
              return member.id === department.manager;
            },
          );
          errors.push(
            `${manager?.name || department.manager}：仍为“${department.name}”负责人，请先交接负责人`,
          );
        }
    errors.push(...validateConfig(next));
    if (body.action === 'delete' && !errors.length)
      for (const member of members) {
        for (const reference of await memberReferences(db, member.id))
          errors.push(`${member.name}（${member.username}）：${reference}`);
      }
    if (errors.length)
      throw new HttpError(409, 'MEMBER_BATCH_BLOCKED', '批量操作未执行，请处理以下问题', [
        ...new Set(errors),
      ]);
    for (const member of members) {
      if (body.action === 'delete') await eraseMemberRecords(db, member.id);
      else {
        await db.execute('UPDATE members SET active=? WHERE id=?', [body.action === 'enable', member.id]);
        if (body.action === 'disable')
          await db.execute('DELETE FROM sessions WHERE member_id=?', [member.id]);
      }
    }
    const envelope = JSON.stringify(configurationEnvelope(next));
    await db.execute(
      "UPDATE configuration SET published=?,draft=?,revision=revision+1,draft_revision=draft_revision+1 WHERE id='company'",
      [envelope, envelope],
    );
    await db.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      crypto.randomUUID(),
      actor,
      '批量管理成员',
      JSON.stringify({ action: body.action, members: members.map(auditMember), count: members.length }),
    ]);
    return loadConfig(db);
  }
  /** 判断是否为所选成员。
   * @param member 当前人员
   * @returns 是否选中
   */
  function isSelected(member: Member): boolean {
    return selected.has(member.id);
  }
  /** 保留未被批量删除的人员。
   * @param member 当前人员
   * @returns 是否保留
   */
  function keepMember(member: Member): boolean {
    return !selected.has(member.id);
  }
  /** 仅更新所选人员的启停状态，保留密码与权限。
   * @param member 当前人员
   * @returns 更新后的人员
   */
  function changeStatus(member: Member): Member {
    return selected.has(member.id) ? { ...member, active: body.action === 'enable' } : member;
  }
  /** 审计保留必要身份资料，不记录密码。
   * @param member 所选成员
   * @returns 审计中的成员摘要
   */
  function auditMember(member: Member) {
    return {
      id: member.id,
      name: member.name,
      username: member.username,
      department: member.department,
      previousActive: member.active,
    };
  }
  return transaction(pool, apply);
}
