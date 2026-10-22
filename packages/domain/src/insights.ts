import { z } from 'zod';
import type { Activity, ActivityStatus, CompanyConfig, Permission } from './types';
import { canReadActivity } from './permissions';

export const EVALUATION_DIMENSIONS = [
  { key: 'overall', label: '整体满意度' },
  { key: 'content', label: '内容质量' },
  { key: 'organization', label: '组织服务' },
  { key: 'usefulness', label: '实际收获' },
] as const;
export const evaluationInputSchema = z
  .object({
    overall: z.number().int().min(1).max(5),
    content: z.number().int().min(1).max(5),
    organization: z.number().int().min(1).max(5),
    usefulness: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).default(''),
  })
  .strict();
export type EvaluationInput = z.infer<typeof evaluationInputSchema>;
export const surveyCommandSchema = z
  .object({
    action: z.enum(['open', 'close', 'rotate']),
    days: z.number().int().min(1).max(180).default(30),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type SurveyCommand = z.infer<typeof surveyCommandSchema>;
export const dashboardFilterSchema = z
  .object({
    start: z.iso.date(),
    end: z.iso.date(),
    department: z.string().max(80).default(''),
    activityType: z.string().max(80).default(''),
  })
  .refine(validDateRange, {
    message: '开始日期需早于结束日期，单次最多查询366天',
  });
export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;

export interface PublicEvaluation {
  activityName: string;
  completedAt: string;
  expiresAt: string;
  submitted: boolean;
}
export interface EvaluationSummary {
  count: number;
  average: number | null;
  satisfaction: number | null;
  lowCount: number;
  dimensions: Array<{ key: string; label: string; average: number | null }>;
  distribution: Array<{ score: number; count: number }>;
}
export interface EvaluationResponse extends EvaluationInput {
  id: string;
  createdAt: string;
}
export interface ActivityEvaluations {
  eligible: boolean;
  canManage: boolean;
  survey: {
    active: boolean;
    expiresAt: string;
    version: number;
    sharePath: string;
  } | null;
  summary: EvaluationSummary;
  responses: EvaluationResponse[];
  total: number;
  page: number;
}
export interface LeadershipDashboard {
  generatedAt: string;
  summary: {
    total: number;
    completed: number;
    ongoing: number;
    cancelled: number;
    completionRate: number | null;
    participants: number;
    evaluatedActivities: number;
    responses: number;
    average: number | null;
    satisfaction: number | null;
  };
  trend: Array<{ month: string; total: number; completed: number }>;
  statuses: Array<{ status: ActivityStatus; count: number }>;
  departments: Array<{
    id: string;
    name: string;
    total: number;
    completed: number;
    average: number | null;
  }>;
  types: Array<{ id: string; name: string; total: number }>;
  lowRated: Array<{
    id: string;
    name: string;
    department: string;
    responses: number;
    average: number;
  }>;
  options: {
    departments: Array<{ label: string; value: string }>;
    types: Array<{ label: string; value: string }>;
  };
}

/**
 * 校验看板查询日期顺序及跨度，约束聚合查询范围。
 * @param input 查询起止日期
 * @returns 日期是否在允许范围内
 */
function validDateRange(input: { start: string; end: string }): boolean {
  const days = (Date.parse(input.end) - Date.parse(input.start)) / 86400000;
  return days >= 0 && days <= 365;
}

/**
 * 判断活动是否已完成执行，档案退回后仍允许收集活动评价。
 * @param activity 活动状态与执行汇报
 * @param now 当前时间戳
 * @returns 是否可开启评价
 */
export function evaluationEligible(activity: Pick<Activity, 'status' | 'report'>, now = Date.now()): boolean {
  return (
    ['archive_draft', 'archive_review', 'archived'].includes(activity.status) &&
    !!activity.report &&
    Number.isFinite(Date.parse(activity.report.end)) &&
    Date.parse(activity.report.end) <= now
  );
}

/**
 * 使用同一个角色的业务授权及数据范围检查评价权限，避免多角色组合扩大范围。
 * @param config 当前组织配置
 * @param actor 当前成员
 * @param activity 已加载节点的活动
 * @param permission 评价读写权限
 * @returns 是否允许操作该活动的评价
 */
export function evaluationAllowed(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  permission: Permission,
): boolean {
  const roles = [];
  for (const role of config.roles) if (role.permissions.includes(permission)) roles.push(role);
  return canReadActivity({ ...config, roles }, actor, activity);
}

/**
 * 返回统一评价统计空态，避免无样本时把满意度错误显示成零分。
 * @returns 零样本的统计结果
 */
export function emptyEvaluationSummary(): EvaluationSummary {
  const dimensions: EvaluationSummary['dimensions'] = [];
  for (const dimension of EVALUATION_DIMENSIONS) dimensions.push({ ...dimension, average: null });
  return {
    count: 0,
    average: null,
    satisfaction: null,
    lowCount: 0,
    dimensions,
    distribution: [
      { score: 5, count: 0 },
      { score: 4, count: 0 },
      { score: 3, count: 0 },
      { score: 2, count: 0 },
      { score: 1, count: 0 },
    ],
  };
}
