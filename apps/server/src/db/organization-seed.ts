import type { Pool, PoolConnection } from 'mysql2/promise';
import { configSchema, supplementCommonOrganization, validateConfig } from '@workflow/domain';
import type { CompanyConfig } from '@workflow/domain';
import { loadConfig, query, transaction } from './repository';

export interface OrganizationSeedResult {
  updated: boolean;
  draftUpdated: boolean;
  version: number;
  addedDepartments: string[];
  addedRoles: string[];
  totalDepartments: number;
  totalMembers: number;
}

/**
 * 校验补齐后的组织引用，避免将无效配置写入发布版本或草案。
 * @param input 补齐后的配置
 * @param label 配置来源说明
 * @returns 通过结构及业务规则校验的配置
 */
function checkedConfig(input: CompanyConfig, label: string): CompanyConfig {
  const config = configSchema.parse(input);
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`${label}校验失败：${errors.join('；')}`);
  return config;
}

/**
 * 在数据库中批量补齐常用部门和岗位角色，独立保留发布配置与草案，不新增或修改成员账号。
 * @param pool 当前项目数据库连接池
 * @returns 新增部门、岗位、发布版本与现有成员数量
 */
export async function seedCommonOrganization(pool: Pool): Promise<OrganizationSeedResult> {
  /**
   * 锁定公司配置后增量写入部门、角色、发布快照和审计，失败时由外层事务回滚。
   * @param connection 事务数据库连接
   * @returns 已提交内容的组织补齐摘要
   */
  async function seed(connection: PoolConnection): Promise<OrganizationSeedResult> {
    if ((await query(connection, 'SELECT version FROM schema_migrations WHERE version=6')).length)
      throw new Error('主数据升级后请在组织架构页使用补齐功能并直接保存，旧整包种子入口已停用');
    const state = await loadConfig(connection, 'update');
    const publishedResult = supplementCommonOrganization(state.published);
    const draftResult = supplementCommonOrganization(state.draft);
    const updated = Boolean(publishedResult.addedDepartments.length || publishedResult.addedRoles.length);
    const draftUpdated =
      updated || Boolean(draftResult.addedDepartments.length || draftResult.addedRoles.length);
    const version = state.published.version + Number(updated);
    const result: OrganizationSeedResult = {
      updated,
      draftUpdated,
      version,
      addedDepartments: [],
      addedRoles: [],
      totalDepartments: publishedResult.config.departments.length,
      totalMembers: state.published.users.length,
    };
    for (const department of publishedResult.addedDepartments) result.addedDepartments.push(department.name);
    for (const role of publishedResult.addedRoles) result.addedRoles.push(role.name);
    if (!draftUpdated) return result;
    publishedResult.config.version = version;
    draftResult.config.version = version;
    const published = checkedConfig(publishedResult.config, '发布组织');
    const draft = checkedConfig(draftResult.config, '组织草案');
    for (const department of publishedResult.addedDepartments)
      await connection.execute(
        'INSERT INTO departments(id,parent_id,name,manager_id,active,data) VALUES (?,?,?,?,?,?)',
        [
          department.id,
          department.parent,
          department.name,
          department.manager,
          department.active,
          JSON.stringify(department),
        ],
      );
    for (const role of publishedResult.addedRoles)
      await connection.execute('INSERT INTO roles(id,name,data) VALUES (?,?,?)', [
        role.id,
        role.name,
        JSON.stringify(role),
      ]);
    await connection.execute(
      'UPDATE configuration SET published=?,draft=?,revision=revision+?,draft_revision=draft_revision+1 WHERE id=?',
      [JSON.stringify(published), JSON.stringify(draft), Number(updated), 'company'],
    );
    if (updated)
      await connection.execute('INSERT INTO configuration_releases(version,data,actor) VALUES (?,?,?)', [
        version,
        JSON.stringify(published),
        'system:organization-seed',
      ]);
    await connection.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      crypto.randomUUID(),
      'system:organization-seed',
      '批量补齐常用部门',
      JSON.stringify({ ...result, previousVersion: state.published.version }),
    ]);
    return result;
  }
  return transaction(pool, seed);
}
