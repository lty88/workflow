import mysql from 'mysql2/promise';
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
import { DEFAULT_PASSWORD } from '@workflow/domain';
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
 * 读取配置，业务写入持有共享锁，发布配置持有排他锁。
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
  return {
    published: jsonValue<CompanyConfig>(rows[0].published),
    draft: jsonValue<CompanyConfig>(rows[0].draft),
    revision: rows[0].revision,
    draftRevision: rows[0].draft_revision,
  };
}

/**
 * 在发布事务内同步组织、成员与菜单，新成员默认密码123456，既有密码保持不变。
 * @param db 事务连接
 * @param config 发布配置
 */
export async function materializeConfig(db: Database, config: CompanyConfig): Promise<void> {
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
 * 读取活动和规范化任务、节点、审计，详情与写入共用。
 * @param db 数据库连接
 * @param id 活动标识
 * @param lock 是否锁定主单
 * @returns 活动或空
 */
export async function loadActivity(db: Database, id: string, lock = false): Promise<Activity | null> {
  const rows = await query<{ data: unknown }>(
    db,
    `SELECT data FROM activities WHERE id=?${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  if (!rows[0]) return null;
  const activity = jsonValue<Activity>(rows[0].data);
  const nodes = await query<{ data: unknown }>(
    db,
    'SELECT data FROM workflow_nodes WHERE activity_id=? ORDER BY id',
    [id],
  );
  const tasks = await query<{ data: unknown }>(
    db,
    'SELECT data FROM workflow_tasks WHERE activity_id=? ORDER BY id',
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
  activity.audit = [];
  for (const audit of audits) activity.audit.push(jsonValue<AuditEvent>(audit.data));
  return activity;
}

/**
 * 原子保存主单、节点和个人任务，历史意见不删除。
 * @param db 事务连接
 * @param activity 活动实例
 * @param create 是否新建
 */
export async function saveActivity(db: Database, activity: Activity, create = false): Promise<void> {
  const stored = { ...activity, nodes: [], tasks: [], audit: [] };
  const now = new Date(activity.updatedAt);
  if (create)
    await db.execute(
      'INSERT INTO activities(id,code,applicant_id,department_id,status,version,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
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
      ],
    );
  else
    await db.execute(
      'UPDATE activities SET department_id=?,status=?,version=?,data=?,updated_at=? WHERE id=?',
      [activity.department, activity.status, activity.version, JSON.stringify(stored), now, activity.id],
    );
  for (const node of activity.nodes)
    await db.execute(
      'INSERT INTO workflow_nodes(id,activity_id,node_key,status,generation,data) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=?,generation=?,data=?',
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
  await db.execute('DELETE FROM workflow_edges WHERE activity_id=?', [activity.id]);
  for (const node of activity.nodes)
    for (const dep of node.deps)
      await db.execute(
        'INSERT INTO workflow_edges(activity_id,from_node,to_node,structure_revision) VALUES (?,?,?,?)',
        [activity.id, dep, node.id, activity.structureRevision],
      );
  for (const task of activity.tasks)
    await db.execute(
      'INSERT INTO workflow_tasks(id,activity_id,node_id,assignee_id,generation,status,version,data) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE assignee_id=?,status=?,version=?,data=?',
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
  for (const audit of activity.audit)
    await db.execute(
      'INSERT IGNORE INTO audit_events(id,activity_id,actor_id,action,data,created_at) VALUES (?,?,?,?,?,?)',
      [audit.id, activity.id, audit.actor, audit.action, JSON.stringify(audit), new Date(audit.createdAt)],
    );
}

/**
 * 列出活动附件元数据，不返回磁盘路径。
 * @param db 数据库连接
 * @param id 活动标识
 * @returns 文件列表
 */
export async function activityFiles(db: Database, id: string): Promise<FileRecord[]> {
  const rows = await query<{
    id: string;
    activity_id: string;
    name: string;
    size: number;
    mime: string;
    stage: FileRecord['stage'];
    created_at: string;
  }>(
    db,
    'SELECT id,activity_id,name,size,mime,stage,created_at FROM files WHERE activity_id=? ORDER BY created_at',
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
