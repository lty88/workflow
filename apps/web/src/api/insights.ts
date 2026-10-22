import { request } from './http';
import type {
  ActivityEvaluations,
  DashboardFilter,
  EvaluationInput,
  LeadershipDashboard,
  PublicEvaluation,
  SurveyCommand,
} from '@/typings/api/insights';

/**
 * 读取活动评价统计、分享设置和分页反馈。
 * @param id 活动标识
 * @param page 反馈页码
 * @returns 当前身份可读取的评价数据
 */
export function activityEvaluationsApi(id: string, page = 1): Promise<ActivityEvaluations> {
  return request(`/activities/${encodeURIComponent(id)}/evaluations?page=${page}`);
}

/**
 * 修改评价链接状态并由服务端核对版本与管理权限。
 * @param id 活动标识
 * @param input 操作、有效天数和当前版本
 * @returns 更新成功标记
 */
export function manageSurveyApi(id: string, input: SurveyCommand): Promise<{ ok: boolean }> {
  return request(`/activities/${encodeURIComponent(id)}/evaluation-survey`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * 匿名读取公开问卷并由服务端建立浏览器去重Cookie。
 * @param token 分享令牌
 * @returns 公开活动信息与提交状态
 */
export function publicEvaluationApi(token: string): Promise<PublicEvaluation> {
  return request(`/public/evaluations/${encodeURIComponent(token)}`);
}

/**
 * 提交免登录活动评分，网络重试由服务端浏览器摘要去重。
 * @param token 分享令牌
 * @param input 四维评分与反馈建议
 * @returns 成功标记和重复提交状态
 */
export function submitEvaluationApi(
  token: string,
  input: EvaluationInput,
): Promise<{ ok: boolean; duplicate: boolean }> {
  return request(`/public/evaluations/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * 按筛选读取当前领导可见范围内的汇总指标。
 * @param input 时间、部门和类型筛选
 * @returns 看板指标与图表数据
 */
export function leadershipDashboardApi(input: DashboardFilter): Promise<LeadershipDashboard> {
  const query = new URLSearchParams({ ...input });
  return request('/leadership/dashboard?' + query.toString());
}
