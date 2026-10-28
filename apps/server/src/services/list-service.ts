import { REQUEST_CATALOG, REQUEST_NODE_CATALOG, REQUEST_TASK_CATALOG } from '../db/request-store';
import { lifecycleOf } from '@workflow/domain';
import type { Database } from '../db/repository';
import {
  projectFormData,
  canDeleteActivity,
  canReadActivity,
  findById,
  hasPermission,
  rolesFor,
  withinDepartment,
} from '@workflow/domain';
import type { Activity, CompanyConfig, WorkflowNode } from '@workflow/domain';
import type { z } from 'zod';
import type { listQuerySchema } from '@workflow/domain';
import { jsonValue, loadConfig, query } from '../db/repository';
import { ensure } from '../errors';

// 新主单直接读取终审负责人；旧主单通过本轮已通过任务只读计算，不改写历史数据。
const WORKFLOW_OWNER_SQL = `COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.workflowOwnerId')),''),
  (SELECT t.assignee_id FROM workflow_tasks t JOIN workflow_nodes n ON n.id=t.node_id
    WHERE t.activity_id=a.id AND n.activity_id=a.id AND t.status='approved' AND n.status='completed'
      AND n.generation=t.generation AND JSON_UNQUOTE(JSON_EXTRACT(n.data,'$.kind'))='approval'
      AND COALESCE(JSON_EXTRACT(n.data,'$.applicationRevision'),1)=COALESCE(JSON_EXTRACT(a.data,'$.revision'),1)
      AND JSON_CONTAINS(JSON_EXTRACT(n.data,'$.assignees'),JSON_QUOTE(t.assignee_id))
    ORDER BY COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.actedAt')),'') DESC,t.id DESC LIMIT 1))`;
const NO_APPROVAL_SQL = `NOT EXISTS(SELECT 1 FROM workflow_nodes n WHERE n.activity_id=a.id
  AND JSON_UNQUOTE(JSON_EXTRACT(n.data,'$.kind'))='approval' AND n.status NOT IN ('skipped','invalidated')
  AND COALESCE(JSON_EXTRACT(n.data,'$.applicationRevision'),1)=COALESCE(JSON_EXTRACT(a.data,'$.revision'),1))`;

export interface ActivityListItem {
  businessType?: 'activity' | 'general';
  canDelete: boolean;
  restrictedFields?: string[];
  id: string;
  code: string;
  name: string;
  applicant: string;
  applicantName: string;
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
 * @param permission 用于计算数据范围的业务权限
 * @returns 范围条件与绑定参数
 */
export function activityScopeWhere(
  config: CompanyConfig,
  actor: string,
  permission: 'activity:read' | 'dashboard:read' = 'activity:read',
): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const member = findById(config.users, actor)!;
  for (const role of rolesFor(config, actor)) {
    if (!role.permissions.includes(permission)) continue;
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
 * 构造审批、终审人执行指派、执行人归档及终审人归档审核的真实待办条件。
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
  if (hasPermission(config, actor, 'approval:decide')) {
    parts.push(`(a.status='ready_assign' AND ${WORKFLOW_OWNER_SQL}=?)`);
    params.push(actor);
    parts.push(
      `(a.status='archive_review' AND ${WORKFLOW_OWNER_SQL}=? AND JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.archive.submittedBy'))<>? AND JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.executor'))<>?)`,
    );
    params.push(actor, actor, actor);
  }
  if (hasPermission(config, actor, 'activity:assign'))
    parts.push(`(a.status='ready_assign' AND ${NO_APPROVAL_SQL})`);
  if (hasPermission(config, actor, 'execution:report')) {
    parts.push(
      "(a.status IN ('ready_execute','executing','archive_draft') AND JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.executor'))=?)",
    );
    params.push(actor);
  }
  if (hasPermission(config, actor, 'activity:submit')) {
    parts.push("(a.status='needs_info' AND a.applicant_id=?)");
    params.push(actor);
  }
  if (hasPermission(config, actor, 'archive:review')) {
    parts.push(
      `(a.status='archive_review' AND ${NO_APPROVAL_SQL} AND JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.archive.reviewer'))=? AND JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.archive.submittedBy'))<>? AND JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.executor'))<>?)`,
    );
    params.push(actor, actor, actor);
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
 * 分页查询授权范围内未删除申请；全部工单保留终止、取消和办结记录，待办与档案再按用途收窄。
 * @param pool 连接池
 * @param actor 当前员工
 * @param input 查询条件
 * @param exporting 是否用于导出，敏感字段另需导出授权
 * @param common 是否查询跨业务申请，待办列表自动包含两类申请
 * @returns 已过滤敏感内容的记录和分页总数
 */
export async function listActivities(
  pool: Database,
  actor: string,
  input: z.infer<typeof listQuerySchema>,
  exporting = false,
  common = false,
): Promise<{
  items: ActivityListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const unified = common || input.scope === 'tasks';
  const source = unified ? REQUEST_CATALOG : 'activities';
  const nodeSource = unified ? REQUEST_NODE_CATALOG : 'workflow_nodes';
  const config = (await loadConfig(pool)).published;
  ensure(hasPermission(config, actor, 'activity:read'), 403, 'FORBIDDEN', '无活动读取权限');
  if (exporting) ensure(hasPermission(config, actor, 'activity:export'), 403, 'FORBIDDEN', '无导出权限');
  const scope = activityScopeWhere(config, actor);
  const scopeSql = unified ? scope.sql.replaceAll('workflow_tasks', REQUEST_TASK_CATALOG).replaceAll('workflow_nodes', REQUEST_NODE_CATALOG) : scope.sql;
  const clauses = [scopeSql, 'a.deleted_at IS NULL'];
  const params = [...scope.params];
  if (input.businessType) {
    clauses.push("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.lifecycle.businessType')),'activity')=?");
    params.push(input.businessType);
  }
  if (input.q) {
    clauses.push("(JSON_UNQUOTE(JSON_EXTRACT(a.data,'$.name')) LIKE ? OR a.code LIKE ?)");
    params.push(`%${input.q}%`, `%${input.q}%`);
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
    clauses.push(unified ? tasks.sql.replaceAll('workflow_tasks', REQUEST_TASK_CATALOG).replaceAll('workflow_nodes', REQUEST_NODE_CATALOG) : tasks.sql);
    params.push(...tasks.params);
  }
  const where = clauses.join(' AND ');
  const count = await query<{ total: number }>(
    pool,
    `SELECT COUNT(*) AS total FROM ${source} a WHERE ${where}`,
    params,
  );
  const rows = await query<{ data: unknown }>(
    pool,
    `SELECT a.data FROM ${source} a WHERE ${where} ORDER BY a.updated_at DESC,a.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`,
    params,
  );
  const items: ActivityListItem[] = [];
  const activities = new Map<string, Activity>();
  for (const row of rows) {
    const activity = jsonValue<Activity>(row.data);
    activity.nodes = [];
    activities.set(activity.id, activity);
  }
  if (activities.size) {
    const nodes = await query<{ activity_id: string; data: unknown }>(
      pool,
      `SELECT activity_id,data FROM ${nodeSource} AS listing_nodes WHERE activity_id IN (${[...activities.keys()].map(sqlPlaceholder).join(',')})`,
      [...activities.keys()],
    );
    for (const row of nodes) activities.get(row.activity_id)?.nodes.push(jsonValue<WorkflowNode>(row.data));
  }
  for (const a of activities.values()) {
    const visible = projectFormData(config, actor, a, a.schema, a.payload, exporting);

    items.push({
      businessType: lifecycleOf(a).businessType,
      canDelete: canDeleteActivity(config, actor, a),
      restrictedFields: visible.hidden,
      id: a.id,
      code: a.code,
      name: a.name,
      applicant: a.applicant,
      applicantName: a.applicantName || findById(config.users, a.applicant)?.name || '历史成员',
      department: a.department,
      status: a.status,
      version: a.version,
      budget: visible.hidden.includes('budget') ? '' : visible.payload.budget || '',
      startAt: visible.payload.start_at || '',
      location: visible.payload.location || '',
      updatedAt: a.updatedAt,
    });
  }
  return { items, total: Number(count[0]?.total || 0), page: input.page, pageSize: input.pageSize };
}
