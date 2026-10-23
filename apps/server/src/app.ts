import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolConnection } from 'mysql2/promise';
import {
  fileAccessInputSchema,
  activityDeleteSchema,
  fileAccessWriteSchema,
  actionSchema,
  adjustmentSchema,
  canReadActivity,
  decisionSchema,
  draftSchema,
  findById,
  hasPermission,
  listQuerySchema,
  loginSchema,
  pageAllowed,
  passwordSchema,
  RuleViolation,
  transferSchema,
  submitSchema,
} from '@workflow/domain';
import type { SessionProfile, FileAccessInput, Notification } from '@workflow/domain';
import type { Environment } from './env';
import { ensure, HttpError } from './errors';
import { batchMembers } from './services/member-batch-service';
import { deleteMember, memberDeleteSchema } from './services/member-deletion';
import { saveSettings, settingsModuleSchema } from './services/settings-service';
import { activityFiles, loadActivity, loadConfig, query, transaction } from './db/repository';
import { digest, hashPassword, login, sessionProfile, verifyPassword } from './services/auth';
import {
  createDraft,
  getDetail,
  handleAction,
  handleAdjustment,
  handleDecision,
  handleTransfer,
  submitActivity,
  updateDraft,
} from './services/activity-service';

import { deleteActivity } from './services/activity-deletion-service';
import { listActivities } from './services/list-service';
import type { ActivityListItem } from './services/list-service';
import { uploadFile, authorizeFileRead, updateFileAccess } from './services/file-service';
import { isAllowedOrigin } from './services/origin';
import { registerInsightsRoutes } from './routes/insights';
import { notificationFeed } from './services/notification-service';
import { registerTemplateRoutes } from './routes/templates';
import { previewTemplate } from './services/template-service';

declare module 'fastify' {
  interface FastifyRequest {
    profile: SessionProfile | null;
  }
}

/**
 * 从路由参数取得受长度约束的资源标识。
 * @param request HTTP请求
 * @returns 资源标识
 */
function resourceId(request: FastifyRequest): string {
  return z.object({ id: z.string().min(1).max(80) }).parse(request.params).id;
}

/**
 * 从请求中取得真实会话成员，客户端不能指定操作者。
 * @param request HTTP请求
 * @returns 当前成员标识
 */
function actorId(request: FastifyRequest): string {
  ensure(request.profile, 401, 'UNAUTHENTICATED', '请先登录');
  return request.profile.user.id;
}

/**
 * 检查配置管理员能力。
 * @param request 当前请求
 */
function requireAdmin(request: FastifyRequest): void {
  ensure(request.profile?.permissions.includes('config:manage'), 403, 'FORBIDDEN', '无配置管理权限');
}

/**
 * 读取请求幂等键，创建草稿与文件上传必须显式提供。
 * @param request 当前请求
 * @returns 幂等标识
 */
function requestKey(request: FastifyRequest): string {
  return z.string().min(16).max(100).parse(request.headers['idempotency-key']);
}

/**
 * 安全导出CSV单元格，防止表格软件将文本当作公式。
 * @param value 单元格文本
 * @returns 已转义文本
 */
function csvCell(value: string): string {
  const safe = /^\s*[=+\-@]|^[\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}

/**
 * 创建可注入测试的HTTP应用，不在此函数内监听端口或初始化数据库。
 * @param pool MySQL连接池
 * @param env 环境配置
 * @returns 已注册接口的应用
 */
export async function buildApp(pool: Pool, env: Environment) {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers.x-csrf-token'] },
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(helmet);
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 5 } });
  app.decorateRequest('profile', null);

  /**
   * 验证写入来源及内部会话和CSRF令牌，仅指定公开评价路由豁免账号认证。
   * @param request 请求
   * @param reply 响应，禁止缓存会话及敏感内容
   */
  async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    reply.header('Cache-Control', 'private, no-store');
    const path = request.url.split('?')[0]!;
    const writing = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (writing && request.headers.origin)
      ensure(
        isAllowedOrigin(request.headers.origin, env) ||
          (request.routeOptions.config.publicEvaluation === true &&
            !!env.PUBLIC_APP_URL &&
            isAllowedOrigin(request.headers.origin, {
              ...env,
              APP_ORIGIN: env.PUBLIC_APP_URL,
            })),
        403,
        'ORIGIN_REJECTED',
        '请求来源不被允许，请使用配置的前端地址访问',
      );
    if (
      path === '/api/auth/login' ||
      path === '/api/health' ||
      request.routeOptions.config.publicEvaluation === true
    )
      return;
    request.profile = await sessionProfile(pool, request.cookies.workflow_session);
    if (writing) {
      const token = request.headers['x-csrf-token'];
      const expected = request.profile.csrfToken;
      ensure(
        typeof token === 'string' &&
          /^[a-f0-9]{64}$/.test(token) &&
          token.length === expected.length &&
          timingSafeEqual(Buffer.from(token), Buffer.from(expected)),
        403,
        'CSRF_REJECTED',
        '会话校验失败，请刷新后重试',
      );
    }
  }
  app.addHook('onRequest', authenticate);
  registerTemplateRoutes(app, pool);
  registerInsightsRoutes(app, pool, env);

  /**
   * 将校验与业务错误转换成统一响应，内部异常不暴露SQL或密码。
   * @param error 异常
   * @param request 当前请求
   * @param reply 响应
   */
  async function handleError(
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (error instanceof ZodError) {
      const details: string[] = [];
      for (const issue of error.issues) details.push(`${issue.path.join('.')}: ${issue.message}`);
      await reply.code(422).send({ error: { code: 'VALIDATION', message: '请求参数不符合要求', details } });
      return;
    }
    if (error instanceof HttpError) {
      await reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    if (error instanceof RuleViolation) {
      await reply
        .code(error.code === 'FORBIDDEN' ? 403 : error.code === 'CONFLICT' ? 409 : 422)
        .send({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error.statusCode && error.statusCode < 500) {
      await reply.code(error.statusCode).send({
        error: {
          code: error.code || 'REQUEST_ERROR',
          message: error.statusCode === 429 ? '操作过于频繁，请稍后再试' : error.message,
        },
      });
      return;
    }
    request.log.error({ code: error.code, name: error.name }, '请求处理失败');
    await reply
      .code(503)
      .send({ error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，请检查数据库配置或稍后重试' } });
  }
  app.setErrorHandler(handleError);

  /**
   * 返回服务存活状态，不访问用户数据库。
   * @returns 存活标记
   */
  async function health() {
    return { status: 'ok' };
  }
  app.get('/api/health', health);

  /**
   * 校验账号密码并写入HttpOnly会话Cookie。
   * @param request 请求
   * @param reply 响应
   * @returns 会话资料
   */
  async function signIn(request: FastifyRequest, reply: FastifyReply) {
    const body = loginSchema.parse(request.body);
    const session = await login(pool, env, body.username, body.password);
    reply.setCookie('workflow_session', session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: env.NODE_ENV === 'production',
      maxAge: env.SESSION_HOURS * 3600,
    });
    return session.profile;
  }
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, signIn);

  /**
   * 获取最新授权后的登录资料。
   * @param request 请求
   * @returns 当前账号、菜单及CSRF令牌
   */
  async function me(request: FastifyRequest) {
    return request.profile;
  }
  app.get('/api/auth/me', me);

  /**
   * 撤销服务端会话并清理Cookie。
   * @param request 请求
   * @param reply 响应
   * @returns 退出结果
   */
  async function signOut(request: FastifyRequest, reply: FastifyReply) {
    await pool.execute('DELETE FROM sessions WHERE token_hash=?', [
      digest(request.cookies.workflow_session || ''),
    ]);
    reply.clearCookie('workflow_session', { path: '/' });
    return { ok: true };
  }
  app.post('/api/auth/logout', signOut);

  /**
   * 校验旧密码后更新本人密码，并撤销全部会话。
   * @param request 请求
   * @param reply 响应
   * @returns 更新结果
   */
  async function changePassword(request: FastifyRequest, reply: FastifyReply) {
    const body = z
      .object({ currentPassword: z.string().min(1).max(200), password: passwordSchema.shape.password })
      .strict()
      .parse(request.body);
    const rows = await query<{ password_hash: string }>(
      pool,
      'SELECT password_hash FROM members WHERE id=?',
      [actorId(request)],
    );
    ensure(
      rows[0] && (await verifyPassword(body.currentPassword, rows[0].password_hash || '')),
      422,
      'PASSWORD_INVALID',
      '原密码错误',
    );
    await pool.execute('UPDATE members SET password_hash=? WHERE id=?', [
      await hashPassword(body.password),
      actorId(request),
    ]);
    await pool.execute('DELETE FROM sessions WHERE member_id=?', [actorId(request)]);
    reply.clearCookie('workflow_session', { path: '/' });
    return { ok: true };
  }
  app.post('/api/auth/password', changePassword);

  /**
   * 查询已授权的动态页面定义，阻止直接访问隐藏页面。
   * @param request 请求
   * @returns 页面定义
   */
  async function page(request: FastifyRequest) {
    const config = (await loadConfig(pool)).published;
    const id = resourceId(request);
    ensure(pageAllowed(config, actorId(request), id), 403, 'PAGE_FORBIDDEN', '无此页面访问权限');
    return findById(config.pages, id);
  }
  app.get('/api/pages/:id', page);

  /**
   * 查询活动分页，所有数据范围由当前身份计算。
   * @param request 请求
   * @returns 分页结果
   */
  async function activities(request: FastifyRequest) {
    return listActivities(pool, actorId(request), listQuerySchema.parse(request.query));
  }
  app.get('/api/activities', activities);

  /**
   * 导出当前筛选的授权列表，限制单次行数并写入操作者审计。
   * @param request 请求
   * @param reply 响应
   * @returns 带导出来源的CSV
   */
  async function exportList(request: FastifyRequest, reply: FastifyReply) {
    const config = (await loadConfig(pool)).published;
    const actor = actorId(request);
    ensure(hasPermission(config, actor, 'activity:export'), 403, 'FORBIDDEN', '无导出权限');
    const input = listQuerySchema.parse(request.query);
    /**
     * 读取同一事务快照中的筛选结果，避免翻页期间新增工单导致重复行。
     * @param connection 事务连接
     * @returns 导出列表
     */
    async function readExport(connection: PoolConnection): Promise<ActivityListItem[]> {
      const current = (await loadConfig(connection)).published;
      ensure(hasPermission(current, actor, 'activity:export'), 403, 'FORBIDDEN', '无导出权限');
      const first = await listActivities(connection, actor, { ...input, page: 1, pageSize: 100 }, true);
      ensure(first.total <= 2000, 422, 'EXPORT_LIMIT', '单次最多导出2000条，请缩小筛选范围');
      const items = [...first.items];
      for (let page = 2; (page - 1) * 100 < first.total; page += 1) {
        const batch = await listActivities(connection, actor, { ...input, page, pageSize: 100 }, true);
        items.push(...batch.items);
      }
      return items;
    }
    const items = await transaction(pool, readExport);
    const rows = [
      csvCell(`导出人：${request.profile!.user.name}；时间：${new Date().toISOString()}`),
      '编号,活动名称,发起人,状态,开始时间,地点,预算',
    ];
    for (const item of items)
      rows.push(
        [item.code, item.name, item.applicantName, item.status, item.startAt, item.location, item.budget]
          .map(csvCell)
          .join(','),
      );
    await pool.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      crypto.randomUUID(),
      actor,
      '导出活动筛选列表',
      JSON.stringify({ filter: input, rows: items.length }),
    ]);
    reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="activities.csv"');
    return '\uFEFF' + rows.join('\r\n');
  }
  app.get('/api/activities/export', exportList);

  /**
   * 创建本人草稿。
   * @param request 请求
   * @returns 草稿标识与版本
   */
  async function create(request: FastifyRequest) {
    return createDraft(pool, actorId(request), draftSchema.parse(request.body), requestKey(request));
  }
  app.post('/api/activities', create);

  /**
   * 更新可编辑的本人草稿。
   * @param request 请求
   * @returns 更新版本
   */
  async function update(request: FastifyRequest) {
    return updateDraft(
      pool,
      actorId(request),
      resourceId(request),
      draftSchema.parse(request.body),
      requestKey(request),
    );
  }
  app.patch('/api/activities/:id', update);

  /**
   * 读取已授权的活动详情与可执行操作。
   * @param request 请求
   * @returns 详情
   */
  async function detail(request: FastifyRequest) {
    return getDetail(pool, actorId(request), resourceId(request));
  }
  app.get('/api/activities/:id', detail);

  /**
   * 逻辑删除活动，服务端重新校验身份、状态、版本、原因及幂等键。
   * @param request 已通过登录和CSRF检查的请求
   * @returns 删除结果
   */
  async function removeActivity(request: FastifyRequest) {
    return deleteActivity(
      pool,
      actorId(request),
      resourceId(request),
      activityDeleteSchema.parse(request.body),
    );
  }
  app.delete('/api/activities/:id', removeActivity);

  /**
   * 以已预览模板版本提交活动并创建节点任务。
   * @param request 请求
   * @returns 提交结果
   */
  async function submit(request: FastifyRequest) {
    const body = submitSchema.parse(request.body);
    return submitActivity(
      pool,
      actorId(request),
      resourceId(request),
      body.expectedVersion,
      body.idempotencyKey,
      body.expectedTemplateVersion,
    );
  }
  app.post('/api/activities/:id/submit', submit);

  /**
   * 办理指派、执行、归档和取消动作。
   * @param request 请求
   * @returns 更新结果
   */
  async function action(request: FastifyRequest) {
    return handleAction(pool, actorId(request), resourceId(request), actionSchema.parse(request.body));
  }
  app.post('/api/activities/:id/actions', action);

  /**
   * 办理真实个人待办，受理人由会话确定。
   * @param request 请求
   * @returns 更新结果
   */
  async function decide(request: FastifyRequest) {
    return handleDecision(pool, actorId(request), resourceId(request), decisionSchema.parse(request.body));
  }
  app.post('/api/tasks/:id/decisions', decide);

  /**
   * 转交受阻或需更换人员的当前待办。
   * @param request 请求
   * @returns 更新结果
   */
  async function transfer(request: FastifyRequest) {
    return handleTransfer(pool, actorId(request), resourceId(request), transferSchema.parse(request.body));
  }
  app.post('/api/tasks/:id/transfer', transfer);

  /**
   * 在途前加签、后插入或并行新增任务。
   * @param request 请求
   * @returns 更新结果
   */
  async function adjust(request: FastifyRequest) {
    return handleAdjustment(
      pool,
      actorId(request),
      resourceId(request),
      adjustmentSchema.parse(request.body),
    );
  }
  app.post('/api/activities/:id/adjustments', adjust);

  /**
   * 预览所选模板的生效路线，兼容旧客户端默认模板，不创建真实任务。
   * @param request 请求
   * @returns 路线和校验提示
   */
  async function preview(request: FastifyRequest) {
    const body = draftSchema.parse(request.body);
    return previewTemplate(pool, actorId(request), body);
  }
  app.post('/api/workflow/preview', preview);

  /**
   * 提供受控的内部人员和角色选项，不返回密码与个人联系方式。
   * @param request 请求
   * @returns 员工与角色选项
   */
  async function directory(request: FastifyRequest) {
    const config = (await loadConfig(pool)).published;
    const actor = actorId(request);
    ensure(
      hasPermission(config, actor, 'activity:read') || hasPermission(config, actor, 'config:manage'),
      403,
      'FORBIDDEN',
      '无人员读取权限',
    );
    const users = [];
    for (const member of config.users)
      if (member.active)
        users.push({
          id: member.id,
          name: member.name,
          department: member.department,
          canExecute: hasPermission(config, member.id, 'execution:report'),
        });
    const roles = [];
    if (hasPermission(config, actor, 'activity:read') || hasPermission(config, actor, 'config:manage'))
      for (const role of config.roles) roles.push({ id: role.id, name: role.name });
    return { users, roles, departments: config.departments };
  }
  app.get('/api/directory', directory);

  /**
   * 读取各业务主表装配的实时设置，仅管理员可访问。
   * @param request 请求
   * @returns 配置状态
   */
  async function getConfig(request: FastifyRequest) {
    requireAdmin(request);
    return loadConfig(pool);
  }
  app.get('/api/config', getConfig);

  /**
   * 兼容旧客户端路径，明确返回接口退役错误。
   */
  // 旧整包接口退役，防止旧客户端把人员配置重新写回主表。
  app.put('/api/config/draft', retiredConfig);

  /**
   * 旧配置发布接口退役，主数据使用模块保存。
   */
  app.post('/api/config/publish', retiredConfig);
  /** 拒绝旧整包配置提交，提示客户端刷新。
   * @returns 不再提供的接口响应
   */
  function retiredConfig() {
    throw new HttpError(410, 'CONFIG_API_RETIRED', '整包配置保存/发布已停用，请刷新页面使用模块保存');
  }
  /** 按模块保存设置，直接提交业务主表。
   * @param request 当前管理员请求
   * @returns 最新设置上下文
   */
  async function updateSettings(request: FastifyRequest) {
    requireAdmin(request);
    const params = z.object({ module: settingsModuleSchema }).parse(request.params);
    const body = z
      .object({ changes: z.unknown(), expectedRevision: z.number().int().positive() })
      .strict()
      .parse(request.body);
    return saveSettings(pool, actorId(request), params.module, body.changes, body.expectedRevision);
  }
  app.put('/api/settings/:module', updateSettings);

  /**
   * 为已保存成员设置登录密码，撤销其旧会话。
   * @param request 请求
   * @returns 更新结果
   */
  async function setPassword(request: FastifyRequest) {
    requireAdmin(request);
    const id = resourceId(request);
    const body = passwordSchema.parse(request.body);
    const config = (await loadConfig(pool)).published;
    ensure(findById(config.users, id), 404, 'NOT_FOUND', '成员不存在，请先保存人员');
    await pool.execute('UPDATE members SET password_hash=? WHERE id=?', [
      await hashPassword(body.password),
      id,
    ]);
    await pool.execute('DELETE FROM sessions WHERE member_id=?', [id]);
    await pool.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      crypto.randomUUID(),
      actorId(request),
      '重置成员密码',
      JSON.stringify({ memberId: id }),
    ]);
    return { ok: true };
  }
  app.post('/api/members/:id/password', setPassword);
  /** 删除未被业务引用的成员，权限和关联由事务内再次校验。
   * @param request 管理员删除请求
   * @returns 删除后的实时主数据
   */
  async function removeMember(request: FastifyRequest) {
    requireAdmin(request);
    const body = memberDeleteSchema.parse(request.body);
    return deleteMember(pool, actorId(request), resourceId(request), body.expectedRevision);
  }
  app.delete('/api/members/:id', removeMember);
  /** 原子批量删除、启用或停用成员。
   * @param request 管理员批量请求
   * @returns 操作后的主数据
   */
  async function updateMembersBatch(request: FastifyRequest) {
    requireAdmin(request);
    return batchMembers(pool, actorId(request), request.body);
  }
  app.post('/api/members/batch', updateMembersBatch);

  /**
   * 上传阶段附件，文件内容和阶段都由服务端验证。
   * @param request 请求
   * @returns 文件元数据
   */
  async function upload(request: FastifyRequest) {
    const id = resourceId(request);
    const stage = z
      .object({ stage: z.enum(['application', 'execution', 'archive', 'node']) })
      .parse(request.query).stage;
    const file = await request.file();
    ensure(file, 422, 'FILE_REQUIRED', '请选择文件');
    const buffer = await file.toBuffer();
    let access: FileAccessInput = {};
    const field = file.fields.access;
    if (field) {
      ensure(
        !Array.isArray(field) && field.type === 'field' && typeof field.value === 'string',
        422,
        'FILE_ACCESS',
        '附件授权格式无效',
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(field.value);
      } catch {
        throw new HttpError(422, 'FILE_ACCESS', '附件授权必须为有效JSON');
      }
      access = fileAccessInputSchema.parse(parsed);
    }
    return uploadFile(
      pool,
      resolve(env.UPLOAD_DIR),
      actorId(request),
      id,
      stage,
      file.filename,
      buffer,
      requestKey(request),
      access,
    );
  }
  app.post('/api/activities/:id/files', upload);

  /**
   * 下载已授权活动附件，磁盘路径不暴露给客户端。
   * @param request 请求
   * @param reply 响应
   * @returns 文件流
   */
  async function download(request: FastifyRequest, reply: FastifyReply) {
    const file = await authorizeFileRead(pool, actorId(request), resourceId(request));
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    reply.type(file.mime);
    return reply.send(createReadStream(resolve(env.UPLOAD_DIR, file.storageKey)));
  }
  app.get('/api/files/:id', download);
  /**
   * 在线预览有阅读权限的PDF或图片，其他格式保持独立下载授权。
   * @param request HTTP请求
   * @param reply HTTP响应
   * @returns 文件流
   */
  async function previewFile(request: FastifyRequest, reply: FastifyReply) {
    const file = await authorizeFileRead(pool, actorId(request), resourceId(request), true);
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    reply.header('Cache-Control', 'private, no-store');
    reply.type(file.mime);
    return reply.send(createReadStream(resolve(env.UPLOAD_DIR, file.storageKey)));
  }
  app.get('/api/files/:id/preview', previewFile);
  /**
   * 调整已上传资料的访问范围，服务端限制上传者只能收紧原有规则。
   * @param request HTTP请求
   * @returns 主单新版本
   */
  async function fileAccess(request: FastifyRequest) {
    return updateFileAccess(
      pool,
      actorId(request),
      resourceId(request),
      fileAccessWriteSchema.parse(request.body),
    );
  }
  app.patch('/api/files/:id/access', fileAccess);

  /**
   * 导出单张授权活动，默认排除联系方式并记录导出审计。
   * @param request 请求
   * @param reply 响应
   * @returns CSV文件
   */
  async function exportActivity(request: FastifyRequest, reply: FastifyReply) {
    const detail = await getDetail(pool, actorId(request), resourceId(request), true);
    ensure(detail.actions.includes('export'), 403, 'FORBIDDEN', '无导出权限');
    const exportId = crypto.randomUUID();
    const rows = ['字段,内容'];
    for (const field of detail.activity.schema.fields)
      if (!field.key.endsWith('_info'))
        rows.push(csvCell(field.label) + ',' + csvCell(detail.activity.payload[field.key] || ''));
    await pool.execute('INSERT INTO audit_events(id,activity_id,actor_id,action,data) VALUES (?,?,?,?,?)', [
      exportId,
      detail.activity.id,
      actorId(request),
      '导出活动',
      JSON.stringify({
        id: exportId,
        actor: actorId(request),
        actorName: request.profile!.user.name,
        action: '导出活动',
        note: 'CSV排除联系方式',
        createdAt: new Date().toISOString(),
      }),
    ]);
    reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${detail.activity.code}.csv"`);
    return '\uFEFF' + rows.join('\r\n');
  }
  app.get('/api/activities/:id/export', exportActivity);

  /**
   * 查询本人站内通知。
   * @param request 请求
   * @returns 消息列表
   */
  async function notifications(request: FastifyRequest) {
    const actor = actorId(request);
    const config = (await loadConfig(pool)).published;
    const rows = await query<Notification>(
      pool,
      'SELECT n.id,n.title,n.activity_id AS activityId,n.read_at AS readAt,n.created_at AS createdAt FROM notifications n JOIN activities a ON a.id=n.activity_id WHERE n.recipient_id=? AND a.deleted_at IS NULL ORDER BY n.created_at DESC LIMIT 100',
      [actor],
    );
    const visible: Notification[] = [];
    for (const row of rows) {
      const activity = await loadActivity(pool, row.activityId);
      if (activity && canReadActivity(config, actor, activity)) visible.push(row);
    }
    return visible;
  }
  app.get('/api/notifications', notifications);

  /**
   * 轮询本人新通知，游标分页避免一次新增超过100条时丢失提醒。
   * @param request 已认证请求及上次游标
   * @returns 新消息页和下一游标
   */
  async function pollNotifications(request: FastifyRequest) {
    const input = z.object({ cursor: z.string().max(500).optional() }).parse(request.query);
    return notificationFeed(pool, actorId(request), input.cursor);
  }
  app.get('/api/notifications/feed', pollNotifications);

  /**
   * 将本人消息标记为已读，不允许操作其他人的消息。
   * @param request 请求
   * @returns 操作结果
   */
  async function readNotification(request: FastifyRequest) {
    await pool.execute(
      'UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP(3)) WHERE id=? AND recipient_id=?',
      [resourceId(request), actorId(request)],
    );
    return { ok: true };
  }
  app.post('/api/notifications/:id/read', readNotification);
  return app;
}
