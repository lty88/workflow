import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import {
  applicantForm,
  canSelectTemplate,
  defaultValues,
  findById,
  hasPermission,
  instantiateWorkflow,
  templateActiveSchema,
  templateContext,
  templateCreateSchema,
  templateDefinitionSchema,
  templateSelectionSchema,
  templateVersionCommandSchema,
  templateWriteSchema,
  validateTemplate,
} from '@workflow/domain';
import type { ActivityType, TemplateRelease } from '@workflow/domain';
import { ensure } from '../errors';
import { jsonValue, loadConfig, query } from '../db/repository';
import {
  loadActivityTypes,
  loadTemplate,
  loadTemplateRelease,
  loadTemplates,
} from '../db/template-repository';
import {
  availableTemplates,
  createTemplate,
  deleteTemplate,
  previewTemplate,
  publishTemplate,
  saveTemplate,
  setTemplateActive,
} from '../services/template-service';

/**
 * 从会话取得当前身份，并按需校验模板管理资格。
 * @param request 真实请求
 * @param admin 是否要求配置管理权限
 * @returns 当前成员标识
 */
function actor(request: FastifyRequest, admin = false): string {
  ensure(request.profile, 401, 'UNAUTHENTICATED', '请先登录');
  if (admin)
    ensure(request.profile.permissions.includes('config:manage'), 403, 'FORBIDDEN', '无流程模板管理权限');
  return request.profile.user.id;
}

/**
 * 解析模板资源标识，拒绝超长路由参数。
 * @param request HTTP请求
 * @returns 模板标识
 */
function templateId(request: FastifyRequest): string {
  return z.object({ id: z.string().min(1).max(80) }).parse(request.params).id;
}

/**
 * 注册模板目录、独立版本发布与管理员设计接口，复用全局会话和CSRF校验。
 * @param app 已建立认证钩子的HTTP应用
 * @param pool MySQL连接池
 */
export function registerTemplateRoutes(app: FastifyInstance, pool: Pool): void {
  /**
   * 查询当前申请人有模板可选的活动类型。
   * @param request HTTP请求
   * @returns 可用活动类型
   */
  async function types(request: FastifyRequest): Promise<ActivityType[]> {
    const config = (await loadConfig(pool)).published;
    const available = await availableTemplates(pool, config, actor(request));
    const result = [];
    for (const type of await loadActivityTypes(pool))
      if (type.active) {
        let included = false;
        for (const template of available)
          if (template.definition.activityTypeIds.includes(type.id)) included = true;
        if (included) result.push(type);
      }
    return result;
  }
  app.get('/api/activity-types', types);

  /**
   * 查询当前身份授权的发布模板，不返回管理员草稿。
   * @param request HTTP请求
   * @returns 模板摘要与冻结表单
   */
  async function list(request: FastifyRequest) {
    const input = z.object({ activityTypeId: z.string().max(80).optional(), businessType: z.enum(['activity','general']).optional() }).parse(request.query);
    return availableTemplates(pool, (await loadConfig(pool)).published, actor(request), input.activityTypeId, input.businessType);
  }
  app.get('/api/workflow-templates', list);

  /**
   * 返回申请人可选择的当前版本，历史版本仅管理员可读取。
   * @param request HTTP请求
   * @returns 模板发布快照
   */
  async function version(request: FastifyRequest) {
    const input = z
      .object({ id: z.string().min(1).max(80), version: z.coerce.number().int().positive() })
      .parse(request.params);
    const config = (await loadConfig(pool)).published;
    if (!hasPermission(config, actor(request), 'config:manage')) {
      const list = await availableTemplates(pool, config, actor(request));
      let allowed = false;
      for (const item of list) if (item.id === input.id && item.version === input.version) allowed = true;
      ensure(allowed, 404, 'NOT_FOUND', '模板版本不存在或无权查看');
    }
    const release = await loadTemplateRelease(pool, input.id, input.version);
    ensure(release, 404, 'NOT_FOUND', '模板发布版本不存在');
    return hasPermission(config, actor(request), 'config:manage')
      ? release
      : { ...release, form: applicantForm(config, actor(request), release.form) };
  }
  app.get('/api/workflow-templates/:id/versions/:version', version);

  /**
   * 计算选定模板当前发布版本的申请路线。
   * @param request HTTP请求
   * @returns 路线与校验错误
   */
  async function preview(request: FastifyRequest) {
    const body = templateSelectionSchema
      .extend({
        payload: z.record(z.string(), z.string().max(3000)),
        activityId: z.string().min(1).max(80).optional(),
      })
      .parse(request.body);
    ensure(body.templateId === templateId(request), 422, 'TEMPLATE_MISMATCH', '模板标识与请求不一致');
    return previewTemplate(pool, actor(request), body);
  }
  app.post('/api/workflow-templates/:id/preview', preview);

  /**
   * 为配置管理员提供模板草稿、活动类型与受理规则上下文。
   * @param request HTTP请求
   * @returns 模板配置目录
   */
  async function catalogue(request: FastifyRequest) {
    actor(request, true);
    return {
      items: await loadTemplates(pool),
      types: await loadActivityTypes(pool),
      config: (await loadConfig(pool)).published,
    };
  }
  app.get('/api/admin/workflow-templates', catalogue);

  /**
   * 读取模板发布历史，供管理员核对不可变定义和表单。
   * @param request HTTP请求
   * @returns 发布时间倒序的版本快照
   */
  async function history(request: FastifyRequest): Promise<TemplateRelease[]> {
    actor(request, true);
    const id = templateId(request);
    ensure(await loadTemplate(pool, id), 404, 'NOT_FOUND', '模板不存在');
    const rows = await query<{
      version: number;
      definition: unknown;
      form_snapshot: unknown;
      published_by: string;
      published_at: string;
    }>(
      pool,
      'SELECT version,definition,form_snapshot,published_by,published_at FROM workflow_template_releases WHERE template_id=? ORDER BY version DESC',
      [id],
    );
    const result: TemplateRelease[] = [];
    for (const row of rows)
      result.push({
        templateId: id,
        version: row.version,
        definition: jsonValue(row.definition),
        form: jsonValue(row.form_snapshot),
        publishedBy: row.published_by,
        publishedAt: row.published_at,
      });
    return result;
  }
  app.get('/api/admin/workflow-templates/:id/versions', history);

  /**
   * 新建或复制独立模板草稿。
   * @param request HTTP请求
   * @returns 新模板
   */
  async function create(request: FastifyRequest) {
    return createTemplate(pool, actor(request, true), templateCreateSchema.parse(request.body));
  }
  app.post('/api/admin/workflow-templates', create);

  /**
   * 乐观锁保存模板草稿，不影响已发布定义。
   * @param request HTTP请求
   * @returns 模板新草稿
   */
  async function save(request: FastifyRequest) {
    return saveTemplate(
      pool,
      actor(request, true),
      templateId(request),
      templateWriteSchema.parse(request.body),
    );
  }
  app.put('/api/admin/workflow-templates/:id/draft', save);

  /**
   * 发布服务端校验通过的模板新版本。
   * @param request HTTP请求
   * @returns 最新模板
   */
  async function publish(request: FastifyRequest) {
    return publishTemplate(
      pool,
      actor(request, true),
      templateId(request),
      templateVersionCommandSchema.parse(request.body),
    );
  }
  app.post('/api/admin/workflow-templates/:id/publish', publish);

  /**
   * 启停模板，业务提交会重新检查启用状态。
   * @param request HTTP请求
   * @returns 最新模板
   */
  async function active(request: FastifyRequest) {
    return setTemplateActive(
      pool,
      actor(request, true),
      templateId(request),
      templateActiveSchema.parse(request.body),
    );
  }
  app.post('/api/admin/workflow-templates/:id/active', active);
  /**
   * 删除无业务引用的未发布模板草稿。
   * @param request HTTP请求
   * @returns 删除结果
   */
  async function remove(request: FastifyRequest) {
    return deleteTemplate(
      pool,
      actor(request, true),
      templateId(request),
      templateVersionCommandSchema.parse(request.body),
    );
  }
  app.delete('/api/admin/workflow-templates/:id', remove);

  /**
   * 校验设计中的完整草稿并返回可定位的节点错误。
   * @param request HTTP请求
   * @returns 草稿校验结果
   */
  async function validate(request: FastifyRequest) {
    actor(request, true);
    const definition = templateDefinitionSchema.parse(request.body);
    return {
      errors: validateTemplate((await loadConfig(pool)).published, definition, await loadActivityTypes(pool)),
    };
  }
  app.post('/api/admin/workflow-templates/:id/validate', validate);

  /**
   * 按管理员指定的申请人和表单输入演算尚未发布的模板，不创建任务。
   * @param request HTTP请求
   * @returns 实际路线与当前组织校验错误
   */
  async function simulate(request: FastifyRequest) {
    actor(request, true);
    const body = z
      .object({
        definition: templateDefinitionSchema,
        applicant: z.string().min(1).max(80),
        payload: z.record(z.string(), z.string().max(3000)),
      })
      .strict()
      .parse(request.body);
    const config = (await loadConfig(pool)).published;
    const plan = instantiateWorkflow(
      templateContext(config, body.definition, config.form),
      { ...defaultValues(templateContext(config, body.definition, config.form).form), ...body.payload },
      body.applicant,
      { requireApproval: false },
    );
    if (!canSelectTemplate(config, body.applicant, body.definition))
      plan.errors.push('选中的申请人不在此模板授权范围内');
    const participants = [];
    for (const user of config.users) participants.push({ id: user.id, name: user.name });
    return { ...plan, participants };
  }
  app.post('/api/admin/workflow-templates/:id/preview', simulate);
}
