import type { Pool, PoolConnection } from 'mysql2/promise';
import { activeMember, configSchema, findById, hasPermission, validateConfig } from '@workflow/domain';
import type { CompanyConfig, ConfigState } from '@workflow/domain';
import { loadConfig, materializeConfig, transaction } from '../db/repository';
import { ensure, HttpError } from '../errors';

/**
 * 保存配置草案，使用独立草案版本防止多人覆盖。
 * @param pool 连接池
 * @param actor 当前管理员
 * @param input 完整草案
 * @param expectedVersion 草案版本
 * @returns 最新状态
 */
export async function saveConfigDraft(
  pool: Pool,
  actor: string,
  input: unknown,
  expectedVersion: number,
): Promise<ConfigState> {
  const draft = configSchema.parse(input);
  /**
   * 在配置排他锁下更新草案与审计。
   * @param connection 事务连接
   * @returns 新配置状态
   */
  async function save(connection: PoolConnection): Promise<ConfigState> {
    const state = await loadConfig(connection, 'update');
    ensure(hasPermission(state.published, actor, 'config:manage'), 403, 'FORBIDDEN', '无配置管理权限');
    ensure(state.draftRevision === expectedVersion, 409, 'CONFIG_CONFLICT', '草案已被其他人修改，请重新加载');
    draft.version = state.published.version;
    await connection.execute('UPDATE configuration SET draft=?,draft_revision=draft_revision+1 WHERE id=?', [
      JSON.stringify(draft),
      'company',
    ]);
    await connection.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      crypto.randomUUID(),
      actor,
      '保存配置草案',
      JSON.stringify({ revision: expectedVersion + 1 }),
    ]);
    return { ...state, draft, draftRevision: expectedVersion + 1 };
  }
  return transaction(pool, save);
}

/**
 * 发布完整配置，保护系统字段、必要审核、已有账号标识和当前管理员资格。
 * @param pool 连接池
 * @param actor 发布人
 * @param expectedVersion 草案版本
 * @returns 新发布状态
 */
export async function publishConfig(
  pool: Pool,
  actor: string,
  expectedVersion: number,
): Promise<ConfigState> {
  /**
   * 锁定配置并校验引用，发布与组织物化同一事务提交。
   * @param connection 事务连接
   * @returns 已发布版本
   */
  async function publish(connection: PoolConnection): Promise<ConfigState> {
    const state = await loadConfig(connection, 'update');
    ensure(hasPermission(state.published, actor, 'config:manage'), 403, 'FORBIDDEN', '无发布权限');
    ensure(state.draftRevision === expectedVersion, 409, 'CONFIG_CONFLICT', '草案版本已变化');
    const config = configSchema.parse(state.draft);
    const errors = validateConfig(config);
    for (const field of state.published.form.fields)
      if (field.system) {
        let next;
        for (const candidate of config.form.fields) if (candidate.key === field.key) next = candidate;
        if (!next || next.type !== field.type || !next.system)
          errors.push(`系统字段${field.label}不能删除或改变类型`);
      }
    for (const node of state.published.workflow.nodes)
      if (node.protected) {
        const next = findById(config.workflow.nodes, node.id);
        if (!next?.protected || next.kind !== 'approval' || next.condition)
          errors.push(`必须保留必要审核${node.label}`);
      }
    for (const old of state.published.users)
      if (!findById(config.users, old.id)) errors.push(`${old.name}需使用停用而非删除，以保留历史身份`);
    ensure(
      activeMember(config, actor) && hasPermission(config, actor, 'config:manage'),
      422,
      'ADMIN_HANDOVER',
      '发布人需保留管理资格，权限交接请由另一名管理员完成',
    );
    if (errors.length) throw new HttpError(422, 'CONFIG_INVALID', '配置校验失败', errors);
    config.version = state.published.version + 1;
    await materializeConfig(connection, config);
    await connection.execute(
      'UPDATE configuration SET published=?,draft=?,revision=revision+1,draft_revision=draft_revision+1 WHERE id=?',
      [JSON.stringify(config), JSON.stringify(config), 'company'],
    );
    await connection.execute('INSERT INTO configuration_releases(version,data,actor) VALUES (?,?,?)', [
      config.version,
      JSON.stringify(config),
      actor,
    ]);
    await connection.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      crypto.randomUUID(),
      actor,
      '发布配置',
      JSON.stringify({ version: config.version }),
    ]);
    await connection.execute(
      'DELETE s FROM sessions s LEFT JOIN members m ON m.id=s.member_id WHERE m.id IS NULL OR m.active=FALSE',
    );
    return {
      published: config,
      draft: structuredClone(config),
      revision: state.revision + 1,
      draftRevision: state.draftRevision + 1,
    };
  }
  return transaction(pool, publish);
}
