import { expect, test, vi } from 'vitest';
import type { Pool, PoolConnection } from 'mysql2/promise';
import {
  seedConfig,
  instantiateWorkflow,
  advanceWorkflow,
  collaborationDispatchSchema,
  collaborationActionSchema,
  attachmentContextCommitted,
} from '@workflow/domain';
import type { Activity, FileRecord } from '@workflow/domain';
import { mutateActivity } from '../services/activity-service';
import { activityFiles, enqueue, query } from '../db/repository';
import { findRequestTask } from '../db/request-store';
import { uploadFile } from '../services/file-service';
import type { AttachmentStorage } from '../storage/types';
import { createCollaboration, updateCollaboration } from '../services/collaboration-service';

vi.mock(
  '../services/activity-service',
  /** 替换事务入口，保留真实协作服务回调和领域逻辑。
   * @returns 事务调用替身
   */ function service() {
    return { mutateActivity: vi.fn() };
  },
);
vi.mock(
  '../db/repository',
  /** 只替换文件读取和通知出站，禁止连接实际数据库。
   * @returns 两个仓储替身
   */ function repository() {
    return { activityFiles: vi.fn(), enqueue: vi.fn(), query: vi.fn() };
  },
);
vi.mock(
  '../db/request-store',
  /** 保留真实存储适配器，仅替换个人待办定位。
   * @param importOriginal 加载原始仓储模块
   * @returns 任务定位替身
   */ async function store(importOriginal) {
    const actual = await importOriginal<typeof import('../db/request-store')>();
    return { ...actual, findRequestTask: vi.fn() };
  },
);

/** 构造普通申请及真实协作服务的事务上下文，所有数据库行为使用替身。
 * @returns 已派发前的实例、配置与操作身份
 */
function fixture() {
  vi.clearAllMocks();
  const config = seedConfig();
  const plan = instantiateWorkflow(config, { budget: '0' }, 'u-lin');
  const activity: Activity = {
    id: 'general-collab',
    code: 'OA-TEST',
    name: '通用申请',
    lifecycle: { version: 1, businessType: 'general', afterApproval: 'complete' },
    applicant: 'u-lin',
    department: 'd1',
    status: 'approving',
    version: 1,
    revision: 1,
    structureRevision: 1,
    configVersion: 1,
    schema: config.form,
    payload: {},
    snapshots: [],
    nodes: plan.nodes,
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
  advanceWorkflow(activity);
  const parent = activity.tasks[0]!;
  vi.mocked(findRequestTask).mockResolvedValue([{ activity_id: activity.id }]);
  vi.mocked(activityFiles).mockResolvedValue([]);
  vi.mocked(enqueue).mockResolvedValue(undefined);
  vi.mocked(query).mockResolvedValue([{ total: 0 }]);
  const execute = vi.fn().mockResolvedValue([{}, []]);
  /** 在隔离上下文执行真实事务回调，成功时递增主单版本。
   * @param args 原事务函数的全部参数
   * @returns 更新标识与版本
   */
  async function mutate(...args: Parameters<typeof mutateActivity>) {
    const changed = await args[5]({ config, activity, connection: { execute } as unknown as PoolConnection });
    changed.version++;
    return { id: changed.id, version: changed.version };
  }
  vi.mocked(mutateActivity).mockImplementation(mutate);
  return { config, activity, parent, pool: {} as Pool, execute };
}

/** 经真实派发服务建立一个必交附件的任务。
 * @param data 模拟上下文
 * @returns 新建协作节点
 */
async function dispatch(data: ReturnType<typeof fixture>) {
  await createCollaboration(
    data.pool,
    'u-chen',
    data.parent.id,
    collaborationDispatchSchema.parse({
      idempotencyKey: 'create-key',
      expectedTaskVersion: data.parent.version,
      mode: 'parallel',
      tasks: [{ label: '补充方案', assignee: 'u-su', instructions: '上传方案', attachmentRequired: true }],
    }),
  );
  return data.activity.nodes.find(
    /** 获取真实服务生成的协作节点。
     * @param node 实例节点
     * @returns 是否协作
     */ function child(node) {
      return !!node.collaboration;
    },
  )!;
}

/** 正式交付核验文件归属并提交附件分组，使用普通申请附件适配器并通知验收人。 */
async function submitCase(): Promise<void> {
  const data = fixture();
  const node = await dispatch(data);
  const file: FileRecord = {
    id: 'proof',
    activityId: data.activity.id,
    nodeId: node.id,
    stage: 'node',
    contextId: 'result-context',
    actionKey: 'collaboration-submit',
    uploaderId: 'u-su',
    name: '方案.pdf',
    size: 20,
    mime: 'application/pdf',
    createdAt: '',
  };
  vi.mocked(activityFiles).mockResolvedValue([file]);
  await updateCollaboration(
    data.pool,
    'u-su',
    data.activity.id,
    node.id,
    collaborationActionSchema.parse({
      idempotencyKey: 'submit-key',
      generation: 1,
      action: 'submit',
      summary: '已完成',
      attachmentContextId: file.contextId,
    }),
  );
  expect(node.collaboration!.state).toBe('submitted');
  expect(attachmentContextCommitted(data.activity, file.contextId!)).toBe(true);
  expect(activityFiles).toHaveBeenCalledWith(expect.anything(), data.activity.id, 'general');
  expect(enqueue).toHaveBeenCalledWith(
    expect.anything(),
    data.activity,
    'u-chen',
    '待验收：补充方案',
    expect.any(String),
  );
  expect(mutateActivity).toHaveBeenLastCalledWith(
    data.pool,
    'u-su',
    'submit-key',
    expect.stringContaining('collaboration-action:'),
    data.activity.id,
    expect.any(Function),
  );
}
test('真实服务提交正确附件分组、通知验收人并复用幂等事务入口', submitCase);

/** 保存草稿保留未提交附件隔离，不触发验收通知。 */
async function saveCase(): Promise<void> {
  const data = fixture();
  const node = await dispatch(data);
  await updateCollaboration(
    data.pool,
    'u-su',
    data.activity.id,
    node.id,
    collaborationActionSchema.parse({
      idempotencyKey: 'save-key',
      generation: 1,
      action: 'save',
      summary: '准备中',
      attachmentContextId: 'draft-context',
    }),
  );
  expect(node.collaboration!.draft!.summary).toBe('准备中');
  expect(attachmentContextCommitted(data.activity, 'draft-context')).toBe(false);
  expect(enqueue).not.toHaveBeenCalled();
}
test('保存进展不提交附件分组且不发送待验收通知', saveCase);

/** 伪造其他上传人的附件分组时，在成果状态变化前拒绝。 */
async function invalidAttachmentCase(): Promise<void> {
  const data = fixture();
  const node = await dispatch(data);
  vi.mocked(activityFiles).mockResolvedValue([
    {
      id: 'foreign',
      activityId: data.activity.id,
      nodeId: node.id,
      stage: 'node',
      contextId: 'foreign-context',
      actionKey: 'collaboration-submit',
      uploaderId: 'u-wang',
      name: '其他人.pdf',
      mime: 'application/pdf',
      size: 10,
      createdAt: '',
    },
  ]);
  await expect(
    updateCollaboration(
      data.pool,
      'u-su',
      data.activity.id,
      node.id,
      collaborationActionSchema.parse({
        idempotencyKey: 'bad-key',
        generation: 1,
        action: 'submit',
        summary: '伪造',
        attachmentContextId: 'foreign-context',
      }),
    ),
  ).rejects.toThrow('人员或业务动作不匹配');
  expect(node.collaboration!.state).toBe('working');
  expect(node.collaboration!.submissions).toHaveLength(0);
  expect(enqueue).not.toHaveBeenCalled();
}
test('服务拒绝冒用其他人附件且保留原成果状态', invalidAttachmentCase);

/** 提供对象存储替身，权限被拒绝时应完全不写对象。
 * @returns 可观察写入次数的存储协议
 */
function storageFixture(): AttachmentStorage {
  return { put: vi.fn().mockResolvedValue('collaboration/object'), remove: vi.fn(), read: vi.fn() };
}

/** 通过真实上传函数登记协作附件，验证动作标识、通用申请表和元数据归属。 */
async function collaborationUploadCase(): Promise<void> {
  const data = fixture();
  const node = await dispatch(data);
  const storage = storageFixture();
  const file = await uploadFile(
    data.pool,
    '/unused',
    'u-su',
    data.activity.id,
    'node',
    '成果.pdf',
    Buffer.from('%PDF-test'),
    'upload-collaboration',
    { nodeId: node.id, contextId: 'result-context', actionKey: 'collaboration-submit' },
    storage,
  );
  expect(file.nodeId).toBe(node.id);
  expect(file.actionKey).toBe('collaboration-submit');
  expect(storage.put).toHaveBeenCalledTimes(1);
  expect(data.execute.mock.calls[0]![0]).toContain('INSERT INTO request_files');
  expect(data.execute.mock.calls[0]![1][11]).toBe('collaboration-submit');
  vi.mocked(activityFiles).mockResolvedValue([{ ...file, uploaderId: 'u-su' }]);
  await updateCollaboration(
    data.pool,
    'u-su',
    data.activity.id,
    node.id,
    collaborationActionSchema.parse({
      idempotencyKey: 'submit-after-upload',
      generation: node.generation,
      expectedCollaborationVersion: node.collaboration?.version || 1,
      action: 'submit',
      summary: '成果已上传',
      attachmentContextId: 'result-context',
    }),
  );
  expect(node.collaboration!.state).toBe('submitted');
  await expect(
    uploadFile(
      data.pool,
      '/unused',
      'u-su',
      data.activity.id,
      'node',
      '追加.pdf',
      Buffer.from('%PDF-test'),
      'late-upload',
      { nodeId: node.id, contextId: 'late-context', actionKey: 'collaboration-submit' },
      storage,
    ),
  ).rejects.toThrow('不允许上传');
  expect(storage.put).toHaveBeenCalledTimes(1);
}
test('协作办理人可通过真实上传入口提交本轮成果附件', collaborationUploadCase);

/** 协作与普通审批不能交叉冒用动作标识，其他办理人不能上传到此协作。 */
async function wrongUploadActionCase(): Promise<void> {
  const data = fixture();
  const node = await dispatch(data);
  const storage = storageFixture();
  await expect(
    uploadFile(
      data.pool,
      '/unused',
      'u-su',
      data.activity.id,
      'node',
      '成果.pdf',
      Buffer.from('%PDF-test'),
      'wrong-action',
      { nodeId: node.id, contextId: 'x', actionKey: 'decision' },
      storage,
    ),
  ).rejects.toThrow('不允许上传');
  await expect(
    uploadFile(
      data.pool,
      '/unused',
      'u-wang',
      data.activity.id,
      'node',
      '成果.pdf',
      Buffer.from('%PDF-test'),
      'wrong-user',
      { nodeId: node.id, contextId: 'x', actionKey: 'collaboration-submit' },
      storage,
    ),
  ).rejects.toThrow('不允许上传');
  await expect(
    uploadFile(
      data.pool,
      '/unused',
      'u-chen',
      data.activity.id,
      'node',
      '成果.pdf',
      Buffer.from('%PDF-test'),
      'wrong-parent',
      { nodeId: data.parent.nodeId, contextId: 'x', actionKey: 'collaboration-submit' },
      storage,
    ),
  ).rejects.toThrow('不允许上传');
  expect(storage.put).not.toHaveBeenCalled();
}
test('协作上传动作与普通审批隔离，错误身份在对象写入前拒绝', wrongUploadActionCase);

/** 父审批失效时，即使旧子任务尚未被同步关闭也必须拒绝上传。 */
async function staleParentUploadCase(): Promise<void> {
  const data = fixture();
  const node = await dispatch(data);
  data.parent.status = 'cancelled';
  const storage = storageFixture();
  await expect(
    uploadFile(
      data.pool,
      '/unused',
      'u-su',
      data.activity.id,
      'node',
      '成果.pdf',
      Buffer.from('%PDF-test'),
      'stale-parent',
      { nodeId: node.id, contextId: 'x', actionKey: 'collaboration-submit' },
      storage,
    ),
  ).rejects.toThrow('不允许上传');
  expect(storage.put).not.toHaveBeenCalled();
}
test('协作上传实时检查父审批有效性，过期子任务不能继续上传', staleParentUploadCase);
