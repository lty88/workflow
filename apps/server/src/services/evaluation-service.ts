import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolConnection } from 'mysql2/promise';
import {
  EVALUATION_DIMENSIONS,
  emptyEvaluationSummary,
  evaluationAllowed,
  evaluationEligible,
} from '@workflow/domain';
import type {
  Activity,
  ActivityEvaluations,
  CompanyConfig,
  EvaluationInput,
  EvaluationResponse,
  EvaluationSummary,
  PublicEvaluation,
  SurveyCommand,
} from '@workflow/domain';
import { loadActivity, loadConfig, query, transaction } from '../db/repository';
import type { Database } from '../db/repository';
import { ensure } from '../errors';

interface SurveyRow {
  activity_id: string;
  token: string;
  active: number;
  expires_at: string;
  version: number;
}

/**
 * 将数据库UTC时间文本转换为浏览器可明确识别的时间格式。
 * @param value MySQL时间文本
 * @returns 带UTC时区的ISO时间
 */
function isoTime(value: string): string {
  return value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
}

/**
 * 生成只用于单场活动去重的匿名浏览器摘要，不存储原始Cookie。
 * @param activityId 活动标识
 * @param respondent 随机匿名浏览器令牌
 * @returns SHA256摘要
 */
function respondentHash(activityId: string, respondent: string): string {
  return createHash('sha256')
    .update(activityId + ':' + respondent)
    .digest('hex');
}

/**
 * 读取评价链接记录，可在事务中排他锁定以串行处理开关、换码和提交。
 * @param db 数据库连接
 * @param activityId 活动标识
 * @param lock 是否持有排他锁
 * @returns 评价链接或空值
 */
async function loadSurvey(db: Database, activityId: string, lock = false): Promise<SurveyRow | undefined> {
  const rows = await query<SurveyRow>(
    db,
    'SELECT activity_id,token,active,expires_at,version FROM activity_surveys WHERE activity_id=?' +
      (lock ? ' FOR UPDATE' : ''),
    [activityId],
  );
  return rows[0];
}

/**
 * 加载活动并检查同角色数据范围内的评价读写资格。
 * @param db 数据库连接
 * @param actor 当前登录成员
 * @param id 活动标识
 * @param manage 是否必须具备管理权限
 * @param lock 是否锁定活动
 * @returns 活动及管理能力
 */
async function authorizedActivity(
  db: Database,
  actor: string,
  id: string,
  manage = false,
  lock = false,
): Promise<{ activity: Activity; config: CompanyConfig; canManage: boolean }> {
  const config = (await loadConfig(db, lock ? 'share' : 'none')).published;
  const activity = await loadActivity(db, id, lock);
  ensure(activity, 404, 'NOT_FOUND', '活动不存在');
  const canManage = evaluationAllowed(config, actor, activity, 'evaluation:manage');
  ensure(
    canManage || (!manage && evaluationAllowed(config, actor, activity, 'evaluation:read')),
    403,
    'FORBIDDEN',
    '无此活动的评价访问权限',
  );
  return { activity, config, canManage };
}

/**
 * 查询单场活动的全部样本统计，分页列表不会影响评分口径。
 * @param db 数据库连接
 * @param id 活动标识
 * @returns 评分、满意度、维度和分布统计
 */
async function evaluationSummary(db: Database, id: string): Promise<EvaluationSummary> {
  const rows = await query<Record<string, number | null>>(
    db,
    `SELECT COUNT(*) AS count, AVG(overall) AS average,
    SUM(overall>=4) AS satisfied, SUM(overall<=2) AS lowCount,
    AVG(content) AS content, AVG(organization) AS organization, AVG(usefulness) AS usefulness,
    SUM(overall=1) AS score1, SUM(overall=2) AS score2, SUM(overall=3) AS score3, SUM(overall=4) AS score4, SUM(overall=5) AS score5
    FROM activity_evaluations WHERE activity_id=?`,
    [id],
  );
  const row = rows[0]!;
  const count = Number(row.count);
  const result = emptyEvaluationSummary();
  if (!count) return result;
  result.count = count;
  result.average = Number(Number(row.average).toFixed(2));
  result.satisfaction = Number(((Number(row.satisfied) / count) * 100).toFixed(1));
  result.lowCount = Number(row.lowCount);
  result.dimensions = [];
  for (const dimension of EVALUATION_DIMENSIONS)
    result.dimensions.push({
      ...dimension,
      average: Number(Number(row[dimension.key === 'overall' ? 'average' : dimension.key]).toFixed(2)),
    });
  for (const bucket of result.distribution) bucket.count = Number(row['score' + bucket.score]);
  return result;
}

/**
 * 读取当前成员可访问的评价统计和分页反馈，链接只向管理人员返回。
 * @param pool 数据库连接池
 * @param actor 当前成员
 * @param id 活动标识
 * @param page 反馈页码
 * @param publicBase 可选的外部前端地址
 * @returns 管理卡片、统计与每页十条匿名反馈
 */
export async function getActivityEvaluations(
  pool: Pool,
  actor: string,
  id: string,
  page = 1,
  publicBase = '',
): Promise<ActivityEvaluations> {
  const { activity, canManage } = await authorizedActivity(pool, actor, id);
  const survey = await loadSurvey(pool, id);
  const summary = await evaluationSummary(pool, id);
  const responses = await query<EvaluationResponse>(
    pool,
    `SELECT id,overall,content,organization,usefulness,comment,
    DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.000Z') AS createdAt FROM activity_evaluations WHERE activity_id=? ORDER BY created_at DESC,id DESC LIMIT 10 OFFSET ${(page - 1) * 10}`,
    [id],
  );
  const sharePath = survey && canManage ? '/feedback.html#token=' + survey.token : '';
  return {
    eligible: evaluationEligible(activity),
    canManage,
    survey: survey
      ? {
          active: !!survey.active,
          expiresAt: isoTime(survey.expires_at),
          version: survey.version,
          sharePath: sharePath && publicBase ? new URL(sharePath, publicBase).href : sharePath,
        }
      : null,
    summary,
    responses,
    total: summary.count,
    page,
  };
}

/**
 * 创建、关闭或轮换活动评价链接，检查乐观锁版本并记录操作者审计。
 * @param pool 数据库连接池
 * @param actor 当前成员
 * @param id 活动标识
 * @param input 操作、有效天数和链接版本
 * @returns 更新成功标记
 */
export async function manageSurvey(
  pool: Pool,
  actor: string,
  id: string,
  input: SurveyCommand,
): Promise<{ ok: boolean }> {
  /**
   * 在活动与链接锁内提交链接变更，旧二维码在换码后即时失效。
   * @param db 当前事务连接
   * @returns 更新成功标记
   */
  async function change(db: PoolConnection): Promise<{ ok: boolean }> {
    const { activity } = await authorizedActivity(db, actor, id, true, true);
    const survey = await loadSurvey(db, id, true);
    ensure(
      (survey?.version || 0) === input.expectedVersion,
      409,
      'SURVEY_CONFLICT',
      '评价链接已变化，请刷新后重试',
    );
    ensure(input.action !== 'close' || survey, 422, 'SURVEY_MISSING', '尚未开启活动评价');
    if (input.action !== 'close')
      ensure(evaluationEligible(activity), 422, 'ACTIVITY_NOT_COMPLETED', '请先完成活动执行汇报，再开启评价');
    const token = !survey || input.action === 'rotate' ? randomBytes(32).toString('hex') : survey.token;
    const expires =
      input.action === 'close'
        ? new Date(isoTime(survey!.expires_at))
        : new Date(Date.now() + input.days * 86400000);
    await db.execute(
      `INSERT INTO activity_surveys(activity_id,token,active,expires_at,version,created_by) VALUES (?,?,?,?,1,?)
      ON DUPLICATE KEY UPDATE token=?,active=?,expires_at=?,version=version+1`,
      [id, token, input.action !== 'close', expires, actor, token, input.action !== 'close', expires],
    );
    await db.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      crypto.randomUUID(),
      actor,
      '管理活动评价链接',
      JSON.stringify({
        activityId: id,
        action: input.action,
        days: input.days,
        version: input.expectedVersion + 1,
      }),
    ]);
    return { ok: true };
  }
  return transaction(pool, change);
}

/**
 * 验证链接有效期、启用状态和活动完成条件，只返回公开填写所需信息。
 * @param db 数据库连接
 * @param token 不可猜测的评价链接令牌
 * @returns 链接与最小公开活动信息
 */
async function publicContext(
  db: Database,
  token: string,
): Promise<{ survey: SurveyRow; activity: Activity }> {
  const rows = await query<SurveyRow>(
    db,
    'SELECT activity_id,token,active,expires_at,version FROM activity_surveys WHERE token=?',
    [token],
  );
  const survey = rows[0];
  ensure(survey, 404, 'SURVEY_NOT_FOUND', '评价链接不存在或已更换');
  ensure(
    survey.active && Date.parse(isoTime(survey.expires_at)) > Date.now(),
    410,
    'SURVEY_CLOSED',
    '活动评价已结束，感谢关注',
  );
  const activity = await loadActivity(db, survey.activity_id);
  ensure(activity && evaluationEligible(activity), 410, 'SURVEY_UNAVAILABLE', '当前活动暂不接受评价');
  return { survey, activity };
}

/**
 * 为匿名填写页面返回公开活动名称、结束时间和当前浏览器是否已提交。
 * @param pool 数据库连接池
 * @param token 评价链接令牌
 * @param respondent 匿名浏览器令牌
 * @returns 最小公开评价信息，不包含审批、财务或人员资料
 */
export async function getPublicEvaluation(
  pool: Pool,
  token: string,
  respondent: string,
): Promise<PublicEvaluation> {
  const { survey, activity } = await publicContext(pool, token);
  const existing = await query<{ id: string }>(
    pool,
    'SELECT id FROM activity_evaluations WHERE activity_id=? AND respondent_hash=?',
    [activity.id, respondentHash(activity.id, respondent)],
  );
  return {
    activityName: activity.name,
    completedAt: activity.report!.end,
    expiresAt: isoTime(survey.expires_at),
    submitted: existing.length > 0,
  };
}

/**
 * 匿名提交活动评价，以浏览器摘要和数据库唯一索引去重，不要求登录账号。
 * @param pool 数据库连接池
 * @param token 当前评价链接令牌
 * @param respondent 匿名浏览器令牌
 * @param input 四维评分和可选建议
 * @returns 成功标记与是否为重复提交
 */
export async function submitPublicEvaluation(
  pool: Pool,
  token: string,
  respondent: string,
  input: EvaluationInput,
): Promise<{ ok: boolean; duplicate: boolean }> {
  /**
   * 锁定活动和链接后重新检查有效性，避免关停、取消或换码期间写入新评价。
   * @param db 事务数据库连接
   * @returns 写入结果
   */
  async function submit(db: PoolConnection): Promise<{ ok: boolean; duplicate: boolean }> {
    const initial = await publicContext(db, token);
    const activity = await loadActivity(db, initial.activity.id, true);
    const survey = await loadSurvey(db, initial.activity.id, true);
    ensure(
      activity &&
        survey?.token === token &&
        survey.active &&
        Date.parse(isoTime(survey.expires_at)) > Date.now() &&
        evaluationEligible(activity),
      410,
      'SURVEY_CLOSED',
      '活动评价已结束或链接已更换',
    );
    const hash = respondentHash(activity.id, respondent);
    const existing = await query<{ id: string }>(
      db,
      'SELECT id FROM activity_evaluations WHERE activity_id=? AND respondent_hash=?',
      [activity.id, hash],
    );
    if (existing.length) return { ok: true, duplicate: true };
    await db.execute(
      'INSERT INTO activity_evaluations(id,activity_id,respondent_hash,overall,content,organization,usefulness,comment) VALUES (?,?,?,?,?,?,?,?)',
      [
        crypto.randomUUID(),
        activity.id,
        hash,
        input.overall,
        input.content,
        input.organization,
        input.usefulness,
        input.comment,
      ],
    );
    return { ok: true, duplicate: false };
  }
  return transaction(pool, submit);
}
