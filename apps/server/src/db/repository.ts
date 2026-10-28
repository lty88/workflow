import { requestTables, requestRuntime, saveGeneralRequest } from './request-store';
import { lifecycleOf } from '@workflow/domain';
import mysql from 'mysql2/promise';
import { readMasterData } from './master-data';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type {
  Activity,
  AuditEvent,
  CompanyConfig,
  ConfigState,
  FileRecord,
  WorkflowNode,
  WorkflowTask,
} from '@workflow/domain';
import type { Environment } from '../env';
import { DEFAULT_PASSWORD, synchronizeWorkflowOwner } from '@workflow/domain';
import { hashPassword } from '../services/password';

export type Database = Pool | PoolConnection;

/**
 * 解析驱动返回的JSON，兼容MySQL原生对象和文本。
 * @param value JSON字段
 * @returns 对应业务类型
 */
export function jsonValue<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/**
 * 执行参数化只读查询。
 * @param db 数据库连接
 * @param sql SQL语句
 * @param params 绑定参数
 * @returns 类型化行集合
 */
export async function query<T>(db: Database, sql: string, params: unknown[] = []): Promise<T[]> {
  const values: Array<string | number | boolean | Date | Buffer | null> = [];
  for (const value of params) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value instanceof Date ||
      Buffer.isBuffer(value)
    )
      values.push(value);
    else throw new TypeError('SQL参数必须为基础值、日期或二进制数据');
  }
  const [rows] = await db.execute<RowDataPacket[]>(sql, values);
  return rows as T[];
}

/**
 * 创建MySQL连接池，不隐式创建数据库或启动服务。
 * @param env 环境配置
 * @returns 连接池
 */
export function createPool(env: Environment): Pool {
  return mysql.createPool({
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    database: env.MYSQL_DATABASE,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    connectionLimit: 10,
    timezone: 'Z',
    charset: 'utf8mb4',
    multipleStatements: false,
    decimalNumbers: true,
    dateStrings: true,
  });
}

/**
 * 在单个连接中执行事务，异常自动回滚并释放连接。
 * @param pool 连接池
 * @param work 事务业务
 * @returns 业务结果
 */
export async function transaction<T>(
  pool: Pool,
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 装配业务上下文，主数据读取业务表；写入时通过配置行锁防止并发覆盖。
 * @param db 数据库连接
 * @param lock 配置锁方式
 * @returns 配置状态
 */
export async function loadConfig(
  db: Database,
  lock: 'none' | 'share' | 'update' = 'none',
): Promise<ConfigState> {
  const suffix = lock === 'share' ? ' FOR SHARE' : lock === 'update' ? ' FOR UPDATE' : '';
  const rows = await query<{ published: unknown; draft: unknown; revision: number; draft_revision: number }>(
    db,
    `SELECT published,draft,revision,draft_revision FROM configuration WHERE id='company'${suffix}`,
  );
  if (!rows[0]) throw new Error('数据库尚未初始化，请先执行 db:init');
  const base = jsonValue<CompanyConfig & { storage?: string }>(rows[0].published);
  const normalized = base.storage === 'master-data-v6';
  const { storage: _storage, ...context } = base;
  const current = normalized ? await readMasterData(db, context) : base;
  return {
    published: current,
    draft: normalized ? structuredClone(current) : jsonValue<CompanyConfig>(rows[0].draft),
    revision: rows[0].revision,
    draftRevision: rows[0].draft_revision,
  };
}

/**
 * 仅供第六版之前的初始化与迁移同步主表；升级后拒绝整包物化，新成员初始密码123456。
 * @param db 事务连接
 * @param config 发布配置
 */
export async function materializeConfig(db: Database, config: CompanyConfig): Promise<void> {
  if ((await query(db, 'SELECT version FROM schema_migrations WHERE version=6')).length)
    throw new Error('主数据迁移后禁止整包物化，请使用模块保存接口');
  const existingMembers = await query<{ id: string }>(db, 'SELECT id FROM members');
  const existingIds = new Set<string>();
  for (const item of existingMembers) existingIds.add(item.id);
  await db.execute("UPDATE members SET active=FALSE,username=CONCAT('~',LEFT(SHA2(id,256),40))");
  await db.execute('DELETE FROM departments');
  await db.execute('DELETE FROM roles');
  await db.execute('DELETE FROM menu_pages');
  for (const dept of config.departments)
    await db.execute(
      'INSERT INTO departments(id,parent_id,name,manager_id,active,data) VALUES (?,?,?,?,?,?)',
      [dept.id, dept.parent, dept.name, dept.manager, dept.active, JSON.stringify(dept)],
    );
  for (const role of config.roles)
    await db.execute('INSERT INTO roles(id,name,data) VALUES (?,?,?)', [
      role.id,
      role.name,
      JSON.stringify(role),
    ]);
  for (const page of config.pages)
    await db.execute('INSERT INTO menu_pages(id,name,active,data) VALUES (?,?,?,?)', [
      page.id,
      page.name,
      page.active,
      JSON.stringify(page),
    ]);
  for (const user of config.users) {
    const passwordHash = existingIds.has(user.id) ? null : await hashPassword(DEFAULT_PASSWORD);
    await db.execute(
      'INSERT INTO members(id,username,name,department_id,active,roles,password_hash) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE username=?,name=?,department_id=?,active=?,roles=?',
      [
        user.id,
        user.username,
        user.name,
        user.department,
        user.active,
        JSON.stringify(user.roles),
        passwordHash,
        user.username,
        user.name,
        user.department,
        user.active,
        JSON.stringify(user.roles),
      ],
    );
  }
}

/**
 * 读取未删除活动及独立任务、节点、审计和执行记录，兼容旧JSON记录，阻止访问已删除活动。
 * @param db 数据库连接
 * @param id 活动标识
 * @param lock 是否锁定主单
 * @returns 活动或空
 */
export async function loadActivity(db: Database, id: string, lock = false): Promise<Activity | null> {
  let rows = await query<{ data: unknown }>(
    db,
    `SELECT data FROM activities WHERE id=? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  if (!rows[0]) rows = await query<{ data: unknown }>(db, `SELECT data FROM requests WHERE id=? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) return null;
  const activity = requestRuntime(jsonValue<Activity>(rows[0].data));
  const tables = requestTables(activity);
  const nodes = await query<{ data: unknown }>(
    db,
    `SELECT data FROM ${tables.nodes} WHERE activity_id=? ORDER BY id`,
    [id],
  );
  const tasks = await query<{ data: unknown }>(
    db,
    `SELECT data FROM ${tables.tasks} WHERE activity_id=? ORDER BY id`,
    [id],
  );
  const audits = await query<{ data: unknown }>(
    db,
    'SELECT data FROM audit_events WHERE activity_id=? ORDER BY created_at,id',
    [id],
  );
  activity.nodes = [];
  for (const node of nodes) activity.nodes.push(jsonValue<WorkflowNode>(node.data));
  activity.tasks = [];
  for (const task of tasks) activity.tasks.push(jsonValue<WorkflowTask>(task.data));
  const reports = lifecycleOf(activity).businessType === 'general' ? [] : await query<{ data: unknown }>(
    db,
    'SELECT data FROM execution_records WHERE activity_id=? ORDER BY submitted_at,id',
    [id],
  );
  const records = new Map((activity.executionRecords || []).map((record) => [record.id, record]));
  for (const row of reports) {
    const record = jsonValue<NonNullable<Activity['executionRecords']>[number]>(row.data);
    records.set(record.id, record);
  }
  activity.executionRecords = [...records.values()].sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt),
  );
  activity.audit = [];
  for (const audit of audits) activity.audit.push(jsonValue<AuditEvent>(audit.data));
  synchronizeWorkflowOwner(activity);
  return activity;
}

/**
 * 同步实际终审负责人并原子保存主单、节点、任务与执行记录，历史意见和执行记录只追加。
 * @param db 事务连接
 * @param activity 活动实例
 * @param create 是否新建
 */
export async function saveActivity(db: Database, activity: Activity, create = false): Promise<void> {
  synchronizeWorkflowOwner(activity);
  const tables = requestTables(activity);
  const stored = { ...activity, nodes: [], tasks: [], audit: [], executionRecords: [] };
  const now = new Date(activity.updatedAt);
  if (lifecycleOf(activity).businessType === 'general') await saveGeneralRequest(db, activity, create);
  else if (create)
    await db.execute(
      'INSERT INTO activities(id,code,applicant_id,department_id,status,version,data,created_at,updated_at,activity_type_id,template_id,template_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        activity.id,
        activity.code,
        activity.applicant,
        activity.department,
        activity.status,
        activity.version,
        JSON.stringify(stored),
        new Date(activity.createdAt),
        now,
        activity.activityTypeId ?? null,
        activity.templateId ?? null,
        activity.templateVersion ?? null,
      ],
    );
  else
    await db.execute(
      'UPDATE activities SET department_id=?,status=?,version=?,data=?,updated_at=?,activity_type_id=?,template_id=?,template_version=? WHERE id=?',
      [
        activity.department,
        activity.status,
        activity.version,
        JSON.stringify(stored),
        now,
        activity.activityTypeId ?? null,
        activity.templateId ?? null,
        activity.templateVersion ?? null,
        activity.id,
      ],
    );
  for (const node of activity.nodes)
    await db.execute(
      `INSERT INTO ${tables.nodes}(id,activity_id,node_key,status,generation,data) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=?,generation=?,data=?`,
      [
        node.id,
        activity.id,
        node.key,
        node.status,
        node.generation,
        JSON.stringify(node),
        node.status,
        node.generation,
        JSON.stringify(node),
      ],
    );
  await db.execute(`DELETE FROM ${tables.edges} WHERE activity_id=?`, [activity.id]);
  for (const node of activity.nodes)
    for (const dep of node.deps)
      await db.execute(
        `INSERT INTO ${tables.edges}(activity_id,from_node,to_node,structure_revision) VALUES (?,?,?,?)`,
        [activity.id, dep, node.id, activity.structureRevision],
      );
  for (const task of activity.tasks)
    await db.execute(
      `INSERT INTO ${tables.tasks}(id,activity_id,node_id,assignee_id,generation,status,version,data) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE assignee_id=?,status=?,version=?,data=?`,
      [
        task.id,
        activity.id,
        task.nodeId,
        task.assignee,
        task.generation,
        task.status,
        task.version,
        JSON.stringify(task),
        task.assignee,
        task.status,
        task.version,
        JSON.stringify(task),
      ],
    );
  for (const record of activity.executionRecords || [])
    await db.execute(
      'INSERT IGNORE INTO execution_records(activity_id,id,author_id,submitted_at,data) VALUES (?,?,?,?,?)',
      [activity.id, record.id, record.authorId, new Date(record.submittedAt), JSON.stringify(record)],
    );
  for (const audit of activity.audit)
    await db.execute(
      'INSERT IGNORE INTO audit_events(id,activity_id,actor_id,action,data,created_at) VALUES (?,?,?,?,?,?)',
      [audit.id, activity.id, audit.actor, audit.action, JSON.stringify(audit), new Date(audit.createdAt)],
    );
}

/**
 * 列出服务端完整附件授权元数据，调用方必须投影后返回给客户端。
 * @param db 数据库连接
 * @param id 申请或活动标识
 * @param businessType 已加载主单的业务类型，默认兼容原活动
 * @returns 文件列表
 */
export async function activityFiles(db: Database, id: string, businessType: 'activity' | 'general' = 'activity'): Promise<FileRecord[]> {
  const rows = await query<{
    id: string;
    activity_id: string;
    name: string;
    size: number;
    mime: string;
    stage: FileRecord['stage'];
    uploader_id: string;
    field_key: string | null;
    context_id: string | null;
    action_key: string | null;
    node_id: string | null;
    access_rule: unknown;
    download_rule: unknown;
    created_at: string;
  }>(
    db,
    `SELECT id,activity_id,uploader_id,name,size,mime,stage,node_id,field_key,context_id,action_key,access_rule,download_rule,created_at FROM ${businessType === 'general' ? 'request_files' : 'files'} WHERE activity_id=? ORDER BY created_at`,
    [id],
  );
  const files: FileRecord[] = [];
  for (const row of rows)
    files.push({
      id: row.id,
      activityId: row.activity_id,
      name: row.name,
      size: Number(row.size),
      mime: row.mime,
      stage: row.stage,
      fieldKey: row.field_key || undefined,
      contextId: row.context_id || undefined,
      actionKey: row.action_key || undefined,
      nodeId: row.node_id || undefined,
      uploaderId: row.uploader_id,
      access: row.access_rule ? jsonValue<FileRecord['access']>(row.access_rule) : undefined,
      downloadAccess: row.download_rule
        ? jsonValue<FileRecord['downloadAccess']>(row.download_rule)
        : undefined,
      createdAt: row.created_at,
    });
  return files;
}

/**
 * 将任务通知加入事务发件箱，事件键避免重复通知。
 * @param db 事务连接
 * @param activity 活动
 * @param recipient 收件人
 * @param title 通知标题
 * @param key 唯一事件键
 */
export async function enqueue(
  db: Database,
  activity: Activity,
  recipient: string,
  title: string,
  key: string,
): Promise<void> {
  await db.execute(
    'INSERT IGNORE INTO outbox_events(id,event_key,activity_id,recipient_id,title) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(), key, activity.id, recipient, title],
  );
}

/**
 * 将待投递事件可靠写成站内消息，同一事件只产生一条消息。
 * @param pool 数据库连接池
 */
export async function flushOutbox(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const rows = await query<{ id: string; activity_id: string; recipient_id: string; title: string }>(
      connection,
      'SELECT id,activity_id,recipient_id,title FROM outbox_events WHERE delivered=FALSE ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED',
    );
    for (const row of rows) {
      await connection.execute(
        'INSERT IGNORE INTO notifications(id,event_id,recipient_id,activity_id,title) VALUES (?,?,?,?,?)',
        [crypto.randomUUID(), row.id, row.recipient_id, row.activity_id, row.title],
      );
      await connection.execute('UPDATE outbox_events SET delivered=TRUE WHERE id=?', [row.id]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
