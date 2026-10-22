import type { Pool, PoolConnection } from 'mysql2/promise';
import { hasPermission, findById } from '@workflow/domain';
import type { ActivityStatus, DashboardFilter, LeadershipDashboard } from '@workflow/domain';
import { loadConfig, query, transaction } from '../db/repository';
import { ensure } from '../errors';
import { activityScopeWhere } from './list-service';

const COMPLETED = "a.status IN ('archive_draft','archive_review','archived')";
const EVALUATION_JOIN = `LEFT JOIN (SELECT activity_id,COUNT(*) AS responses,SUM(overall) AS score_sum,SUM(overall>=4) AS satisfied
  FROM activity_evaluations GROUP BY activity_id) e ON e.activity_id=a.id`;

/**
 * 将有效分子和分母换算为百分比，无样本时保留空值。
 * @param numerator 分子
 * @param denominator 分母
 * @returns 一位小数百分比或无样本空值
 */
function percentage(numerator: number, denominator: number): number | null {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(1)) : null;
}

/**
 * 将数据库得分总和换算为按评价份数加权的平均分。
 * @param sum 得分总和
 * @param count 评价份数
 * @returns 两位小数平均分或无样本空值
 */
function average(sum: number, count: number): number | null {
  return count ? Number((sum / count).toFixed(2)) : null;
}

/**
 * 排除已删除活动并在同一事务快照中查询领导看板，按看板权限自身的数据范围过滤，返回汇总而不返回财务或审批原文。
 * @param pool 数据库连接池
 * @param actor 当前登录成员
 * @param input 日期、部门和活动类型筛选
 * @returns 指标、月度趋势、部门比较、类型分布与低分活动
 */
export async function getLeadershipDashboard(
  pool: Pool,
  actor: string,
  input: DashboardFilter,
): Promise<LeadershipDashboard> {
  /**
   * 将同一权限和日期筛选应用到各项聚合，避免分页统计和跨角色数据混入。
   * @param db 当前只读事务连接
   * @returns 领导看板数据
   */
  async function read(db: PoolConnection): Promise<LeadershipDashboard> {
    const config = (await loadConfig(db)).published;
    ensure(hasPermission(config, actor, 'dashboard:read'), 403, 'FORBIDDEN', '无领导看板权限');
    const scope = activityScopeWhere(config, actor, 'dashboard:read');
    const clauses = [
      scope.sql,
      'a.deleted_at IS NULL',
      "a.status<>'draft'",
      "LEFT(JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.payload.start_at')),10) BETWEEN ? AND ?",
    ];
    const params = [...scope.params, input.start, input.end];
    if (input.department) {
      ensure(findById(config.departments, input.department), 422, 'DEPARTMENT_INVALID', '部门不存在');
      clauses.push('a.department_id=?');
      params.push(input.department);
    }
    if (input.activityType) {
      clauses.push('a.activity_type_id=?');
      params.push(input.activityType);
    }
    const from = ' FROM activities a ' + EVALUATION_JOIN + ' WHERE ' + clauses.join(' AND ');
    const totals = await query<Record<string, number | null>>(
      db,
      `SELECT COUNT(*) AS total,SUM(${COMPLETED}) AS completed,
      SUM(a.status NOT IN ('archive_draft','archive_review','archived','cancelled','rejected')) AS ongoing,
      SUM(a.status='cancelled') AS cancelled,SUM(CASE WHEN ${COMPLETED} THEN COALESCE(JSON_EXTRACT(a.data,'$.report.people'),0) ELSE 0 END) AS participants,
      SUM(COALESCE(e.responses,0)>0) AS evaluatedActivities,SUM(COALESCE(e.responses,0)) AS responses,
      SUM(COALESCE(e.score_sum,0)) AS scoreSum,SUM(COALESCE(e.satisfied,0)) AS satisfied` + from,
      params,
    );
    const row = totals[0]!;
    const total = Number(row.total || 0);
    const completed = Number(row.completed || 0);
    const responses = Number(row.responses || 0);
    const trendRows = await query<{
      month: string;
      total: number;
      completed: number;
    }>(
      db,
      `SELECT LEFT(JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.payload.start_at')),7) AS month,COUNT(*) AS total,SUM(${COMPLETED}) AS completed` +
        from +
        ' GROUP BY month ORDER BY month',
      params,
    );
    const trend: LeadershipDashboard['trend'] = [];
    const cursor = new Date(input.start.slice(0, 7) + '-01T00:00:00Z');
    const endMonth = input.end.slice(0, 7);
    while (cursor.toISOString().slice(0, 7) <= endMonth) {
      const month = cursor.toISOString().slice(0, 7);
      let found;
      for (const entry of trendRows) if (entry.month === month) found = entry;
      trend.push({
        month,
        total: Number(found?.total || 0),
        completed: Number(found?.completed || 0),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const statuses = await query<{ status: ActivityStatus; count: number }>(
      db,
      'SELECT a.status,COUNT(*) AS count' + from + ' GROUP BY a.status ORDER BY count DESC',
      params,
    );
    const deptRows = await query<{
      id: string;
      total: number;
      completed: number;
      scoreSum: number;
      responses: number;
    }>(
      db,
      `SELECT a.department_id AS id,COUNT(*) AS total,SUM(${COMPLETED}) AS completed,SUM(COALESCE(e.score_sum,0)) AS scoreSum,SUM(COALESCE(e.responses,0)) AS responses` +
        from +
        ' GROUP BY a.department_id ORDER BY total DESC',
      params,
    );
    const departments: LeadershipDashboard['departments'] = [];
    for (const entry of deptRows)
      departments.push({
        id: entry.id,
        name: findById(config.departments, entry.id)?.name || '历史部门',
        total: Number(entry.total),
        completed: Number(entry.completed),
        average: average(Number(entry.scoreSum), Number(entry.responses)),
      });
    const typeNames = await query<{ id: string; name: string }>(
      db,
      'SELECT id,name FROM activity_types ORDER BY sort,id',
    );
    const typeRows = await query<{ id: string; total: number }>(
      db,
      "SELECT COALESCE(a.activity_type_id,'legacy') AS id,COUNT(*) AS total" +
        from +
        ' GROUP BY a.activity_type_id ORDER BY total DESC',
      params,
    );
    const types: LeadershipDashboard['types'] = [];
    for (const entry of typeRows)
      types.push({
        id: entry.id,
        name: findById(typeNames, entry.id)?.name || '历史活动',
        total: Number(entry.total),
      });
    const lowRows = await query<{
      id: string;
      name: string;
      department: string;
      responses: number;
      scoreSum: number;
    }>(
      db,
      "SELECT a.id,JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.name')) AS name,a.department_id AS department,e.responses,e.score_sum AS scoreSum" +
        from +
        ' AND e.responses>0 AND e.score_sum/e.responses<3.5 ORDER BY e.score_sum/e.responses ASC,e.responses DESC,a.id LIMIT 10',
      params,
    );
    const lowRated: LeadershipDashboard['lowRated'] = [];
    for (const entry of lowRows)
      lowRated.push({
        id: entry.id,
        name: entry.name,
        department: findById(config.departments, entry.department)?.name || '历史部门',
        responses: Number(entry.responses),
        average: average(Number(entry.scoreSum), Number(entry.responses))!,
      });
    const visibleDepartments = await query<{ id: string }>(
      db,
      'SELECT DISTINCT a.department_id AS id FROM activities a WHERE ' +
        scope.sql +
        " AND a.status<>'draft' AND a.deleted_at IS NULL",
      scope.params,
    );
    const options: LeadershipDashboard['options'] = {
      departments: [],
      types: [],
    };
    for (const entry of visibleDepartments)
      options.departments.push({
        label: findById(config.departments, entry.id)?.name || '历史部门',
        value: entry.id,
      });
    for (const entry of typeNames) options.types.push({ label: entry.name, value: entry.id });
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        total,
        completed,
        ongoing: Number(row.ongoing || 0),
        cancelled: Number(row.cancelled || 0),
        completionRate: percentage(completed, total),
        participants: Number(row.participants || 0),
        evaluatedActivities: Number(row.evaluatedActivities || 0),
        responses,
        average: average(Number(row.scoreSum || 0), responses),
        satisfaction: percentage(Number(row.satisfied || 0), responses),
      },
      trend,
      statuses,
      departments,
      types,
      lowRated,
      options,
    };
  }
  return transaction(pool, read);
}
