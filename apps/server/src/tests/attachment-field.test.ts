import { expect, test, vi } from 'vitest';
import { defaultRequestForm, canAccessField, isSensitiveField } from '@workflow/domain';
import { materialNodes } from '../../../web/src/components/activity/node-materials';
import type { Pool, PoolConnection } from 'mysql2/promise';
import {
  attachmentIds,
  attachmentFileErrors,
  canReadFile,
  canDownloadFile,
  configSchema,
  defaultValues,
  projectActivityDetail,
  seedConfig,
  validateAttachmentReferences,
  validateConfig,
  validateForm,
} from '@workflow/domain';
import type { Activity, ActivityDetail, FileRecord, FormField } from '@workflow/domain';
import type { MutationContext } from '../services/activity-service';
import { mutateActivity } from '../services/activity-service';
import { uploadFile } from '../services/file-service';
import { validateActivityStep } from '../../../web/src/components/activity/step-validation';
vi.mock(
  '../services/activity-service',
  /** 隔离活动事务调度，由各用例传入固定的权限及版本上下文。
   * @returns 可替换的事务函数
   */ function mockActivityService() {
    return { mutateActivity: vi.fn() };
  },
);
vi.mock(
  'node:fs/promises',
  /** 隔离附件落盘，校验真实上传逻辑而不写文件。
   * @returns 文件系统操作替身
   */ function mockFileSystem() {
    return { mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() };
  },
);
/** 构造申请人可编辑、部门负责人可访问的草稿与独立附件字段，不连接数据库。
 * @returns 组织、活动、字段、附件和完整详情
 */
function fixture() {
  const config = seedConfig();
  const field: FormField = {
    id: 'supporting',
    key: 'supporting_files',
    label: '申请证明材料',
    type: 'attachment',
    required: true,
    default: '',
    options: [],
    upload: { maxCount: 2, maxSizeMB: 1, extensions: ['pdf'] },
  };
  config.form.fields.push(field);
  const activity: Activity = {
    id: 'a1',
    code: 'HD-TEST',
    name: '附件测试活动',
    applicant: 'u-lin',
    department: 'd1',
    status: 'draft',
    version: 1,
    revision: 0,
    structureRevision: 1,
    configVersion: 1,
    schema: structuredClone(config.form),
    payload: { activity_name: '附件测试活动' },
    snapshots: [],
    nodes: [],
    tasks: [],
    audit: [],
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
  const file: FileRecord = {
    id: 'f1',
    activityId: 'a1',
    fieldKey: field.key,
    name: '申请证明.pdf',
    size: 100,
    mime: 'application/pdf',
    stage: 'application' as const,
    createdAt: '',
  };
  const detail: ActivityDetail = { activity, files: [file], actions: [], participants: [], taskWarnings: [] };
  return { config, activity, field, file, detail };
}
/** 核对空数组不满足必填，附件必填在内容步骤拦截，隐藏字段不触发必填。
 */
function requiredCase(): void {
  const { field } = fixture();
  const form = { id: 'test', name: '附件表单', fields: [field] };
  expect(validateForm(form, { supporting_files: '[]' }).issues).toEqual([
    { key: field.key, message: '申请证明材料为必填项，请上传附件' },
  ]);
  expect(validateActivityStep(form, { supporting_files: '' }, 2, true).errors).toHaveLength(1);
  expect(validateForm(form, { supporting_files: '["f1"]' }).errors).toEqual([]);
  field.visible = { field: 'toggle', operator: 'eq', value: '是' };
  expect(validateForm(form, {}).errors).toEqual([]);
  expect(validateForm(form, { supporting_files: '["f1"]' }).payload).toEqual({});
}
test('附件字段必填、内容步骤和条件显隐一起校验', requiredCase);
/** 核对伪造格式、重复ID、数量超限以及附件默认值不能绕过上传。
 */
function formatCase(): void {
  const { field, config } = fixture();
  const form = { id: 'test', name: '附件表单', fields: [field] };
  for (const value of ['not-json', '{}', '[1]', '["f1","f1"]']) expect(attachmentIds(value)).toBeNull();
  expect(validateForm(form, { supporting_files: '["f1","f2","f3"]' }).errors.join()).toContain('最多上传2');
  field.default = '["f1"]';
  expect(defaultValues(form)[field.key]).toBe('');
  expect(validateConfig(config).join()).toContain('不能配置默认文件');
}
test('附件值限制ID数组、去重、数量且不支持预置默认附件', formatCase);
/** 核对文件只能属于当前活动的同名字段，大小和格式在保存时再次检查。
 */
function referencesCase(): void {
  const { field, file, activity } = fixture();
  const form = { id: 'test', name: '附件表单', fields: [field] };
  const payload = { [field.key]: '["f1"]' };
  expect(validateAttachmentReferences(form, payload, [file], activity.id)).toEqual([]);
  for (const foreign of [
    { ...file, activityId: 'other' },
    { ...file, fieldKey: 'other_field' },
    { ...file, stage: 'archive' as const },
  ])
    expect(validateAttachmentReferences(form, payload, [foreign], activity.id).join()).toContain(
      '不属于本活动该字段',
    );
  expect(validateAttachmentReferences(form, payload, [], activity.id)).toHaveLength(1);
  expect(attachmentFileErrors(field, { name: '恶意.exe', size: 2 * 1024 * 1024 })).toHaveLength(2);
  expect(attachmentFileErrors(field, { name: '证明.PDF', size: 100 })).toEqual([]);
}
test('服务端引用校验拒绝其他活动、其他字段、错误阶段和超限文件', referencesCase);
/** 核对明确共享的字段附件仍受字段权限限制，元数据、预览、下载与历史快照统一隔离。
 */
function privacyCase(): void {
  const { config, field, file, activity, detail } = fixture();
  file.access = { mode: 'shared', roleIds: [], userIds: [] };
  activity.payload[field.key] = '["f1"]';
  expect(canReadFile(config, 'u-chen', activity, file)).toBe(true);
  const restricted = {
    read: { mode: 'restricted' as const, roleIds: [], userIds: [], applicant: true },
    mask: 'hidden' as const,
  };
  field.access = restricted;
  expect(canReadFile(config, 'u-chen', activity, file)).toBe(false);
  expect(canDownloadFile(config, 'u-chen', activity, file)).toBe(false);
  const safe = projectActivityDetail(config, 'u-chen', detail);
  expect(safe.files).toEqual([]);
  expect(safe.activity.payload[field.key]).toBeUndefined();
  expect(canReadFile(config, 'u-lin', activity, file)).toBe(true);
  activity.snapshots.push({
    revision: 1,
    schema: structuredClone(activity.schema),
    payload: { ...activity.payload },
    workflow: [],
    configVersion: 1,
    submittedAt: '',
  });
  activity.payload[field.key] = '';
  expect(canReadFile(config, 'u-lin', activity, file)).toBe(true);
  expect(canReadFile(config, 'u-chen', activity, file)).toBe(false);
  activity.snapshots = [];
  expect(canReadFile(config, 'u-lin', activity, file)).toBe(false);
}
test('字段附件继承当前和历史权限，不可通过文件地址绕过字段限制', privacyCase);
/** 核对配置持久化支持附件规则，同时拒绝把附件作为条件来源。
 */
function settingsCase(): void {
  const { config, field } = fixture();
  expect(configSchema.parse(config).form.fields.at(-1)?.type).toBe('attachment');
  field.upload!.maxCount = 11;
  expect(configSchema.safeParse(config).success).toBe(false);
  field.upload!.maxCount = 2;
  config.workflow.nodes[0]!.condition = { field: field.key, operator: 'eq', value: 'f1' };
  expect(validateConfig(config).join()).toContain('不能用附件字段作为流程条件');
}
test('附件字段规则可保存，非法数量与附件流程条件被拒绝', settingsCase);
/** 验证上传登记字段归属并在同一事务回填表单引用，不占用普通阶段附件配额。
 */
async function uploadCase(): Promise<void> {
  const { config, activity, field } = fixture();
  const execute = vi.fn().mockResolvedValue([{}, []]);
  /** 在隔离事务上下文中执行真实上传回调。
   * @param _pool 不使用的连接池
   * @param _actor 当前申请人
   * @param _key 幂等键
   * @param _request 请求摘要
   * @param _id 活动ID
   * @param work 上传变更回调
   * @returns 模拟提交后的活动版本
   */
  async function mutate(
    _pool: Pool,
    _actor: string,
    _key: string,
    _request: string,
    _id: string | null,
    work: (context: MutationContext) => Promise<Activity>,
  ) {
    await work({ config, activity, connection: { execute } as unknown as PoolConnection });
    return { id: activity.id, version: 2 };
  }
  vi.mocked(mutateActivity).mockImplementation(mutate);
  const file = await uploadFile(
    {} as Pool,
    '/unused',
    'u-lin',
    activity.id,
    'application',
    'proof.pdf',
    Buffer.from('%PDF-test'),
    'key-one',
    { fieldKey: field.key },
  );
  expect(attachmentIds(activity.payload[field.key])).toEqual([file.id]);
  expect(file.fieldKey).toBe(field.key);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][0]).toContain('field_key');
  expect(execute.mock.calls[0][1][9]).toBe(field.key);
  activity.payload[field.key] = '["f1","f2"]';
  await expect(
    uploadFile(
      {} as Pool,
      '/unused',
      'u-lin',
      activity.id,
      'application',
      'proof.pdf',
      Buffer.from('%PDF-test'),
      'key-two',
      { fieldKey: field.key },
    ),
  ).rejects.toThrow('最多上传2');
  expect(execute).toHaveBeenCalledTimes(1);
}
test('真实上传回调原子保存字段附件与ID，数量超限时不写入', uploadCase);
/** 核对不属于可见附件字段的上传会在写入前拒绝。
 */
async function forbiddenUploadCase(): Promise<void> {
  const { config, activity, field } = fixture();
  const execute = vi.fn().mockResolvedValue([{}, []]);
  /** 执行权限校验对应的上传事务回调。
   * @param _pool 未连接的测试池
   * @param _actor 申请人
   * @param _key 幂等键
   * @param _request 请求摘要
   * @param _id 当前活动
   * @param work 真实上传逻辑
   * @returns 模拟活动版本
   */
  async function mutate(
    _pool: Pool,
    _actor: string,
    _key: string,
    _request: string,
    _id: string | null,
    work: (context: MutationContext) => Promise<Activity>,
  ) {
    await work({ config, activity, connection: { execute } as unknown as PoolConnection });
    return { id: activity.id, version: 2 };
  }
  vi.mocked(mutateActivity).mockImplementation(mutate);
  const buffer = Buffer.from('%PDF-test');
  await expect(
    uploadFile({} as Pool, '/unused', 'u-lin', activity.id, 'application', 'a.pdf', buffer, 'key', {
      fieldKey: 'other_field',
    }),
  ).rejects.toThrow('无填写权限');
  await expect(
    uploadFile({} as Pool, '/unused', 'u-lin', activity.id, 'archive', 'a.pdf', buffer, 'key', {
      fieldKey: field.key,
    }),
  ).rejects.toThrow('仅允许申请阶段');
  activity.schema.fields.at(-1)!.visible = { field: 'service_type', operator: 'eq', value: '收费课题培训' };
  await expect(
    uploadFile({} as Pool, '/unused', 'u-lin', activity.id, 'application', 'a.pdf', buffer, 'key', {
      fieldKey: field.key,
    }),
  ).rejects.toThrow('无填写权限');
  expect(execute).not.toHaveBeenCalled();
}
test('伪造字段、错误阶段和隐藏字段上传在落盘前被拒绝', forbiddenUploadCase);


/** 独立通用表单及其他ID表单的同名附件字段，不受活动公共表单权限串扰；自身限制仍严格生效。 */
function independentFormAccessCase(): void {
  for (const general of [true, false]) {
    const { config, activity, field, file, detail } = fixture();
    const local = structuredClone(field);
    activity.schema = general ? { ...defaultRequestForm(), fields:[local] } : { id:'other-form',name:'其他表单',fields:[local] };
    if (general) activity.lifecycle = {businessType:'general',afterApproval:'complete',version:1};
    activity.payload[field.key] = JSON.stringify([file.id]);
    file.access = {mode:'shared',roleIds:[],userIds:[]};
    field.access = {read:{mode:'restricted',roleIds:[],userIds:[],applicant:true},mask:'hidden'};
    expect(canAccessField(config,'u-chen',activity,local)).toBe(true);
    expect(isSensitiveField(config,local,activity.schema)).toBe(false);
    expect(canReadFile(config,'u-chen',activity,file)).toBe(true);
    expect(projectActivityDetail(config,'u-chen',detail).files).toHaveLength(1);
    local.access = {read:{mode:'restricted',roleIds:[],userIds:[],applicant:true},mask:'hidden'};
    expect(canReadFile(config,'u-chen',activity,file)).toBe(false);
    expect(projectActivityDetail(config,'u-chen',detail).files).toHaveLength(0);
  }
}
test('不同表单同名字段隔离，通用及独立附件仍执行自己的冻结权限',independentFormAccessCase);

/** 历史附件按原表单判断，不因当前申请换用另一个同名字段表单而误套权限。 */
function historicalFormAccessCase(): void {
  const { config, activity, field, file } = fixture();
  activity.schema.id = 'historical-form';
  activity.payload[field.key] = JSON.stringify([file.id]);
  activity.snapshots.push({revision:1,schema:structuredClone(activity.schema),payload:structuredClone(activity.payload),workflow:[],configVersion:1,submittedAt:''});
  field.access = {read:{mode:'restricted',roleIds:[],userIds:[],applicant:true},mask:'hidden'};
  activity.schema = structuredClone(config.form);
  activity.payload[field.key] = '';
  expect(canReadFile(config,'u-chen',activity,file)).toBe(true);
  activity.snapshots[0]!.schema.fields.find(
    /** 收紧原历史表单的字段，核验文件共享无法绕过该字段约束。
     * @param item 历史字段
     * @returns 是否附件字段
     */ function attachment(item) { return item.key === field.key; },
  )!.access = {read:{mode:'restricted',roleIds:[],userIds:[],applicant:true},mask:'hidden'};
  file.access = {mode:'shared',roleIds:[],userIds:[]};
  expect(canReadFile(config,'u-chen',activity,file)).toBe(false);
}
test('历史附件保留原表单权限边界，显式共享也无法绕过其冻结限制',historicalFormAccessCase);

/** 当前申请被退回或终止后仍展示已授权节点资料，历史申请由开关控制，不暴露受限文件。 */
function invalidatedNodeMaterialsCase(): void {
  const { config, activity, file, detail } = fixture();
  activity.revision = 2;
  activity.status = 'rejected';
  const node = {id:'current-node',key:'current',label:'已终止审批',kind:'approval' as const,deps:[],status:'invalidated' as const,generation:1,applicationRevision:2,assignees:['u-chen'],assigneeRule:{type:'manager' as const,value:''}};
  activity.nodes = [node,{...node,id:'old-node',applicationRevision:1},{...node,id:'skipped-node',status:'skipped'},{...node,id:'business-node',businessStage:'execution'}];
  file.stage = 'node'; file.nodeId = node.id; delete file.fieldKey;
  file.access = {mode:'shared',roleIds:[],userIds:[]};
  const safe = projectActivityDetail(config,'u-lin',detail);
  expect(safe.access!.readableNodeIds).not.toContain(node.id);
  expect(safe.files).toHaveLength(1);
  expect(safe.access!.uploadNodeIds).toEqual([]);
  expect(materialNodes(safe.activity,safe.files).map(
    /** 提取实际展示的节点。
     * @param item 节点
     * @returns 标识
     */ function id(item) { return item.id; },
  )).toEqual(['current-node']);
  expect(materialNodes(safe.activity,safe.files,true)).toHaveLength(2);
  safe.files.push({...safe.files[0]!,id:'shared-skipped',nodeId:'skipped-node'});
  expect(materialNodes(safe.activity,safe.files)).toHaveLength(2);
  delete file.access;
  expect(projectActivityDetail(config,'u-lin',detail).files).toHaveLength(0);
}
test('退回终止的本轮节点资料保留、历史开关只控制旧申请，权限过滤不变',invalidatedNodeMaterialsCase);

/** 对已能查看的附件区分缺少下载能力与文件受众不匹配，不以共享设置替代角色能力。 */
function downloadHintsCase(): void {
  const { config, activity, field, file, detail } = fixture();
  activity.payload[field.key] = JSON.stringify([file.id]);
  let projected = projectActivityDetail(config,'u-lin',detail).files[0]!;
  expect(projected.canDownload).toBe(false);
  expect(projected.downloadHint).toContain('角色');
  config.roles.find(
    /** 增加角色下载能力以隔离文件受众规则的影响。
     * @param role 当前角色
     * @returns 是否申请人角色
     */ function applicant(role) { return role.id === 'applicant'; },
  )!.permissions.push('file:download');
  file.downloadAccess = {mode:'restricted',roleIds:[],userIds:[],departmentManager:true};
  projected = projectActivityDetail(config,'u-lin',detail).files[0]!;
  expect(projected.canDownload).toBe(false);
  expect(projected.downloadHint).toContain('授权范围');
  file.downloadAccess = {mode:'shared',roleIds:[],userIds:[]};
  projected = projectActivityDetail(config,'u-lin',detail).files[0]!;
  expect(projected.canDownload).toBe(true);
  expect(projected.downloadHint).toBeUndefined();
}
test('下载受限原因区分角色能力和文件范围，授权通过后不残留错误提示',downloadHintsCase);
