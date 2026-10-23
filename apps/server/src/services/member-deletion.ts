import type { Pool, PoolConnection } from 'mysql2/promise';
import type { ConfigState } from '@workflow/domain';
import { configSchema, hasPermission, validateConfig } from '@workflow/domain';
import { z } from 'zod';
import { configurationEnvelope } from '../db/master-data';
import { loadConfig, query, transaction } from '../db/repository';
import { ensure, HttpError } from '../errors';

export const memberDeleteSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();

/**
 * 检查活动历史、模板与敏感授权中的人员引用，忽略仅用于备份的旧配置副本。
 * @param db 事务连接
 * @param id 待删除成员ID
 * @returns 阻止物理删除的业务引用说明
 */
export async function memberReferences(db: PoolConnection, id: string): Promise<string[]> {
  const pattern = id.replace(/[\\%_]/g, '\\$&');
  const checks: Array<{ label: string; sql: string; params: string[] }> = [
    {
      label: '活动申请、执行或历史记录',
      sql: "SELECT 1 FROM activities WHERE applicant_id=? OR JSON_SEARCH(data,'one',?) IS NOT NULL LIMIT 1",
      params: [id, pattern],
    },
    {
      label: '流程节点或受理记录',
      sql: "SELECT 1 FROM workflow_nodes WHERE JSON_SEARCH(data,'one',?) IS NOT NULL LIMIT 1",
      params: [pattern],
    },
    {
      label: '审批或办理任务',
      sql: "SELECT 1 FROM workflow_tasks WHERE assignee_id=? OR JSON_SEARCH(data,'one',?) IS NOT NULL LIMIT 1",
      params: [id, pattern],
    },
    {
      label: '附件上传或授权',
      sql: "SELECT 1 FROM files WHERE uploader_id=? OR JSON_SEARCH(access_rule,'one',?) IS NOT NULL OR JSON_SEARCH(download_rule,'one',?) IS NOT NULL LIMIT 1",
      params: [id, pattern, pattern],
    },
    {
      label: '流程模板设置',
      sql: "SELECT 1 FROM workflow_templates WHERE created_by=? OR JSON_SEARCH(draft,'one',?) IS NOT NULL OR JSON_SEARCH(published,'one',?) IS NOT NULL LIMIT 1",
      params: [id, pattern, pattern],
    },
    {
      label: '流程模板历史版本',
      sql: "SELECT 1 FROM workflow_template_releases WHERE published_by=? OR JSON_SEARCH(definition,'one',?) IS NOT NULL OR JSON_SEARCH(form_snapshot,'one',?) IS NOT NULL LIMIT 1",
      params: [id, pattern, pattern],
    },
    {
      label: '表单设置或授权',
      sql: "SELECT 1 FROM form_definitions WHERE updated_by=? OR JSON_SEARCH(definition,'one',?) IS NOT NULL LIMIT 1",
      params: [id, pattern],
    },
    {
      label: '表单修订记录',
      sql: "SELECT 1 FROM form_definition_versions WHERE actor_id=? OR JSON_SEARCH(definition,'one',?) IS NOT NULL LIMIT 1",
      params: [id, pattern],
    },
    { label: '历史操作审计', sql: 'SELECT 1 FROM audit_events WHERE actor_id=? LIMIT 1', params: [id] },
  ];
  const references: string[] = [];
  for (const check of checks)
    if ((await query(db, check.sql, check.params)).length)
      references.push(`已有${check.label}，请使用停用保留历史身份`);
  return references;
}

/**
 * 永久删除未被业务引用的成员，锁定主数据修订号，原子清理会话、个人通知并记录审计。
 * @param pool 项目连接池
 * @param actor 操作管理员ID
 * @param id 待删除成员ID
 * @param expectedRevision 页面读取时的主数据修订号
 * @returns 删除后重新装配的主数据状态
 */
export async function deleteMember(
  pool: Pool,
  actor: string,
  id: string,
  expectedRevision: number,
): Promise<ConfigState> {
  /** 在主数据排他锁下检查权限与引用，任何失败均回滚。
   * @param db 事务连接
   * @returns 删除后的实时设置
   */
  async function remove(db: PoolConnection): Promise<ConfigState> {
    const state = await loadConfig(db, 'update');
    const config = state.published;
    ensure(hasPermission(config, actor, 'config:manage'), 403, 'FORBIDDEN', '无成员删除权限');
    ensure(state.revision === expectedRevision, 409, 'CONFIG_CONFLICT', '人员数据已更新，请重新读取后再删除');
    const member = config.users.find(
      /** 定位真实主表中的目标成员。
       * @param user 当前成员
       * @returns 是否匹配待删除ID
       */ function matches(user) {
        return user.id === id;
      },
    );
    ensure(member, 404, 'NOT_FOUND', '成员不存在或已被删除');
    ensure(id !== actor, 422, 'MEMBER_SELF_DELETE', '不能删除当前登录账号');
    ensure(member.username !== 'admin' && id !== 'u-admin', 422, 'MEMBER_PROTECTED', '初始管理员不能删除');
    const next = configSchema.parse({
      ...config,
      version: config.version + 1,
      users: config.users.filter(
        /** 从运行上下文中移除目标，供管理员与授权引用校验。
         * @param user 当前成员
         * @returns 是否保留
         */ function keep(user) {
          return user.id !== id;
        },
      ),
    });
    ensure(
      next.users.some(
        /** 保证删除后仍存在有效配置管理员。
         * @param user 剩余成员
         * @returns 是否具有管理资格
         */ function administrator(user) {
          return hasPermission(next, user.id, 'config:manage');
        },
      ),
      422,
      'LAST_ADMIN',
      '至少保留一个有效管理员',
    );
    const references: string[] = [];
    for (const department of config.departments)
      if (department.manager === id) references.push(`仍为“${department.name}”负责人，请先更换部门负责人`);
    references.push(...validateConfig(next));
    if (references.length)
      throw new HttpError(409, 'MEMBER_IN_USE', '成员仍有关联，请先处理或停用', [...new Set(references)]);
    references.push(...(await memberReferences(db, id)));
    if (references.length)
      throw new HttpError(409, 'MEMBER_IN_USE', '成员已有业务记录，请使用停用', references);
    await eraseMemberRecords(db, id);
    const envelope = JSON.stringify(configurationEnvelope(next));
    await db.execute(
      "UPDATE configuration SET published=?,draft=?,revision=revision+1,draft_revision=draft_revision+1 WHERE id='company'",
      [envelope, envelope],
    );
    await db.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      crypto.randomUUID(),
      actor,
      '删除未引用成员',
      JSON.stringify({
        memberId: id,
        username: member.username,
        name: member.name,
        department: member.department,
        mode: 'physical',
      }),
    ]);
    return loadConfig(db);
  }
  return transaction(pool, remove);
}

/** 删除已完成引用校验的成员及其私人运行数据，由调用方事务统一提交。
 * @param db 当前事务连接
 * @param id 待删除成员ID
 */
export async function eraseMemberRecords(db: PoolConnection, id: string): Promise<void> {
  await db.execute('DELETE FROM sessions WHERE member_id=?', [id]);
  await db.execute('DELETE FROM notifications WHERE recipient_id=?', [id]);
  await db.execute('DELETE FROM outbox_events WHERE recipient_id=?', [id]);
  await db.execute('DELETE FROM idempotency_records WHERE actor_id=?', [id]);
  await db.execute('DELETE FROM members WHERE id=?', [id]);
}
