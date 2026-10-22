import type { DashboardFilter } from '@/typings/api/insights';

/**
 * 将本地日历日期转为看板筛选文本，避免UTC换日影响用户选择。
 * @param date 有效本地日期
 * @returns 年月日格式的筛选日期
 */
function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 同步生成包含今天的最近若干日范围，供首次渲染和快捷筛选共同使用。
 * @param days 包含今天在内的天数，必须为正整数
 * @param now 当前本地日期，默认取系统时间
 * @returns 起止日期，不包含部门或活动类型条件
 */
export function recentDateRange(days: number, now = new Date()): Pick<DashboardFilter, 'start' | 'end'> {
  if (!Number.isInteger(days) || days < 1 || !Number.isFinite(now.getTime()))
    throw new RangeError('日期范围需要有效日期与正整数天数');
  const start = new Date(now);
  start.setDate(start.getDate() - days + 1);
  return { start: localDate(start), end: localDate(now) };
}

/**
 * 将空值或非法日期转为日期选择器要求的空状态，防止格式化时抛出异常。
 * @param value 年月日日期文本，允许为空
 * @returns 有效日期原文或日期选择器空值
 */
export function toPickerDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
