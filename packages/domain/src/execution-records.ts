import type { Activity, CompanyConfig, ExecutionReport } from './types';
import { amountFen } from './forms';
import { findById } from './permissions';
import { createUuid } from './ids';

/**
 * 校验单条执行记录或最终汇总的时间、人数和支出，不改变活动阶段。
 * @param report 执行记录或完成汇总
 * @param completion 是否为最终完成汇总，最终零人数需说明原因
 * @returns 可向用户展示的校验错误
 */
export function executionReportErrors(report: ExecutionReport, completion = false): string[] {
  const errors: string[] = [];
  const start = Date.parse(report.start),
    end = Date.parse(report.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > Date.now())
    errors.push('实际时间无效或晚于当前时间');
  if (!Number.isInteger(report.people) || report.people < 0 || report.people > 100000)
    errors.push('实到人数需为0至100000的整数');
  if (completion && report.people === 0 && !report.exception.trim()) errors.push('实到人数为零时需说明原因');
  if (!report.summary.trim()) errors.push('请填写执行情况与成果');
  if (report.spend && !Number.isFinite(amountFen(report.spend))) errors.push('实际支出格式无效');
  return errors;
}

/**
 * 追加不可覆盖的执行记录，最终人数与支出由完成阶段另行确认，不自动累加参会人数。
 * @param config 当前组织配置
 * @param actor 记录提交人
 * @param activity 已授权且处于执行中的活动
 * @param report 本次执行记录
 * @param contextId 本次记录与附件共用的稳定标识
 */
export function appendExecutionRecord(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  report: ExecutionReport,
  contextId?: string,
): void {
  const id = contextId || createUuid();
  if (activity.executionRecords?.some((record) => record.id === id))
    throw new Error('该执行记录已提交，请刷新后查看');
  activity.executionRecords ||= [];
  activity.executionRecords.push({
    ...report,
    id,
    authorId: actor,
    authorName: findById(config.users, actor)?.name || actor,
    submittedAt: new Date().toISOString(),
  });
}

/**
 * 判断附件分组是否已随记录或业务操作正式提交，用于隔离未提交附件。
 * @param activity 活动完整记录
 * @param contextId 附件分组标识
 * @returns 是否已归属正式执行记录或操作审计
 */
export function attachmentContextCommitted(activity: Activity, contextId: string): boolean {
  return (
    !!activity.executionRecords?.some((record) => record.id === contextId) ||
    activity.audit.some((event) => event.attachmentContextId === contextId)
  );
}
