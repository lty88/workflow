import type { Activity } from '@workflow/domain';
import { lifecycleOf, requestLifecycleState } from '@workflow/domain';
import { query } from './repository';
import type { Database } from './repository';

/** 根据冻结业务类型选择固定存储适配器，表名不接受客户端输入。
 * @param activity 已加载申请或业务类型
 * @returns 主表、节点、任务、依赖和附件表名
 */
export function requestTables(activity: { lifecycle?: Activity['lifecycle'] }) {
  return lifecycleOf(activity).businessType === 'general'
    ? {
        main: 'requests',
        nodes: 'request_nodes',
        tasks: 'request_tasks',
        edges: 'request_edges',
        files: 'request_files',
      }
    : {
        main: 'activities',
        nodes: 'workflow_nodes',
        tasks: 'workflow_tasks',
        edges: 'workflow_edges',
        files: 'files',
      };
}

/** 保存普通申请的独立主单，活动数据继续由原适配器保存。
 * @param db 事务连接
 * @param activity 已锁定的申请
 * @param create 是否新增
 */
export async function saveGeneralRequest(db: Database, activity: Activity, create: boolean): Promise<void> {
  const {
    executor,
    assignment,
    actualStart,
    report,
    executionRecords,
    executionCompletedAt,
    archive,
    archives,
    cancellation,
    nodes,
    tasks,
    audit,
    ...common
  } = activity;
  const state = requestLifecycleState(activity);
  const data = JSON.stringify({
    ...common,
    lifecycle: lifecycleOf(activity),
    nodes: [],
    tasks: [],
    audit: [],
  });
  const values = [
    state.status,
    state.approvalResult,
    state.currentStage,
    activity.status,
    activity.department,
    activity.version,
    activity.templateId || null,
    activity.templateVersion || null,
    data,
    new Date(activity.updatedAt),
    activity.deleted ? new Date(activity.deleted.at) : null,
    activity.deleted?.by || null,
    activity.deleted?.reason || null,
  ];
  if (create)
    await db.execute(
      `INSERT INTO requests(case_status,approval_result,current_stage,status,department_id,version,template_id,template_version,data,updated_at,deleted_at,deleted_by,deletion_reason,id,code,applicant_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [...values, activity.id, activity.code, activity.applicant, new Date(activity.createdAt)],
    );
  else
    await db.execute(
      'UPDATE requests SET case_status=?,approval_result=?,current_stage=?,status=?,department_id=?,version=?,template_id=?,template_version=?,data=?,updated_at=?,deleted_at=?,deleted_by=?,deletion_reason=? WHERE id=?',
      [...values, activity.id],
    );
}

/** 为普通申请填充兼容旧运行接口的空活动字段，不创建占位活动。
 * @param common 通用申请数据
 * @returns 共用引擎的运行模型
 */
export function requestRuntime(common: Activity): Activity {
  return Object.assign(
    {
      executor: '',
      assignment: '',
      actualStart: '',
      report: null,
      executionRecords: [],
      archive: null,
      archives: [],
      cancellation: null,
    },
    common,
  );
}

/** 跨存储适配器定位个人任务，随后仍须锁定主单并验证当前身份和版本。
 * @param db 数据库连接
 * @param id 待办标识
 * @param actor 可选的实际受理人限制
 * @returns 所属申请标识
 */
export async function findRequestTask(
  db: Database,
  id: string,
  actor?: string,
): Promise<Array<{ activity_id: string }>> {
  const condition = actor ? 'id=? AND assignee_id=?' : 'id=?';
  const params = actor ? [id, actor] : [id];
  const old = await query<{ activity_id: string }>(
    db,
    `SELECT activity_id FROM workflow_tasks WHERE ${condition}`,
    params,
  );
  return old.length
    ? old
    : query<{ activity_id: string }>(db, `SELECT activity_id FROM request_tasks WHERE ${condition}`, params);
}

/** 跨存储适配器定位附件，授权继续由统一附件服务检查。
 * @param db 数据库连接
 * @param id 文件标识
 * @returns 文件主键、所属申请和存储键
 */
export async function findRequestFile(db: Database, id: string) {
  const old = await query<{ id: string; activity_id: string; storage_key: string }>(
    db,
    'SELECT activity_id,storage_key FROM files WHERE id=?',
    [id],
  );
  return old.length
    ? old
    : query<{ id: string; activity_id: string; storage_key: string }>(
        db,
        'SELECT activity_id,storage_key FROM request_files WHERE id=?',
        [id],
      );
}

export const REQUEST_CATALOG =
  '(SELECT id,code,applicant_id,department_id,status,version,data,created_at,updated_at,deleted_at FROM activities UNION ALL SELECT id,code,applicant_id,department_id,status,version,data,created_at,updated_at,deleted_at FROM requests)';
export const REQUEST_NODE_CATALOG =
  '(SELECT id,activity_id,node_key,status,generation,data FROM workflow_nodes UNION ALL SELECT id,activity_id,node_key,status,generation,data FROM request_nodes)';
export const REQUEST_TASK_CATALOG =
  '(SELECT id,activity_id,node_id,assignee_id,generation,status,version,data FROM workflow_tasks UNION ALL SELECT id,activity_id,node_id,assignee_id,generation,status,version,data FROM request_tasks)';
