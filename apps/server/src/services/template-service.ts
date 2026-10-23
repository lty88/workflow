import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import type { z } from 'zod';
import {
  activityActions,
  editableTemplateDefinition,
  firstTemplateNode,
  preserveFormAccess,
  mergeWritablePayload,
  applicantForm,
  canSelectTemplate,
  defaultTemplateConflicts,
  findById,
  hasPermission,
  instantiateWorkflow,
  templateContext,
  validateForm,
  validateTemplate,
} from '@workflow/domain';
import type {
  CompanyConfig,
  TemplateDefinition,
  TemplateRelease,
  TemplateSelection,
  TemplateSummary,
  WorkflowTemplate,
  templateActiveSchema,
  templateCreateSchema,
  templateVersionCommandSchema,
  templateWriteSchema,
} from '@workflow/domain';
import { ensure, HttpError } from '../errors';
import { jsonValue, loadActivity, loadConfig, query, transaction } from '../db/repository';
import type { Database } from '../db/repository';
import {
  loadActivityTypes,
  loadTemplate,
  loadTemplateRelease,
  loadTemplates,
} from '../db/template-repository';
import { digest } from './auth';

/**
 * 查询申请人可选择的已发布模板，过滤类型、组织范围和账号权限。
 * @param db 数据库连接
 * @param config 当前发布配置
 * @param actor 当前申请人
 * @param activityTypeId 可选活动类型
 * @returns 带冻结表单的可用模板
 */
export async function availableTemplates(
  db: Database,
  config: CompanyConfig,
  actor: string,
  activityTypeId?: string,
): Promise<TemplateSummary[]> {
  const types = await loadActivityTypes(db);
  const result: TemplateSummary[] = [];
  for (const template of await loadTemplates(db)) {
    if (
      !template.active ||
      !template.currentVersion ||
      !template.published ||
      !canSelectTemplate(config, actor, template.published, activityTypeId)
    )
      continue;
    if (activityTypeId && !findById(types, activityTypeId)?.active) continue;
    const release = await loadTemplateRelease(db, template.id, template.currentVersion);
    if (release)
      result.push({
        id: template.id,
        code: template.code,
        version: release.version,
        definition: release.definition,
        form: applicantForm(config, actor, release.form),
      });
  }
  return result;
}

/**
 * 在活动事务中锁定模板发布指针并核对选择版本；旧草稿无选择时推荐默认标准模板。
 * @param db 活动事务连接
 * @param config 当前发布组织
 * @param actor 真实申请人
 * @param input 模板选择，旧客户端可省略整组
 * @returns 经过授权与版本核对的模板发布快照及类型
 */
export async function selectTemplate(
  db: Database,
  config: CompanyConfig,
  actor: string,
  input: Partial<TemplateSelection>,
): Promise<TemplateRelease & { activityTypeId: string }> {
  let { activityTypeId, templateId, expectedTemplateVersion } = input;
  if (!templateId && !activityTypeId) {
    const available = await availableTemplates(db, config, actor, 'teaching');
    let recommended: TemplateSummary | undefined;
    for (const item of available)
      if (item.definition.defaultForTypeIds.includes('teaching')) recommended = item;
    ensure(recommended, 422, 'TEMPLATE_REQUIRED', '请选择活动类型和可用流程模板');
    activityTypeId = 'teaching';
    templateId = recommended.id;
    expectedTemplateVersion = recommended.version;
  }
  ensure(
    activityTypeId && templateId && expectedTemplateVersion,
    422,
    'TEMPLATE_REQUIRED',
    '请选择活动类型、模板并预览当前版本',
  );
  const types = await loadActivityTypes(db);
  ensure(findById(types, activityTypeId)?.active, 422, 'TYPE_UNAVAILABLE', '活动类型已停用或不存在');
  const template = await loadTemplate(db, templateId, 'share');
  ensure(
    template?.active && template.published && template.currentVersion,
    422,
    'TEMPLATE_UNAVAILABLE',
    '模板已停用或尚未发布，请重新选择',
  );
  ensure(
    canSelectTemplate(config, actor, template.published, activityTypeId),
    403,
    'TEMPLATE_FORBIDDEN',
    '无权使用该活动类型的流程模板',
  );
  ensure(
    template.currentVersion === expectedTemplateVersion,
    409,
    'TEMPLATE_VERSION_CONFLICT',
    '流程模板已更新，请重新读取并预览最新路线',
  );
  const release = await loadTemplateRelease(db, template.id, expectedTemplateVersion);
  ensure(release, 422, 'TEMPLATE_UNAVAILABLE', '模板发布版本不存在');
  return { ...release, activityTypeId };
}

/**
 * 使用已发布模板计算路线，编辑旧单时在服务端合并只读原值，不生成工单。
 * @param pool 数据库连接池
 * @param actor 真实申请人
 * @param input 选择与填写内容
 * @returns 实际节点、参与人、表单错误和模板版本
 */
export async function previewTemplate(
  pool: Pool,
  actor: string,
  input: Partial<TemplateSelection> & { payload: Record<string, string>; activityId?: string },
) {
  /**
   * 在一致事务中读取发布指针、组织与冻结表单。
   * @param connection 事务连接
   * @returns 路线预览
   */
  async function preview(connection: PoolConnection) {
    const config = (await loadConfig(connection, 'share')).published;
    const release = await selectTemplate(connection, config, actor, input);
    let form = release.form;
    let payload = input.payload;
    if (input.activityId) {
      const activity = await loadActivity(connection, input.activityId);
      ensure(
        activity && activityActions(config, actor, activity).includes('edit'),
        404,
        'NOT_FOUND',
        '活动不存在或无编辑权限',
      );
      form = preserveFormAccess(activity.schema, form);
      payload = mergeWritablePayload(config, actor, activity, form, input.payload);
    }
    const checked = validateForm(form, payload);
    const plan = instantiateWorkflow(
      templateContext(config, release.definition, form),
      checked.payload,
      actor,
      { requireApproval: false },
    );
    const participants = [];
    const seen = new Set<string>();
    for (const node of plan.nodes)
      for (const id of node.assignees)
        if (!seen.has(id)) {
          seen.add(id);
          participants.push({ id, name: findById(config.users, id)?.name || id });
        }
    return {
      nodes: plan.nodes,
      participants,
      errors: [...checked.errors, ...plan.errors],
      templateId: release.templateId,
      templateVersion: release.version,
    };
  }
  return transaction(pool, preview);
}

/**
 * 执行管理员模板写入；目录锁串行化默认模板校验，幂等记录支持网络重试。
 * @param pool 数据库连接池
 * @param actor 当前管理员
 * @param key 幂等键
 * @param fingerprint 请求摘要
 * @param work 事务业务
 * @returns 已提交的业务结果
 */
async function mutateTemplate<T>(
  pool: Pool,
  actor: string,
  key: string,
  fingerprint: string,
  work: (db: PoolConnection, config: CompanyConfig) => Promise<T>,
): Promise<T> {
  /**
   * 在组织共享锁和目录排他锁下保存模板与幂等响应。
   * @param db 事务连接
   * @returns 业务结果
   */
  async function apply(db: PoolConnection): Promise<T> {
    const config = (await loadConfig(db, 'share')).published;
    ensure(hasPermission(config, actor, 'config:manage'), 403, 'FORBIDDEN', '无流程模板管理权限');
    const hash = digest(fingerprint);
    const [reserved] = await db.execute<ResultSetHeader>(
      'INSERT IGNORE INTO idempotency_records(actor_id,request_key,request_hash) VALUES (?,?,?)',
      [actor, key, hash],
    );
    if (!reserved.affectedRows) {
      const rows = await query<{ request_hash: string; response: unknown }>(
        db,
        'SELECT request_hash,response FROM idempotency_records WHERE actor_id=? AND request_key=? FOR UPDATE',
        [actor, key],
      );
      ensure(rows[0]?.request_hash === hash, 409, 'IDEMPOTENCY_CONFLICT', '同一请求标识不能用于不同模板操作');
      ensure(rows[0]?.response, 409, 'REQUEST_PENDING', '请求处理中，请重试');
      return jsonValue<T>(rows[0].response);
    }
    const catalogueLock = await query(
      db,
      "SELECT id FROM template_catalog_lock WHERE id='catalog' FOR UPDATE",
    );
    ensure(
      catalogueLock.length === 1,
      503,
      'TEMPLATE_MIGRATION_REQUIRED',
      '模板目录锁尚未初始化，请执行 pnpm db:migrate',
    );
    const result = await work(db, config);
    await db.execute('UPDATE idempotency_records SET response=? WHERE actor_id=? AND request_key=?', [
      JSON.stringify(result),
      actor,
      key,
    ]);
    return result;
  }
  return transaction(pool, apply);
}

/**
 * 在写事务中校验模板草稿版本并锁住模板。
 * @param db 事务连接
 * @param id 模板标识
 * @param revision 期望草稿版本
 * @returns 已锁定的模板
 */
async function editableTemplate(db: PoolConnection, id: string, revision: number): Promise<WorkflowTemplate> {
  const template = await loadTemplate(db, id, 'update');
  ensure(template, 404, 'NOT_FOUND', '流程模板不存在');
  ensure(
    template.draftRevision === revision,
    409,
    'TEMPLATE_DRAFT_CONFLICT',
    '模板草稿已被其他人修改，请重新读取',
  );
  return template;
}

/**
 * 记录模板管理审计，不将操作人或业务定义交给客户端伪造。
 * @param db 事务连接
 * @param actor 操作人
 * @param id 模板标识
 * @param action 操作名称
 * @param note 操作信息
 */
async function auditTemplate(
  db: PoolConnection,
  actor: string,
  id: string,
  action: string,
  note: unknown,
): Promise<void> {
  await db.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
    crypto.randomUUID(),
    actor,
    action,
    JSON.stringify({ templateId: id, note }),
  ]);
}

/**
 * 按可选首节点类型或已有模板创建独立可编辑草稿，限制模板目录规模。
 * @param pool 数据库连接池
 * @param actor 管理员
 * @param body 新编码与可选复制源
 * @returns 新模板
 */
export async function createTemplate(
  pool: Pool,
  actor: string,
  body: z.infer<typeof templateCreateSchema>,
): Promise<WorkflowTemplate> {
  /**
   * 在目录锁下检查编码唯一并插入草稿，不复制业务实例。
   * @param db 事务连接
   * @returns 新模板
   */
  async function create(db: PoolConnection): Promise<WorkflowTemplate> {
    const existing = await loadTemplates(db);
    ensure(existing.length < 100, 422, 'TEMPLATE_LIMIT', '最多维护100套流程模板');
    for (const item of existing)
      ensure(item.code !== body.code, 422, 'TEMPLATE_CODE_EXISTS', '模板编码已存在');
    const types = await loadActivityTypes(db);
    ensure(types[0], 422, 'TYPE_REQUIRED', '请先配置至少一个活动类型');
    const definition: TemplateDefinition = {
      name: '新活动流程',
      activityTypeIds: [types[0]!.id],
      defaultForTypeIds: [],
      departmentIds: [],
      roleIds: [],
      nodes: [firstTemplateNode(body.firstNodeKind || 'approval')],
      layout: { direction: 'TB', positions: {} },
    };
    if (body.sourceId) {
      const source = await loadTemplate(db, body.sourceId);
      ensure(source, 404, 'NOT_FOUND', '复制源模板不存在');
      Object.assign(definition, editableTemplateDefinition(source.published || source.draft));
      definition.name = definition.name.slice(0, 74) + '（副本）';
      definition.defaultForTypeIds = [];
    }
    const id = crypto.randomUUID();
    await db.execute(
      'INSERT INTO workflow_templates(id,code,active,current_version,draft_revision,draft,published,created_by) VALUES (?,?,TRUE,0,1,?,NULL,?)',
      [id, body.code, JSON.stringify(definition), actor],
    );
    await auditTemplate(db, actor, id, '创建流程模板', { code: body.code, sourceId: body.sourceId });
    return (await loadTemplate(db, id))!;
  }
  return mutateTemplate(pool, actor, body.idempotencyKey, `template:create:${JSON.stringify(body)}`, create);
}

/**
 * 保存独立模板草稿，草稿不改变当前已发布路线。
 * @param pool 数据库连接池
 * @param actor 管理员
 * @param id 模板标识
 * @param body 定义、草稿版本和幂等键
 * @returns 最新模板
 */
export async function saveTemplate(
  pool: Pool,
  actor: string,
  id: string,
  body: z.infer<typeof templateWriteSchema>,
): Promise<WorkflowTemplate> {
  /**
   * 校验乐观锁后写入草稿；未配置完整的节点允许草稿保存。
   * @param db 事务连接
   * @returns 新草稿
   */
  async function save(db: PoolConnection): Promise<WorkflowTemplate> {
    await editableTemplate(db, id, body.expectedDraftRevision);
    await db.execute(
      'UPDATE workflow_templates SET draft=?,draft_revision=draft_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?',
      [JSON.stringify(editableTemplateDefinition(body.definition)), id],
    );
    await auditTemplate(db, actor, id, '保存流程模板草稿', { revision: body.expectedDraftRevision + 1 });
    return (await loadTemplate(db, id))!;
  }
  return mutateTemplate(
    pool,
    actor,
    body.idempotencyKey,
    `template:save:${id}:${JSON.stringify(body)}`,
    save,
  );
}

/**
 * 发布自由编排的模板新版本，冻结定义与表单，保留旧版本及在途实例。
 * @param pool 数据库连接池
 * @param actor 管理员
 * @param id 模板标识
 * @param body 期望草稿版本与幂等键
 * @returns 最新模板
 */
export async function publishTemplate(
  pool: Pool,
  actor: string,
  id: string,
  body: z.infer<typeof templateVersionCommandSchema>,
): Promise<WorkflowTemplate> {
  /**
   * 在同一事务中验证全分支、默认冲突并写入版本与类型绑定。
   * @param db 事务连接
   * @param config 当前组织配置
   * @returns 已发布模板
   */
  async function publish(db: PoolConnection, config: CompanyConfig): Promise<WorkflowTemplate> {
    const template = await editableTemplate(db, id, body.expectedDraftRevision);
    const errors = validateTemplate(config, template.draft, await loadActivityTypes(db));
    const others: TemplateDefinition[] = [];
    for (const other of await loadTemplates(db))
      if (other.id !== id && other.active && other.published) others.push(other.published);
    if (template.active) errors.push(...defaultTemplateConflicts(config, template.draft, others));
    if (errors.length) throw new HttpError(422, 'TEMPLATE_INVALID', '模板发布校验失败', errors);
    const version = template.currentVersion + 1;
    await db.execute(
      'INSERT INTO workflow_template_releases(template_id,version,definition,form_snapshot,published_by) VALUES (?,?,?,?,?)',
      [id, version, JSON.stringify(template.draft), JSON.stringify(config.form), actor],
    );
    await db.execute(
      'UPDATE workflow_templates SET published=?,current_version=?,draft_revision=draft_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?',
      [JSON.stringify(template.draft), version, id],
    );
    await db.execute('DELETE FROM activity_type_templates WHERE template_id=?', [id]);
    for (const type of template.draft.activityTypeIds)
      await db.execute(
        'INSERT INTO activity_type_templates(activity_type_id,template_id,is_default) VALUES (?,?,?)',
        [type, id, template.draft.defaultForTypeIds.includes(type)],
      );
    await auditTemplate(db, actor, id, '发布流程模板', { version, name: template.draft.name });
    return (await loadTemplate(db, id))!;
  }
  return mutateTemplate(
    pool,
    actor,
    body.idempotencyKey,
    `template:publish:${id}:${JSON.stringify(body)}`,
    publish,
  );
}

/**
 * 启停模板，新申请重新核验，在途实例不回写。
 * @param pool 数据库连接池
 * @param actor 管理员
 * @param id 模板标识
 * @param body 启停状态与草稿版本
 * @returns 最新模板
 */
export async function setTemplateActive(
  pool: Pool,
  actor: string,
  id: string,
  body: z.infer<typeof templateActiveSchema>,
): Promise<WorkflowTemplate> {
  /**
   * 检查启用后的默认范围冲突，再更新可用状态并审计。
   * @param db 事务连接
   * @param config 当前组织配置
   * @returns 更新模板
   */
  async function change(db: PoolConnection, config: CompanyConfig): Promise<WorkflowTemplate> {
    const template = await editableTemplate(db, id, body.expectedDraftRevision);
    const others: TemplateDefinition[] = [];
    for (const item of await loadTemplates(db))
      if (item.id !== id && item.active && item.published) others.push(item.published);
    if (body.active && template.published) {
      const errors = defaultTemplateConflicts(config, template.published, others);
      if (errors.length) throw new HttpError(422, 'DEFAULT_TEMPLATE_CONFLICT', '默认模板冲突', errors);
    }
    await db.execute(
      'UPDATE workflow_templates SET active=?,draft_revision=draft_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?',
      [body.active, id],
    );
    await auditTemplate(
      db,
      actor,
      id,
      body.active ? '启用流程模板' : '停用流程模板',
      '在途实例继续使用原快照；停用后该类型可能暂无可选模板',
    );
    return (await loadTemplate(db, id))!;
  }
  return mutateTemplate(
    pool,
    actor,
    body.idempotencyKey,
    `template:active:${id}:${JSON.stringify(body)}`,
    change,
  );
}

/**
 * 删除从未发布且未被活动引用的草稿，已发布模板只允许停用。
 * @param pool 数据库连接池
 * @param actor 管理员
 * @param id 模板标识
 * @param body 草稿版本和幂等键
 * @returns 删除完成标记
 */
export async function deleteTemplate(
  pool: Pool,
  actor: string,
  id: string,
  body: z.infer<typeof templateVersionCommandSchema>,
): Promise<{ ok: boolean }> {
  /**
   * 锁定草稿并检查活动与发布历史引用，保留删除操作审计。
   * @param db 事务连接
   * @returns 删除结果
   */
  async function remove(db: PoolConnection): Promise<{ ok: boolean }> {
    const template = await editableTemplate(db, id, body.expectedDraftRevision);
    ensure(template.currentVersion === 0, 422, 'TEMPLATE_PUBLISHED', '已发布模板请使用停用，以保留历史');
    const activities = await query(db, 'SELECT id FROM activities WHERE template_id=? LIMIT 1', [id]);
    const releases = await query(
      db,
      'SELECT version FROM workflow_template_releases WHERE template_id=? LIMIT 1',
      [id],
    );
    ensure(
      !activities.length && !releases.length,
      422,
      'TEMPLATE_REFERENCED',
      '模板已被业务或发布历史引用，请使用停用',
    );
    await db.execute('DELETE FROM activity_type_templates WHERE template_id=?', [id]);
    await db.execute('DELETE FROM workflow_templates WHERE id=?', [id]);
    await auditTemplate(db, actor, id, '删除未发布模板草稿', {
      code: template.code,
      name: template.draft.name,
    });
    return { ok: true };
  }
  return mutateTemplate(
    pool,
    actor,
    body.idempotencyKey,
    `template:delete:${id}:${JSON.stringify(body)}`,
    remove,
  );
}
