import { expect, test } from 'vitest';
import type { Activity, ActivityDetail, CompanyConfig, DataAccessRule, FileRecord } from '@workflow/domain';
import {
  applicantForm,
  canDownloadFile,
  canReadNodeContent,
  configSchema,
  hasScopedDataPermission,
  instantiateWorkflow,
  isNarrowerAccess,
  mergeWritablePayload,
  projectActivityDetail,
  preserveFormAccess,
  seedConfig,
  validateConfig,
} from '@workflow/domain';
import { authorizeFileRead } from '../services/file-service';
import { getDetail } from '../services/activity-service';
import { listActivities } from '../services/list-service';
import { migrateDataSecurity } from '../db/security-migration';
import type { Pool } from 'mysql2/promise';

/**
 * 构造包含财务节点、敏感字段、历史意见与分级附件的真实领域数据，不连接数据库。
 * @returns 公司配置、完整详情及财务节点标识
 */
function fixture() {
  const config = seedConfig();
  config.roles.push({
    id: 'finance',
    name: '财务审核',
    permissions: ['activity:read', 'approval:decide', 'file:download'],
    scope: 'tasks',
    pages: [],
  });
  config.users
    .find(
      /**
       * 按测试标识匹配目标组织、字段或节点。
       * @param user 测试集合当前项
       * @returns 是否符合本次匹配条件
       */
      (user) => user.id === 'u-zhou',
    )!
    .roles.push('finance');
  const restricted: DataAccessRule = { mode: 'restricted', roleIds: ['finance'], userIds: [] };
  config.form.fields.push({
    id: 'account',
    key: 'bank_account',
    label: '结算账号',
    type: 'text',
    required: false,
    default: 'DEFAULT-SECRET',
    options: [],
    access: { read: restricted, write: restricted, mask: 'hidden' },
  });
  config.workflow.nodes.push({
    id: 'n-finance',
    label: '财务审核',
    kind: 'approval',
    deps: ['n-department'],
    assignee: { type: 'role', value: 'finance' },
  });
  const plan = instantiateWorkflow(config, { budget: '12000' }, 'u-lin');
  expect(plan.errors).toEqual([]);
  const node = plan.nodes.find(
    /**
     * 按测试标识匹配目标组织、字段或节点。
     * @param item 测试集合当前项
     * @returns 是否符合本次匹配条件
     */
    (item) => item.key === 'n-finance',
  )!;
  node.status = 'active';
  const activity: Activity = {
    id: 'a1',
    code: 'HD-TEST',
    applicant: 'u-lin',
    department: 'd1',
    name: '活动',
    status: 'approving',
    version: 1,
    structureRevision: 1,
    revision: 1,
    configVersion: 1,
    schema: structuredClone(config.form),
    payload: { activity_name: '活动', bank_account: 'ACCOUNT-SECRET', budget: '12000' },
    snapshots: [],
    nodes: plan.nodes,
    tasks: [
      {
        id: 't-finance',
        activityId: 'a1',
        nodeId: node.id,
        assignee: 'u-zhou',
        generation: 1,
        status: 'pending',
        version: 1,
        comment: 'INTERNAL-SECRET',
        publicComment: '财务资料待补充',
      },
    ],
    audit: [
      {
        id: 'e1',
        actor: 'u-zhou',
        actorName: '财务',
        action: '财务审核',
        note: 'AUDIT-SECRET',
        nodeId: node.id,
        createdAt: '',
      },
      {
        id: 'e-old',
        actor: 'u-zhou',
        actorName: '财务',
        action: '历史记录',
        note: 'LEGACY-SECRET',
        createdAt: '',
      },
    ],
    executor: '',
    assignment: '',
    actualStart: '',
    report: null,
    archive: null,
    archives: [],
    cancellation: null,
    createdAt: '',
    updatedAt: '',
  };
  activity.snapshots.push({
    revision: 1,
    schema: structuredClone(config.form),
    payload: { ...activity.payload },
    workflow: structuredClone(config.workflow.nodes),
    configVersion: 1,
    submittedAt: '',
  });
  const files: FileRecord[] = [
    {
      id: 'f-private',
      activityId: 'a1',
      nodeId: node.id,
      stage: 'node',
      name: 'PRIVATE-FILENAME.pdf',
      size: 10,
      mime: 'application/pdf',
      createdAt: '',
      uploaderId: 'u-zhou',
    },
    {
      id: 'f-extra',
      activityId: 'a1',
      stage: 'application',
      name: 'EXTRA-SECRET.pdf',
      size: 10,
      mime: 'application/pdf',
      createdAt: '',
      uploaderId: 'u-lin',
      access: restricted,
    },
    {
      id: 'f-public',
      activityId: 'a1',
      stage: 'application',
      name: '公开方案.pdf',
      size: 10,
      mime: 'application/pdf',
      createdAt: '',
    },
  ];
  return {
    config,
    detail: { activity, files, actions: [], participants: [], taskWarnings: [] } as ActivityDetail,
    nodeId: node.id,
  };
}

/** 核对营销和申请人仍能看到进度与公开结论，任何详情或历史位置均不含财务原文。 */
function isolationCase(): void {
  const { config, detail, nodeId } = fixture();
  for (const actor of ['u-zhao', 'u-lin']) {
    const safe = projectActivityDetail(config, actor, detail);
    const json = JSON.stringify(safe);
    for (const secret of [
      'ACCOUNT-SECRET',
      'DEFAULT-SECRET',
      'INTERNAL-SECRET',
      'AUDIT-SECRET',
      'LEGACY-SECRET',
      'PRIVATE-FILENAME',
      'EXTRA-SECRET',
    ])
      expect(json).not.toContain(secret);
    expect(
      safe.activity.nodes.some(
        /**
         * 按测试标识匹配目标组织、字段或节点。
         * @param node 测试集合当前项
         * @returns 是否符合本次匹配条件
         */
        (node) => node.id === nodeId,
      ),
    ).toBe(true);
    expect(safe.activity.tasks[0]!.publicComment).toBe('财务资料待补充');
    expect(
      safe.files.map(
        /**
         * 将测试记录转换为查询行或断言标识。
         * @param file 测试集合当前项
         * @returns 当前映射或受保护调用的结果
         */
        (file) => file.id,
      ),
    ).toEqual(['f-public']);
  }
  expect(detail.activity.tasks[0]!.comment).toBe('INTERNAL-SECRET');
}
test('跨部门隔离内部意见、字段、附件名、审计和历史快照，保留公开进度', isolationCase);

/** 核对财务受理人拥有所需原文及上传能力，但敏感导出仍需独立授权。 */
function financeCase(): void {
  const { config, detail, nodeId } = fixture();
  const safe = projectActivityDetail(config, 'u-zhou', detail);
  expect(safe.activity.payload.bank_account).toBe('ACCOUNT-SECRET');
  expect(safe.activity.tasks[0]!.comment).toBe('INTERNAL-SECRET');
  expect(
    safe.files.find(
      /**
       * 按测试标识匹配目标组织、字段或节点。
       * @param file 测试集合当前项
       * @returns 是否符合本次匹配条件
       */
      (file) => file.id === 'f-private',
    )!.canDownload,
  ).toBe(true);
  expect(safe.access!.uploadNodeIds).toContain(nodeId);
  expect(projectActivityDetail(config, 'u-zhou', detail, true).activity.payload.bank_account).toBeUndefined();
  config.roles
    .find(
      /**
       * 按测试标识匹配目标组织、字段或节点。
       * @param role 测试集合当前项
       * @returns 是否符合本次匹配条件
       */
      (role) => role.id === 'finance',
    )!
    .permissions.push('activity:sensitive:export');
  expect(projectActivityDetail(config, 'u-zhou', detail, true).activity.payload.bank_account).toBe(
    'ACCOUNT-SECRET',
  );
}
test('财务可读本节点资料和上传，敏感导出独立授权', financeCase);

/** 核对领导全量阅读不会自动获得下载权，配置管理员也不隐式获得业务阅读。 */
function leaderCase(): void {
  const { config, detail } = fixture();
  const leader = config.roles.find(
    /**
     * 按测试标识匹配目标组织、字段或节点。
     * @param role 测试集合当前项
     * @returns 是否符合本次匹配条件
     */
    (role) => role.id === 'director',
  )!;
  leader.permissions.push('activity:sensitive:read', 'file:download');
  const safe = projectActivityDetail(config, 'u-liu', detail);
  expect(safe.activity.payload.bank_account).toBe('ACCOUNT-SECRET');
  expect(safe.activity.tasks[0]!.comment).toBe('INTERNAL-SECRET');
  expect(
    safe.files.find(
      /**
       * 按测试标识匹配目标组织、字段或节点。
       * @param file 测试集合当前项
       * @returns 是否符合本次匹配条件
       */
      (file) => file.id === 'f-private',
    )!.canDownload,
  ).toBe(false);
  leader.permissions.push('activity:sensitive:export');
  expect(canDownloadFile(config, 'u-liu', detail.activity, detail.files[0]!)).toBe(true);
  expect(
    /**
     * 调用受保护能力，供断言检查授权或拒绝结果。
     * @returns 当前映射或受保护调用的结果
     */
    () => projectActivityDetail(config, 'u-admin', detail),
  ).toThrow('访问权限');
}
test('领导阅读、敏感下载和系统配置管理互相独立', leaderCase);

/** 核对宽范围普通角色不会扩大另一个窄范围角色的敏感权限。 */
function mixedRolesCase(): void {
  const { config, detail, nodeId } = fixture();
  const director = config.roles.find(
    /**
     * 按测试标识匹配目标组织、字段或节点。
     * @param role 测试集合当前项
     * @returns 是否符合本次匹配条件
     */
    (role) => role.id === 'director',
  )!;
  director.scope = 'self';
  director.permissions.push('activity:sensitive:read', 'file:download');
  config.roles.push({
    id: 'observer',
    name: '全公司进度',
    permissions: ['activity:read'],
    scope: 'all',
    pages: [],
  });
  config.users
    .find(
      /**
       * 按测试标识匹配目标组织、字段或节点。
       * @param user 测试集合当前项
       * @returns 是否符合本次匹配条件
       */
      (user) => user.id === 'u-liu',
    )!
    .roles.push('observer');
  expect(hasScopedDataPermission(config, 'u-liu', detail.activity, 'activity:sensitive:read')).toBe(false);
  expect(
    canReadNodeContent(
      config,
      'u-liu',
      detail.activity,
      detail.activity.nodes.find(
        /**
         * 按测试标识匹配目标组织、字段或节点。
         * @param node 测试集合当前项
         * @returns 是否符合本次匹配条件
         */
        (node) => node.id === nodeId,
      )!,
    ),
  ).toBe(false);
}
test('多角色合并不会扩大敏感授权的数据范围', mixedRolesCase);

/** 核对移除财务角色或停用人员后，即使冻结受理人名单保留也不能继续访问。 */
function revocationCase(): void {
  const { config, detail } = fixture();
  config.users.find(
    /**
     * 按测试标识匹配目标组织、字段或节点。
     * @param user 测试集合当前项
     * @returns 是否符合本次匹配条件
     */
    (user) => user.id === 'u-zhou',
  )!.roles = ['academic'];
  const safe = projectActivityDetail(config, 'u-zhou', detail);
  expect(safe.activity.payload.bank_account).toBeUndefined();
  expect(
    safe.files.map(
      /**
       * 将测试记录转换为查询行或断言标识。
       * @param file 测试集合当前项
       * @returns 当前映射或受保护调用的结果
       */
      (file) => file.id,
    ),
  ).toEqual(['f-public']);
  config.users.find(
    /**
     * 按测试标识匹配目标组织、字段或节点。
     * @param user 测试集合当前项
     * @returns 是否符合本次匹配条件
     */
    (user) => user.id === 'u-zhou',
  )!.active = false;
  expect(
    /**
     * 调用受保护能力，供断言检查授权或拒绝结果。
     * @returns 当前映射或受保护调用的结果
     */
    () => projectActivityDetail(config, 'u-zhou', detail),
  ).toThrow();
}
test('实时角色撤销和停用立即收回冻结节点内容访问', revocationCase);

/** 核对当前字段收紧作用于旧快照，脱敏内容不带原默认值或控件配置。 */
function fieldCase(): void {
  const { config, detail } = fixture();
  const snapshot = detail.activity.schema.fields.find(
    /**
     * 按测试标识匹配目标组织、字段或节点。
     * @param field 测试集合当前项
     * @returns 是否符合本次匹配条件
     */
    (field) => field.key === 'bank_account',
  )!;
  delete snapshot.access;
  const current = config.form.fields.find(
    /**
     * 按测试标识匹配目标组织、字段或节点。
     * @param field 测试集合当前项
     * @returns 是否符合本次匹配条件
     */
    (field) => field.key === 'bank_account',
  )!;
  current.access!.mask = 'partial';
  for (const revision of detail.activity.snapshots)
    delete revision.schema.fields.find(
      /**
       * 按测试标识匹配目标组织、字段或节点。
       * @param field 测试集合当前项
       * @returns 是否符合本次匹配条件
       */
      (field) => field.key === 'bank_account',
    )!.access;
  const safe = projectActivityDetail(config, 'u-lin', detail);
  expect(safe.activity.payload.bank_account).toBe('AC****ET');
  expect(safe.activity.snapshots[0]!.payload.bank_account).toBe('AC****ET');
  expect(
    safe.activity.schema.fields.find(
      /**
       * 按测试标识匹配目标组织、字段或节点。
       * @param field 测试集合当前项
       * @returns 是否符合本次匹配条件
       */
      (field) => field.key === 'bank_account',
    ),
  ).toMatchObject({ type: 'text', readOnly: true, redacted: true, default: '', options: [] });
  expect(
    mergeWritablePayload(config, 'u-lin', detail.activity, detail.activity.schema, {
      bank_account: 'AC****ET',
    }).bank_account,
  ).toBe('ACCOUNT-SECRET');
  expect(
    /**
     * 调用受保护能力，供断言检查授权或拒绝结果。
     * @returns 当前映射或受保护调用的结果
     */
    () =>
      mergeWritablePayload(config, 'u-lin', detail.activity, detail.activity.schema, {
        bank_account: '篡改',
      }),
  ).toThrow('无权修改');
  expect(JSON.stringify(applicantForm(config, 'u-lin', config.form))).not.toContain('DEFAULT-SECRET');
}
test('当前字段约束覆盖旧快照，脱敏只读且服务器保留原值', fieldCase);

/** 核对节点与附件规则取交集，附件级共享无法放大节点权限，上传者只能收紧。 */
function fileIntersectionCase(): void {
  const { config, detail } = fixture();
  detail.files[0]!.access = { mode: 'shared', roleIds: [], userIds: [] };
  expect(
    projectActivityDetail(config, 'u-zhao', detail).files.map(
      /**
       * 将测试记录转换为查询行或断言标识。
       * @param file 测试集合当前项
       * @returns 当前映射或受保护调用的结果
       */
      (file) => file.id,
    ),
  ).not.toContain('f-private');
  const previous: DataAccessRule = { mode: 'restricted', roleIds: ['finance'], userIds: [] };
  expect(isNarrowerAccess(previous, { ...previous, roleIds: ['finance', 'marketing'] })).toBe(false);
  expect(isNarrowerAccess(previous, { ...previous, mode: 'shared' })).toBe(false);
  expect(isNarrowerAccess({ mode: 'shared', roleIds: [], userIds: [] }, previous)).toBe(true);
  expect(configSchema.safeParse(config).success).toBe(true);
  expect(validateConfig(config)).toEqual([]);
}
test('节点与附件取交集并拒绝上传者扩大接收范围', fileIntersectionCase);

/**
 * 提供真实服务使用的数据库协议替身，未知查询立即失败，不启动任何数据库或HTTP服务。
 * @param config 公司配置
 * @param detail 完整实例
 * @returns 连接池替身与审计动作记录
 */
function database(config: CompanyConfig, detail: ActivityDetail) {
  const actions: string[] = [];
  /**
   * 按真实仓储SQL提供原始行，保证读取服务确实执行过滤和审计。
   * @param sql SQL文本
   * @param params 查询参数
   * @returns 驱动行结构
   */
  async function execute(sql: string, params: unknown[] = []): Promise<[unknown[], unknown[]]> {
    if (sql.includes('FROM configuration'))
      return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
    if (sql.startsWith('SELECT COUNT(*) AS total FROM activities')) return [[{ total: 1 }], []];
    if (sql.includes('FROM activities')) return [[{ data: structuredClone(detail.activity) }], []];
    if (sql.includes('FROM workflow_nodes'))
      return [
        detail.activity.nodes.map(
          /**
           * 将测试记录转换为查询行或断言标识。
           * @param node 测试集合当前项
           * @returns 当前映射或受保护调用的结果
           */
          (node) => ({ activity_id: detail.activity.id, data: node }),
        ),
        [],
      ];
    if (sql.includes('FROM workflow_tasks'))
      return [
        detail.activity.tasks.map(
          /**
           * 将测试记录转换为查询行或断言标识。
           * @param task 测试集合当前项
           * @returns 当前映射或受保护调用的结果
           */
          (task) => ({ data: task }),
        ),
        [],
      ];
    if (sql.includes('FROM audit_events'))
      return [
        detail.activity.audit.map(
          /**
           * 将测试记录转换为查询行或断言标识。
           * @param event 测试集合当前项
           * @returns 当前映射或受保护调用的结果
           */
          (event) => ({ data: event }),
        ),
        [],
      ];
    if (sql.startsWith('SELECT activity_id,storage_key'))
      return [[{ activity_id: 'a1', storage_key: 'a'.repeat(64) }], []];
    if (sql.includes('FROM files'))
      return [
        detail.files.map(
          /**
           * 将测试记录转换为查询行或断言标识。
           * @param file 测试集合当前项
           * @returns 当前映射或受保护调用的结果
           */
          (file) => ({
            id: file.id,
            activity_id: file.activityId,
            node_id: file.nodeId || null,
            uploader_id: file.uploaderId || '',
            name: file.name,
            size: file.size,
            mime: file.mime,
            stage: file.stage,
            access_rule: file.access || null,
            download_rule: file.downloadAccess || null,
            created_at: '',
          }),
        ),
        [],
      ];
    if (sql.startsWith('INSERT INTO audit_events')) {
      actions.push(String(params[3]));
      return [[], []];
    }
    throw new Error('未声明的SQL：' + sql);
  }
  /** 测试事务边界无需提交外部状态。 */
  async function boundary(): Promise<void> {}
  /** 释放替身连接，无外部资源。 */
  function release(): void {}
  const connection = { execute, beginTransaction: boundary, commit: boundary, rollback: boundary, release };
  /**
   * 交付同一连接，覆盖服务的事务读取路径。
   * @returns 替身连接
   */
  async function getConnection() {
    return connection;
  }
  return { pool: { execute, getConnection } as unknown as Pool, actions };
}

/** 核对直接调用真实详情和下载服务仍执行内容授权，成功的敏感读取留有记录。 */
async function servicesCase(): Promise<void> {
  const { config, detail } = fixture();
  const db = database(config, detail);
  expect(JSON.stringify(await getDetail(db.pool, 'u-zhao', 'a1'))).not.toContain('INTERNAL-SECRET');
  await expect(authorizeFileRead(db.pool, 'u-zhao', 'f-private')).rejects.toMatchObject({ status: 404 });
  await expect(authorizeFileRead(db.pool, 'u-zhou', 'f-private')).resolves.toMatchObject({
    mime: 'application/pdf',
  });
  await getDetail(db.pool, 'u-zhou', 'a1');
  expect(db.actions).toContain('下载授权附件');
  expect(db.actions).toContain('查看授权敏感资料');
  const leader = config.roles.find(
    /**
     * 按测试标识匹配目标组织、字段或节点。
     * @param role 测试集合当前项
     * @returns 是否符合本次匹配条件
     */
    (role) => role.id === 'director',
  )!;
  leader.permissions.push('activity:sensitive:read', 'file:download');
  await expect(authorizeFileRead(db.pool, 'u-liu', 'f-private')).rejects.toMatchObject({ status: 403 });
  await expect(authorizeFileRead(db.pool, 'u-liu', 'f-private', true)).resolves.toMatchObject({
    mime: 'application/pdf',
  });
}
test('真实详情和直接下载服务拒绝越权并记录敏感访问', servicesCase);

/** 核对列表和列表导出同样过滤实时收紧的预算字段，不从摘要旁路读取金额。 */
async function listCase(): Promise<void> {
  const { config, detail } = fixture();
  config.form.fields.find(
    /**
     * 按测试标识匹配目标组织、字段或节点。
     * @param field 测试集合当前项
     * @returns 是否符合本次匹配条件
     */
    (field) => field.key === 'budget',
  )!.access = {
    read: { mode: 'restricted', roleIds: ['finance'], userIds: [], applicant: true },
    mask: 'hidden',
  };
  const db = database(config, detail);
  const input = { q: '', status: '', scope: 'all' as const, page: 1, pageSize: 20 };
  const safe = await listActivities(db.pool, 'u-zhao', input);
  expect(safe.items[0]!.budget).toBe('');
  expect(safe.items[0]!.restrictedFields).toContain('budget');
  config.roles
    .find(
      /**
       * 按测试标识匹配目标组织、字段或节点。
       * @param role 测试集合当前项
       * @returns 是否符合本次匹配条件
       */
      (role) => role.id === 'finance',
    )!
    .permissions.push('activity:export');
  expect((await listActivities(db.pool, 'u-zhou', input)).items[0]!.budget).toBe('12000');
  expect((await listActivities(db.pool, 'u-zhou', input, true)).items[0]!.budget).toBe('');
}
test('列表和列表导出不会旁路读取被限制的预算', listCase);

/** 核对增量迁移只添加缺失列，重复执行保持历史配置和文件不变并释放迁移锁。 */
async function migrationCase(): Promise<void> {
  const columns = new Set<string>();
  const statements: string[] = [];
  let releases = 0;
  /**
   * 模拟信息模式及固定DDL，只记录本次新增列，不执行数据库操作。
   * @param sql 迁移查询或语句
   * @returns 模拟驱动结果
   */
  async function execute(sql: string): Promise<[unknown[], unknown[]]> {
    statements.push(sql);
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
    if (sql.includes('RELEASE_LOCK')) return [[], []];
    if (sql.includes('information_schema'))
      return [
        [...columns].map(
          /**
           * 将测试记录转换为查询行或断言标识。
           * @param COLUMN_NAME 测试集合当前项
           * @returns 当前映射或受保护调用的结果
           */
          (COLUMN_NAME) => ({ COLUMN_NAME }),
        ),
        [],
      ];
    if (sql.startsWith('ALTER TABLE')) {
      columns.add(sql.split('ADD COLUMN ')[1]!.split(' ')[0]!);
      return [[], []];
    }
    if (sql.startsWith('INSERT IGNORE INTO schema_migrations')) return [[], []];
    throw new Error(sql);
  }
  /** 归还迁移连接，便于断言错误或重复迁移时没有泄漏资源。 */
  function release(): void {
    releases++;
  }
  /**
   * 返回同一套迁移列状态，模拟第二次执行时表结构已经升级。
   * @returns 迁移连接替身
   */
  async function getConnection() {
    return { execute, query: execute, release };
  }
  const pool = { getConnection } as unknown as Pool;
  await migrateDataSecurity(pool);
  await migrateDataSecurity(pool);
  expect(
    statements.filter(
      /**
       * 筛选当前安全断言需要统计的语句或记录。
       * @param sql 测试集合当前项
       * @returns 是否符合本次匹配条件
       */
      (sql) => sql.startsWith('ALTER TABLE'),
    ),
  ).toHaveLength(3);
  expect(releases).toBe(2);
  expect(columns.size).toBe(3);
}
test('附件数据权限迁移可重复执行且只补齐缺失列', migrationCase);

/** 核对切换到宽权限新表单时仍保留旧敏感值的约束，防止模板切换造成泄露。 */
function templatePrivacyCase(): void {
  const { config, detail } = fixture();
  const next = structuredClone(config.form);
  delete next.fields.find(
    /**
     * 按测试标识匹配目标组织、字段或节点。
     * @param field 测试集合当前项
     * @returns 是否符合本次匹配条件
     */
    (field) => field.key === 'bank_account',
  )!.access;
  config.form = structuredClone(next);
  detail.activity.schema = preserveFormAccess(detail.activity.schema, next);
  const safe = projectActivityDetail(config, 'u-lin', detail);
  expect(safe.activity.payload.bank_account).toBeUndefined();
  expect(
    mergeWritablePayload(config, 'u-lin', detail.activity, detail.activity.schema, {}).bank_account,
  ).toBe('ACCOUNT-SECRET');
  expect(JSON.stringify(safe)).not.toContain('ACCOUNT-SECRET');
}
test('新模板宽权限不会重新暴露已有敏感字段原值', templatePrivacyCase);
