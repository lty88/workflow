import { expect, test } from 'vitest';
import type { Activity, ActivityDetail, CompanyConfig, DataAccessRule, FileRecord } from '@workflow/domain';
import {
  applicantForm,
  canDownloadFile,
  canReadFile,
  canUpdateFileAccess,
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
 * 构造显式私有财务节点、敏感字段、历史意见与分级附件，验证限制不会被新申请的默认共享覆盖。
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
    access: { mode: 'restricted', roleIds: [], userIds: [], nodeAssignees: true },
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

/**
 * 为下载相关用例单独授予申请人下载权限，区分角色能力与文件可见范围。
 * @param config 测试组织配置
 */
function grantApplicantDownload(config: CompanyConfig): void {
  const role = config.roles.find(
    /**
     * 取得申请人角色。
     * @param item 角色记录
     * @returns 是否申请人角色
     */
    (item) => item.id === 'applicant',
  )!;
  role.permissions.push('file:download');
}

/** 核对附件明确共享独立于内部说明，默认继承的附件仍保持节点隔离。 */
function fileSharingCase(): void {
  const { config, detail, nodeId } = fixture();
  grantApplicantDownload(config);
  const file = detail.files[0]!;
  expect(canReadFile(config, 'u-lin', detail.activity, file)).toBe(false);
  file.access = { mode: 'shared', roleIds: [], userIds: [] };
  const safe = projectActivityDetail(config, 'u-lin', detail);
  expect(
    safe.files.some(
      /**
       * 定位申请人已获分享的节点附件。
       * @param item 投影后的附件
       * @returns 是否为共享文件
       */
      (item) => item.id === file.id,
    ),
  ).toBe(true);
  expect(safe.access!.readableNodeIds).not.toContain(nodeId);
  expect(safe.activity.tasks[0]!.comment).toBe('');
  expect(safe.activity.tasks[0]!.publicComment).toBe('财务资料待补充');
  expect(canDownloadFile(config, 'u-lin', detail.activity, file)).toBe(true);
  expect(canReadFile(config, 'u-qiao', detail.activity, file)).toBe(false);
  const previous: DataAccessRule = { mode: 'restricted', roleIds: ['finance'], userIds: [] };
  expect(isNarrowerAccess(previous, { ...previous, roleIds: ['finance', 'marketing'] })).toBe(false);
  expect(isNarrowerAccess(previous, { ...previous, mode: 'shared' })).toBe(false);
  expect(isNarrowerAccess({ mode: 'shared', roleIds: [], userIds: [] }, previous)).toBe(true);
  expect(configSchema.safeParse(config).success).toBe(true);
  expect(validateConfig(config)).toEqual([]);
}
test('明确共享附件对活动申请人开放，内部说明与继承附件保持独立', fileSharingCase);

/** 核对文件指定受众和独立下载范围生效，下载仍依赖角色权限。 */
function fileAudienceCase(): void {
  const { config, detail } = fixture();
  grantApplicantDownload(config);
  const file = detail.files[0]!;
  const node = detail.activity.nodes.find(
    /**
     * 定位附件所属节点以设置默认下载范围。
     * @param item 流程节点
     * @returns 是否为所属节点
     */
    (item) => item.id === file.nodeId,
  )!;
  node.downloadAccess = { mode: 'restricted', roleIds: ['finance'], userIds: [] };
  file.access = { mode: 'restricted', roleIds: [], userIds: [], applicant: true };
  expect(canReadFile(config, 'u-lin', detail.activity, file)).toBe(true);
  expect(canReadFile(config, 'u-zhao', detail.activity, file)).toBe(false);
  expect(canDownloadFile(config, 'u-lin', detail.activity, file)).toBe(true);
  file.downloadAccess = { mode: 'restricted', roleIds: ['finance'], userIds: [] };
  expect(canReadFile(config, 'u-lin', detail.activity, file)).toBe(true);
  expect(canDownloadFile(config, 'u-lin', detail.activity, file)).toBe(false);
  file.downloadAccess = { mode: 'shared', roleIds: [], userIds: [] };
  const applicantRole = config.roles.find(
    /**
     * 获取申请人角色以模拟下载权限被撤销。
     * @param role 组织角色
     * @returns 是否申请人角色
     */
    (role) => role.id === 'applicant',
  )!;
  applicantRole.permissions = applicantRole.permissions.filter(
    /**
     * 移除下载能力，保留活动阅读资格。
     * @param permission 角色权限
     * @returns 是否保留
     */
    (permission) => permission !== 'file:download',
  );
  expect(canReadFile(config, 'u-lin', detail.activity, file)).toBe(true);
  expect(canDownloadFile(config, 'u-lin', detail.activity, file)).toBe(false);
}
test('文件指定授权与下载规则独立生效，下载仍检查角色权限', fileAudienceCase);

/** 核对尚未提交的表单附件即使设置共享也不会提前向申请人开放。 */
function pendingSharedFileCase(): void {
  const { config, detail } = fixture();
  const file = detail.files[0]!;
  file.access = { mode: 'shared', roleIds: [], userIds: [] };
  file.contextId = 'pending-context';
  expect(canReadFile(config, 'u-lin', detail.activity, file)).toBe(false);
  expect(canReadFile(config, 'u-zhou', detail.activity, file)).toBe(true);
  detail.activity.audit.push({
    id: 'committed',
    actor: 'u-zhou',
    actorName: '审核人',
    action: '通过',
    note: '',
    attachmentContextId: file.contextId,
    createdAt: '',
  });
  expect(canReadFile(config, 'u-lin', detail.activity, file)).toBe(true);
  file.nodeId = 'missing-node';
  expect(canReadFile(config, 'u-lin', detail.activity, file)).toBe(false);
}
test('单文件共享仍隔离未提交附件且校验节点存在', pendingSharedFileCase);

/** 核对指定部门负责人可以阅读自己的节点，负责人变更后旧账号失去节点阅读资格。 */
function departmentManagerReaderCase(): void {
  const { config, detail } = fixture();
  const node = detail.activity.nodes.find(
    /**
     * 获取财务测试节点并切换为指定部门负责人的受理方式。
     * @param item 流程节点
     * @returns 是否目标节点
     */
    (item) => item.id === detail.files[0]!.nodeId,
  )!;
  node.assigneeRule = { type: 'department_manager', value: 'research' };
  expect(canReadNodeContent(config, 'u-zhou', detail.activity, node)).toBe(true);
  config.departments.find(
    /**
     * 定位教育研究院以模拟负责人变更。
     * @param department 组织部门
     * @returns 是否指定部门
     */
    (department) => department.id === 'research',
  )!.manager = 'u-chen';
  expect(canReadNodeContent(config, 'u-zhou', detail.activity, node)).toBe(false);
}
test('指定部门负责人规则参与节点阅读权限并实时响应负责人变更', departmentManagerReaderCase);

/** 核对只有仍有节点阅读资格的上传人可分享自己的文件，其他读者不能修改。 */
function fileAccessManagementCase(): void {
  const { config, detail } = fixture();
  const file = detail.files[0]!;
  file.access = { mode: 'restricted', roleIds: ['finance'], userIds: [] };
  const next = {
    access: { mode: 'shared', roleIds: [], userIds: [] },
  } satisfies import('@workflow/domain').FileAccessInput;
  expect(canUpdateFileAccess(config, 'u-zhou', detail.activity, file, next)).toBe(true);
  expect(canUpdateFileAccess(config, 'u-lin', detail.activity, file, next)).toBe(false);
  file.access = { mode: 'shared', roleIds: [], userIds: [] };
  config.users.find(
    /**
     * 取上传人以撤回其财务节点受理资格。
     * @param user 组织成员
     * @returns 是否上传人
     */
    (user) => user.id === 'u-zhou',
  )!.roles = ['academic'];
  expect(canReadFile(config, 'u-zhou', detail.activity, file)).toBe(true);
  expect(canUpdateFileAccess(config, 'u-zhou', detail.activity, file, {})).toBe(false);
  expect(
    canUpdateFileAccess(config, 'u-zhou', detail.activity, file, {
      access: { mode: 'restricted', roleIds: [], userIds: ['u-zhou'] },
    }),
  ).toBe(true);
}
test('节点上传人可主动分享，节点资格撤回后仅可收紧文件权限', fileAccessManagementCase);

/** 核对申请人可以通过节点明确授权阅读内部说明，同部门身份本身不构成授权。 */
function applicantNodeAccessCase(): void {
  const { config, detail } = fixture();
  const node = detail.activity.nodes.find(
    /**
     * 定位包含内部说明的节点。
     * @param item 流程节点
     * @returns 是否目标节点
     */
    (item) => item.id === detail.activity.tasks[0]!.nodeId,
  )!;
  expect(projectActivityDetail(config, 'u-lin', detail).activity.tasks[0]!.comment).toBe('');
  node.access = { mode: 'restricted', roleIds: [], userIds: [], nodeAssignees: true, applicant: true };
  expect(projectActivityDetail(config, 'u-lin', detail).activity.tasks[0]!.comment).toBe('INTERNAL-SECRET');
}
test('节点勾选申请人可开放内部说明，未授权时只展示公开结论', applicantNodeAccessCase);

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
    if (sql.includes('FROM execution_records')) return [[], []];
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

/** 核对真实详情与文件下载服务按显式共享返回文件，同时继续过滤节点内部说明。 */
async function sharedFileServiceCase(): Promise<void> {
  const { config, detail } = fixture();
  grantApplicantDownload(config);
  detail.files[0]!.access = { mode: 'shared', roleIds: [], userIds: [] };
  const db = database(config, detail);
  const safe = await getDetail(db.pool, 'u-lin', 'a1');
  expect(
    safe.files.some(
      /**
       * 定位服务端实际返回的共享附件。
       * @param file 已授权附件
       * @returns 是否目标文件
       */
      (file) => file.id === 'f-private',
    ),
  ).toBe(true);
  expect(JSON.stringify(safe)).not.toContain('INTERNAL-SECRET');
  await expect(authorizeFileRead(db.pool, 'u-lin', 'f-private')).resolves.toMatchObject({
    mime: 'application/pdf',
  });
  await expect(authorizeFileRead(db.pool, 'u-qiao', 'f-private')).rejects.toMatchObject({ status: 404 });
}
test('真实详情与下载服务放行活动内共享文件并保留内部说明隔离', sharedFileServiceCase);

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
