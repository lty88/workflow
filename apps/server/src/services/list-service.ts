import type { Database } from '../db/repository';
import { canReadActivity, findById, hasPermission, rolesFor, withinDepartment } from '@workflow/domain';
import type { Activity, CompanyConfig } from '@workflow/domain';
import type { z } from 'zod';
import type { listQuerySchema } from '@workflow/domain';
import { jsonValue, loadConfig, query } from '../db/repository';
import { ensure } from '../errors';

export interface ActivityListItem {
  id: string;
  code: string;
  name: string;
  applicant: string;
  department: string;
  status: Activity['status'];
  version: number;
  budget: string;
  startAt: string;
  location: string;
  updatedAt: string;
}

/**
 * 构造服务端可读范围，全部参数绑定，禁止客户端指定任意部门范围。
 * @param config 当前配置
 * @param actor 当前成员
 * @returns 范围条件与绑定参数
 */
function readWhere(config: CompanyConfig, actor: string): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const member = findById(config.users, actor)!;
  for (const role of rolesFor(config, actor)) {
    if (!role.permissions.includes('activity:read')) continue;
    if (role.scope === 'all') return { sql: '1=1', params: [] };
    if (role.scope === 'self') {
      conditions.push('a.applicant_id=?');
      params.push(actor);
    }
    if (role.scope === 'department') {
      conditions.push('a.department_id=?');
      params.push(member.department);
    }
    if (role.scope === 'department_tree') {
      const ids: string[] = [];
      for (const dept of config.departments)
        if (withinDepartment(config, dept.id, member.department)) ids.push(dept.id);
      if (ids.length) {
        conditions.push(`a.department_id IN (${ids.map(sqlPlaceholder).join(',')})`);
        params.push(...ids);
      }
    }
    if (role.scope === 'tasks') {
      conditions.push(
        "(EXISTS(SELECT 1 FROM workflow_nodes n WHERE n.activity_id=a.id AND JSON_CONTAINS(JSON_EXTRACT(n.data,'$.assignees'),JSON_QUOTE(?))) OR JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.executor'))=? OR JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.cancellation.reviewer'))=?)",
      );
      params.push(actor, actor, actor);
    }
  }
  return { sql: conditions.length ? '(' + conditions.join(' OR ') + ')' : '1=0', params };
}

/**
 * 为受控SQL列表提供参数占位符。
 * @param _value 原始值
 * @returns SQL参数占位符
 */
function sqlPlaceholder(_value: string): string {
  return '?';
}

/**
 * 构造当前成员真正可办理的待办查询，包含审批和执行归档任务。
 * @param config 当前配置
 * @param actor 当前成员
 * @returns SQL条件与参数
 */
function taskWhere(config: CompanyConfig, actor: string): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (hasPermission(config, actor, 'approval:decide') || hasPermission(config, actor, 'task:complete')) {
    const kinds: string[] = [];
    if (hasPermission(config, actor, 'approval:decide')) kinds.push('approval');
    if (hasPermission(config, actor, 'task:complete')) kinds.push('task', 'notice');
    parts.push(
      `(a.status='approving' AND EXISTS(SELECT 1 FROM workflow_tasks t JOIN workflow_nodes n ON n.id=t.node_id WHERE t.activity_id=a.id AND t.assignee_id=? AND t.status='pending' AND n.status='active' AND n.generation=t.generation AND JSON_UNQUOTE(JSON_EXTRACT(n.data,'$.kind')) IN (${kinds.map(sqlPlaceholder).join(',')}) AND (JSON_UNQUOTE(JSON_EXTRACT(n.data,'$.assigneeRule.type'))<>'role' OR JSON_EXTRACT(t.data,'$.delegated')=TRUE OR JSON_CONTAINS(?,JSON_QUOTE(JSON_UNQUOTE(JSON_EXTRACT(n.data,'$.assigneeRule.value')))))))`,
    );
    params.push(actor, ...kinds, JSON.stringify(findById(config.users, actor)!.roles));
  }
  if (hasPermission(config, actor, 'activity:assign')) parts.push("a.status='ready_assign'");
  if (hasPermission(config, actor, 'execution:report')) {
    parts.push(
      "(a.status IN ('ready_execute','executing') AND JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.executor'))=?)",
    );
    params.push(actor);
  }
  if (hasPermission(config, actor, 'activity:submit')) {
    parts.push("(a.status IN ('archive_draft','needs_info') AND a.applicant_id=?)");
    params.push(actor);
  }
  if (hasPermission(config, actor, 'archive:review')) {
    parts.push("(a.status='archive_review' AND JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.archive.reviewer'))=?)");
    params.push(actor);
  }
  if (hasPermission(config, actor, 'approval:decide')) {
    parts.push(
      "(a.status='cancel_review' AND JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.cancellation.reviewer'))=?)",
    );
    params.push(actor);
  }
  return { sql: parts.length ? '(' + parts.join(' OR ') + ')' : '1=0', params };
}

/**
 * 分页查询授权范围内活动，只返回列表需要的字段。
 * @param pool 连接池
 * @param actor 当前员工
 * @param input 查询条件
 * @returns 记录和分页总数
 */
export async function listActivities(
  pool: Database,
  actor: string,
  input: z.infer<typeof listQuerySchema>,
): Promise<{ items: ActivityListItem[]; total: number; page: number; pageSize: number }> {
  const config = (await loadConfig(pool)).published;
  ensure(hasPermission(config, actor, 'activity:read'), 403, 'FORBIDDEN', '无活动读取权限');
  const scope = readWhere(config, actor);
  const clauses = [scope.sql];
  const params = [...scope.params];
  if (input.q) {
    clauses.push(
      "(JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.name')) LIKE ? OR a.code LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.payload.location')) LIKE ?)",
    );
    params.push(`%${input.q}%`, `%${input.q}%`, `%${input.q}%`);
  }
  if (input.status) {
    clauses.push('a.status=?');
    params.push(input.status);
  }
  if (input.scope === 'mine') {
    clauses.push('a.applicant_id=?');
    params.push(actor);
  }
  if (input.scope === 'archives') clauses.push("a.status='archived'");
  if (input.scope === 'tasks') {
    const tasks = taskWhere(config, actor);
    clauses.push(tasks.sql);
    params.push(...tasks.params);
  }
  const where = clauses.join(' AND ');
  const count = await query<{ total: number }>(
    pool,
    `SELECT COUNT(*) AS total FROM activities a WHERE ${where}`,
    params,
  );
  const rows = await query<{ data: unknown }>(
    pool,
    `SELECT a.data FROM activities a WHERE ${where} ORDER BY a.updated_at DESC,a.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`,
    params,
  );
  const items: ActivityListItem[] = [];
  for (const row of rows) {
    const a = jsonValue<Activity>(row.data);
    items.push({
      id: a.id,
      code: a.code,
      name: a.name,
      applicant: a.applicant,
      department: a.department,
      status: a.status,
      version: a.version,
      budget: a.payload.budget || '',
      startAt: a.payload.start_at || '',
      location: a.payload.location || '线上会议',
      updatedAt: a.updatedAt,
    });
  }
  return { items, total: Number(count[0]?.total || 0), page: input.page, pageSize: input.pageSize };
}
