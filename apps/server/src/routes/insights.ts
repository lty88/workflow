import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { dashboardFilterSchema, evaluationInputSchema, surveyCommandSchema } from '@workflow/domain';
import type { Environment } from '../env';
import { ensure } from '../errors';
import {
  getActivityEvaluations,
  getPublicEvaluation,
  manageSurvey,
  submitPublicEvaluation,
} from '../services/evaluation-service';
import { getLeadershipDashboard } from '../services/dashboard-service';

declare module 'fastify' {
  interface FastifyContextConfig {
    publicEvaluation?: boolean;
  }
}

/**
 * 从已认证会话取得内部操作者，公开评价不调用此方法。
 * @param request 当前请求
 * @returns 成员标识
 */
function actor(request: FastifyRequest): string {
  ensure(request.profile, 401, 'UNAUTHENTICATED', '请先登录');
  return request.profile.user.id;
}

/**
 * 解析活动资源标识。
 * @param request 当前请求
 * @returns 有长度约束的活动标识
 */
function activityId(request: FastifyRequest): string {
  return z.object({ id: z.string().min(1).max(80) }).parse(request.params).id;
}

/**
 * 解析不可猜测的公开评价令牌。
 * @param request 当前请求
 * @returns 64位十六进制令牌
 */
function surveyToken(request: FastifyRequest): string {
  return z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.params).token;
}

/**
 * 注册活动评价管理、精确开放的匿名填写接口与受权限保护的领导看板。
 * @param app 已安装认证钩子的应用
 * @param pool 数据库连接池
 * @param env 当前服务环境
 */
export function registerInsightsRoutes(app: FastifyInstance, pool: Pool, env: Environment): void {
  /**
   * 返回当前活动评价统计和分页反馈。
   * @param request 已认证请求
   * @returns 活动评价管理信息
   */
  async function evaluations(request: FastifyRequest) {
    const input = z
      .object({ page: z.coerce.number().int().min(1).max(100000).default(1) })
      .parse(request.query);
    return getActivityEvaluations(
      pool,
      actor(request),
      activityId(request),
      input.page,
      env.PUBLIC_APP_URL || '',
    );
  }
  app.get('/api/activities/:id/evaluations', evaluations);

  /**
   * 开启、停用或轮换当前活动评价链接。
   * @param request 已通过CSRF检查的内部请求
   * @returns 更新结果
   */
  async function survey(request: FastifyRequest) {
    return manageSurvey(pool, actor(request), activityId(request), surveyCommandSchema.parse(request.body));
  }
  app.post('/api/activities/:id/evaluation-survey', survey);

  /**
   * 为匿名浏览器设置随机身份Cookie并返回最少公开信息，绝不恢复内部登录会话。
   * @param request 公开请求
   * @param reply 用于写入匿名Cookie和Referrer策略的响应
   * @returns 公开评价填写信息
   */
  async function publicInfo(request: FastifyRequest, reply: FastifyReply) {
    const current = request.cookies.workflow_respondent || '';
    const respondent = /^[a-f0-9]{64}$/.test(current) ? current : randomBytes(32).toString('hex');
    const result = await getPublicEvaluation(pool, surveyToken(request), respondent);
    reply.header('Referrer-Policy', 'no-referrer');
    reply.setCookie('workflow_respondent', respondent, {
      path: '/api/public/evaluations',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 180 * 86400,
    });
    return result;
  }
  app.get(
    '/api/public/evaluations/:token',
    {
      logLevel: 'silent',
      config: {
        publicEvaluation: true,
        rateLimit: { max: 300, timeWindow: '1 minute' },
      },
    },
    publicInfo,
  );

  /**
   * 接收无需账号登录的匿名评分，Cookie去重与接口限流独立于内部认证。
   * @param request 公开评价请求
   * @returns 去重后的提交结果
   */
  async function publicSubmit(request: FastifyRequest) {
    const respondent = request.cookies.workflow_respondent;
    ensure(
      respondent && /^[a-f0-9]{64}$/.test(respondent),
      422,
      'RESPONDENT_MISSING',
      '请刷新评价页并允许浏览器Cookie后提交',
    );
    return submitPublicEvaluation(
      pool,
      surveyToken(request),
      respondent,
      evaluationInputSchema.parse(request.body),
    );
  }
  /**
   * 对匿名浏览器分别限流，避免会场共享网络中的参与者相互占用提交额度。
   * @param request 公开评价请求
   * @returns 当前浏览器或无Cookie请求的限流键
   */
  function respondentLimitKey(request: FastifyRequest): string {
    const respondent = request.cookies.workflow_respondent || '';
    return /^[a-f0-9]{64}$/.test(respondent) ? 'respondent:' + respondent : 'ip:' + request.ip;
  }
  app.post(
    '/api/public/evaluations/:token',
    {
      logLevel: 'silent',
      config: {
        publicEvaluation: true,
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: respondentLimitKey,
        },
      },
    },
    publicSubmit,
  );

  /**
   * 查询当前领导身份授权数据范围内的活动汇总。
   * @param request 已认证请求及筛选参数
   * @returns 领导看板数据
   */
  async function dashboard(request: FastifyRequest) {
    return getLeadershipDashboard(pool, actor(request), dashboardFilterSchema.parse(request.query));
  }
  app.get('/api/leadership/dashboard', dashboard);
}
