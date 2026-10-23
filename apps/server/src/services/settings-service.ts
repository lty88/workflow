import type { Pool, PoolConnection } from 'mysql2/promise';
import {
  activeMember,
  configSchema,
  findById,
  hasPermission,
  validateConfig,
  DEFAULT_PASSWORD,
} from '@workflow/domain';
import type { CompanyConfig, ConfigState } from '@workflow/domain';
import { z } from 'zod';
import { loadConfig, query, transaction } from '../db/repository';
import { configurationEnvelope } from '../db/master-data';
import { hashPassword } from './password';
import { ensure, HttpError } from '../errors';
export const settingsModuleSchema = z.enum(['organization', 'permissions', 'menus', 'forms']);
export type SettingsModule = z.infer<typeof settingsModuleSchema>;
const moduleShapes = {
  organization: z
    .object({
      departments: configSchema.shape.departments,
      users: configSchema.shape.users,
      roles: configSchema.shape.roles.optional(),
    })
    .strict(),
  permissions: z.object({ roles: configSchema.shape.roles }).strict(),
  menus: z
    .object({
      groups: configSchema.shape.groups,
      pages: configSchema.shape.pages,
      roles: configSchema.shape.roles,
    })
    .strict(),
  forms: z.object({ form: configSchema.shape.form }).strict(),
};
/**
 * 按模块直接保存主数据；共享技术修订号防止并发覆盖，不存在业务发布步骤。
 * @param pool 连接池
 * @param actor 当前管理员
 * @param module 设置模块
 * @param input 模块内容
 * @param expectedRevision 读取时的技术修订号
 * @returns 保存后的真实主数据上下文
 */
export async function saveSettings(
  pool: Pool,
  actor: string,
  module: SettingsModule,
  input: unknown,
  expectedRevision: number,
): Promise<ConfigState> {
  const changes = moduleShapes[module].parse(input);
  /** 锁定版本、校验关联并在同一事务内保存当前模块与审计。
   * @param db 事务连接
   * @returns 最新上下文
   */
  async function save(db: PoolConnection): Promise<ConfigState> {
    const state = await loadConfig(db, 'update');
    ensure(hasPermission(state.published, actor, 'config:manage'), 403, 'FORBIDDEN', '无设置管理权限');
    ensure(
      state.revision === expectedRevision,
      409,
      'CONFIG_CONFLICT',
      '设置已被其他人修改，请重新读取后再保存',
    );
    const next = configSchema.parse({ ...state.published, ...changes, version: state.published.version + 1 });
    const errors = validateConfig(next);
    ensure(
      activeMember(next, actor) && hasPermission(next, actor, 'config:manage'),
      422,
      'ADMIN_HANDOVER',
      '当前操作人必须保留管理权限，请由其他管理员完成交接',
    );
    // 历史身份保留；停用通过active字段直接提交。
    for (const old of state.published.users)
      if (!findById(next.users, old.id)) errors.push(`${old.name}请使用停用，以保留审批历史`);
    for (const field of state.published.form.fields)
      if (field.system) {
        const item = next.form.fields.find(
          /** 检查系统字段仍存在且类型稳定。
           * @param candidate 新字段
           * @returns 是否同一字段
           */ function match(candidate) {
            return candidate.key === field.key;
          },
        );
        if (!item?.system || item.type !== field.type)
          errors.push(`系统字段${field.label}不能删除或改变类型`);
      }
    // 独立模板保留的实体引用也需要检查，防止删除角色或部门后留下悬空引用。
    const templates = await query<{ draft: unknown; published: unknown }>(
      db,
      'SELECT draft,published FROM workflow_templates',
    );
    for (const row of templates)
      for (const raw of [row.draft, row.published])
        if (raw) {
          const definition = (
            typeof raw === 'string' ? JSON.parse(raw) : raw
          ) as import('@workflow/domain').TemplateDefinition;
          for (const id of definition.roleIds)
            if (!findById(next.roles, id)) errors.push('角色仍被流程模板使用，请先调整模板');
          for (const id of definition.departmentIds)
            if (!findById(next.departments, id)) errors.push('部门仍被流程模板使用，请先调整模板');
          for (const node of definition.nodes) {
            if (
              node.assignee.type === 'department_manager' &&
              !findById(next.departments, node.assignee.value)
            )
              errors.push(`${node.label}仍引用该部门`);
            if (node.assignee.type === 'role' && !findById(next.roles, node.assignee.value))
              errors.push(`${node.label}仍引用该角色`);
          }
        }
    if (errors.length) throw new HttpError(422, 'CONFIG_INVALID', '设置校验失败', [...new Set(errors)]);
    if (module === 'organization') {
      for (const department of next.departments)
        await db.execute(
          'INSERT INTO departments(id,parent_id,name,manager_id,active,data) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE parent_id=VALUES(parent_id),name=VALUES(name),manager_id=VALUES(manager_id),active=VALUES(active),data=VALUES(data)',
          [
            department.id,
            department.parent,
            department.name,
            department.manager,
            department.active,
            JSON.stringify(department),
          ],
        );
      for (const user of next.users) {
        const old = findById(state.published.users, user.id);
        if (old && JSON.stringify(old) === JSON.stringify(user)) continue;
        if (old)
          await db.execute(
            'UPDATE members SET username=?,name=?,department_id=?,active=?,roles=? WHERE id=?',
            [user.username, user.name, user.department, user.active, JSON.stringify(user.roles), user.id],
          );
        else
          await db.execute(
            'INSERT INTO members(id,username,name,department_id,active,roles,password_hash) VALUES (?,?,?,?,?,?,?)',
            [
              user.id,
              user.username,
              user.name,
              user.department,
              user.active,
              JSON.stringify(user.roles),
              await hashPassword(DEFAULT_PASSWORD),
            ],
          );
      }
      for (const old of state.published.departments)
        if (!findById(next.departments, old.id))
          await db.execute('DELETE FROM departments WHERE id=?', [old.id]);
    }
    if ('roles' in changes) {
      for (const role of next.roles)
        await db.execute(
          'INSERT INTO roles(id,name,data) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),data=VALUES(data)',
          [role.id, role.name, JSON.stringify(role)],
        );
      for (const old of state.published.roles)
        if (!findById(next.roles, old.id)) await db.execute('DELETE FROM roles WHERE id=?', [old.id]);
    }
    if (module === 'menus') {
      for (let i = 0; i < next.groups.length; i++) {
        const g = next.groups[i]!;
        await db.execute(
          'INSERT INTO menu_groups(id,name,active,sort_order) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),active=VALUES(active),sort_order=VALUES(sort_order)',
          [g.id, g.name, g.active, i],
        );
      }
      for (let i = 0; i < next.pages.length; i++) {
        const p = next.pages[i]!;
        await db.execute(
          'INSERT INTO menu_pages(id,name,active,data,sort_order) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),active=VALUES(active),data=VALUES(data),sort_order=VALUES(sort_order)',
          [p.id, p.name, p.active, JSON.stringify(p), i],
        );
      }
      for (const old of state.published.pages)
        if (!findById(next.pages, old.id)) await db.execute('DELETE FROM menu_pages WHERE id=?', [old.id]);
      for (const old of state.published.groups)
        if (!findById(next.groups, old.id)) await db.execute('DELETE FROM menu_groups WHERE id=?', [old.id]);
    }
    if (module === 'forms') {
      ensure(next.form.id === state.published.form.id, 422, 'FORM_ID_FIXED', '表单标识不可更改');
      const forms = await query<{ version: number }>(
        db,
        'SELECT version FROM form_definitions WHERE id=? FOR UPDATE',
        [next.form.id],
      );
      const version = (forms[0]?.version ?? 0) + 1;
      await db.execute(
        'UPDATE form_definitions SET version=?,definition=?,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?',
        [version, JSON.stringify(next.form), actor, next.form.id],
      );
      await db.execute(
        'INSERT INTO form_definition_versions(form_id,version,definition,actor_id) VALUES (?,?,?,?)',
        [next.form.id, version, JSON.stringify(next.form), actor],
      );
    }
    const envelope = JSON.stringify(configurationEnvelope(next));
    await db.execute(
      "UPDATE configuration SET published=?,draft=?,revision=revision+1,draft_revision=draft_revision+1 WHERE id='company'",
      [envelope, envelope],
    );
    await db.execute(
      'DELETE s FROM sessions s LEFT JOIN members m ON m.id=s.member_id WHERE m.id IS NULL OR m.active=FALSE',
    );
    await db.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      crypto.randomUUID(),
      actor,
      '保存模块设置',
      JSON.stringify({ module, revision: state.revision + 1 }),
    ]);
    return loadConfig(db);
  }
  return transaction(pool, save);
}
