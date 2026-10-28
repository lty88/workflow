import { requestTables, findRequestFile } from '../db/request-store';
import { lifecycleOf } from '@workflow/domain';
import { basename } from 'node:path';
import { createLocalAttachmentStorage } from '../storage/attachments';
import type { AttachmentStorage } from '../storage/types';
import type { Pool } from 'mysql2/promise';
import {
  activityActions,
  attachmentContextCommitted,
  attachmentIds,
  attachmentOptions,
  attachmentFileErrors,
  canAccessField,
  visibleFields,
  hasPermission,
  canHandleTask,
  canReadNodeContent,
  canReadFile,
  canDownloadFile,
  canUpdateFileAccess,
  fileAccessWriteSchema,
  findById,
  validateDataAccessRule,
} from '@workflow/domain';
import type { FileRecord, FileAccessInput } from '@workflow/domain';
import { query, loadConfig, loadActivity, activityFiles, transaction } from '../db/repository';
import { recordDataAccess } from './data-access-service';
import { ensure } from '../errors';
import { digest } from './auth';
import { mutateActivity, type MutationContext } from './activity-service';

/**
 * 根据扩展名与基础文件签名限制附件类型，下载统一使用附件模式。
 * @param name 文件名
 * @param buffer 文件内容
 * @returns 服务端确定的MIME
 */
function acceptedMime(name: string, buffer: Buffer): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf') && buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (/\.jpe?g$/.test(lower) && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return 'image/jpeg';
  if (lower.endsWith('.png') && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (
    /\.(docx|xlsx)$/.test(lower) &&
    buffer[0] === 80 &&
    buffer[1] === 75 &&
    buffer[2] === 3 &&
    buffer[3] === 4
  )
    return lower.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  throw new Error('只支持签名与扩展名一致的PDF、JPG、PNG、DOCX、XLSX文件');
}

/**
 * 在权限、阶段与表单分组校验后保存附件，数据库失败时清理本次创建的存储对象。
 * @param pool 连接池
 * @param root 存储目录
 * @param actor 上传人
 * @param activityId 活动标识
 * @param stage 文件阶段
 * @param originalName 原始文件名
 * @param buffer 内容
 * @param key 幂等键
 * @param access 附件查看下载规则与所属节点或表单字段，空规则继承节点，显式规则单独授权
 * @param storage 本地或OSS存储适配器
 * @returns 文件元数据
 */
export async function uploadFile(
  pool: Pool,
  root: string,
  actor: string,
  activityId: string,
  stage: FileRecord['stage'],
  originalName: string,
  buffer: Buffer,
  key: string,
  access: FileAccessInput = {},
  storage: AttachmentStorage = createLocalAttachmentStorage(root),
): Promise<FileRecord> {
  ensure(buffer.length > 0 && buffer.length <= 20 * 1024 * 1024, 422, 'FILE_SIZE', '文件需大于0且不超过20MB');
  const name = basename(originalName)
    .replace(/[\x00-\x1f]/g, '')
    .slice(0, 200);
  let mime: string;
  try {
    mime = acceptedMime(name, buffer);
  } catch {
    throw Object.assign(new Error('文件格式或签名不受支持'), { statusCode: 422 });
  }
  const id = digest(`${actor}:${activityId}:${key}`);
  let storageKey = id;
  let created = false;
  let fileTable = 'files';
  try {
    await mutateActivity(
      pool,
      actor,
      key,
      `upload:${activityId}:${stage}:${name}:${digest(buffer.toString('base64'))}:${JSON.stringify(access)}`,
      activityId,
      /**
       * 校验上传归属和数量并原子登记元数据。
       * @param context 事务上下文
       * @returns 更新活动
       */
      async function store(context) {
        const activity = context.activity!;
        fileTable = requestTables(activity).files;
        const node = access.nodeId ? findById(activity.nodes, access.nodeId) : undefined;
        ensure(
          !access.contextId || !attachmentContextCommitted(activity, access.contextId),
          409,
          'ATTACHMENTS_COMMITTED',
          '本次记录已提交，附件不可继续追加；请新增一条记录',
        );
        ensure(
          !access.fieldKey || (!access.contextId && !access.actionKey),
          422,
          'FILE_CONTEXT',
          '动态字段附件不能混用业务表单分组',
        );
        ensure(
          stage !== 'operation' || (!!access.contextId && !!access.actionKey && !access.nodeId),
          422,
          'FILE_CONTEXT',
          '业务表单附件必须指定本次分组和动作',
        );
        ensure(!access.contextId || !!access.actionKey, 422, 'FILE_CONTEXT', '附件分组缺少业务动作');
        let field;
        if (access.fieldKey) {
          ensure(stage === 'application' && !access.nodeId, 422, 'FILE_FIELD', '表单字段附件仅允许申请阶段');
          field = visibleFields(activity.schema, activity.payload).find(
            /** 仅接受本活动当前实际可见的附件控件。
             * @param candidate 活动冻结表单字段
             * @returns 是否匹配目标字段
             */ function matches(candidate) {
              return candidate.key === access.fieldKey && candidate.type === 'attachment';
            },
          );
          ensure(
            field && canAccessField(context.config, actor, activity, field, true),
            403,
            'FILE_FIELD_FORBIDDEN',
            '附件字段不存在、不可见或无填写权限',
          );
          const fileErrors = attachmentFileErrors(field, { name, size: buffer.length });
          ensure(!fileErrors.length, 422, 'FILE_FIELD', fileErrors.join('；'));
          const ids = attachmentIds(activity.payload[field.key]);
          ensure(ids !== null, 422, 'FILE_FIELD', '附件字段数据无效，请重新读取');
          ensure(
            ids.length < attachmentOptions(field).maxCount,
            422,
            'FILE_LIMIT',
            `${field.label}最多上传${attachmentOptions(field).maxCount}个文件`,
          );
        }
        ensure(
          stage === 'node' ? !!node : !access.nodeId,
          422,
          'FILE_NODE',
          '节点附件必须选择本活动节点，其他阶段不能指定节点',
        );
        const errors = [
          ...validateDataAccessRule(context.config, access.access, '附件查看'),
          ...validateDataAccessRule(context.config, access.downloadAccess, '附件下载'),
        ];
        ensure(!errors.length, 422, 'FILE_ACCESS', errors.join('；'));
        ensure(
          node || (!access.access?.nodeAssignees && !access.downloadAccess?.nodeAssignees),
          422,
          'FILE_ACCESS',
          '阶段附件不能使用节点受理人授权',
        );
        let allowed = false;
        if (stage === 'node' && node && canReadNodeContent(context.config, actor, activity, node))
          for (const task of activity.tasks)
            if (task.nodeId === node.id && canHandleTask(context.config, actor, activity, task))
              allowed = true;
        if (stage === 'application')
          allowed = activityActions(context.config, actor, activity).includes('edit');
        if (stage === 'execution')
          allowed =
            activity.executor === actor &&
            activity.status === 'executing' &&
            hasPermission(context.config, actor, 'execution:report');
        if (stage === 'archive')
          allowed = activityActions(context.config, actor, activity).includes('archive-submit');
        if (stage === 'operation')
          allowed =
            !!access.actionKey &&
            [
              'delete',
              'withdraw',
              'assign',
              'start',
              'archive-approve',
              'archive-return',
              'cancel-request',
              'cancel-approve',
              'cancel-reject',
              'cancel-withdraw',
              'adjust',
            ].includes(access.actionKey) &&
            activityActions(context.config, actor, activity).includes(access.actionKey);
        if (access.contextId) {
          if (stage === 'execution')
            allowed = allowed && ['report', 'execution-complete'].includes(access.actionKey || '');
          else if (stage === 'node') allowed = allowed && access.actionKey === 'decision';
          else if (stage === 'archive') allowed = allowed && access.actionKey === 'archive-submit';
          else if (stage !== 'operation') allowed = false;
        }
        ensure(allowed, 403, 'FORBIDDEN', '当前身份或阶段不允许上传该类附件');
        if (!field) {
          const existing = await query<{ total: number }>(
            context.connection,
            `SELECT COUNT(*) AS total FROM ${fileTable} WHERE activity_id=? AND stage=? AND node_id <=> ? AND context_id <=> ? AND field_key IS NULL`,
            [activityId, stage, access.nodeId || null, access.contextId || null],
          );
          ensure(Number(existing[0]?.total || 0) < 10, 422, 'FILE_LIMIT', '每个表单或记录最多上传10个文件');
        }
        storageKey = await storage.put(id, buffer, mime);
        created = true;
        await context.connection.execute(
          `INSERT INTO ${fileTable}(id,activity_id,uploader_id,name,storage_key,mime,size,stage,node_id,field_key,context_id,action_key,access_rule,download_rule) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            activityId,
            actor,
            name,
            storageKey,
            mime,
            buffer.length,
            stage,
            access.nodeId || null,
            access.fieldKey || null,
            access.contextId || null,
            access.actionKey || null,
            access.access ? JSON.stringify(access.access) : null,
            access.downloadAccess ? JSON.stringify(access.downloadAccess) : null,
          ],
        );
        if (field) {
          const ids = attachmentIds(activity.payload[field.key])!;
          activity.payload[field.key] = JSON.stringify([...ids, id]);
        }
        activity.audit.push({
          id: crypto.randomUUID(),
          actor,
          actorName: actor,
          action: '上传附件',
          nodeId: access.nodeId,
          fileId: id,
          note: `${field?.label || stage}：${name}`,
          createdAt: new Date().toISOString(),
        });
        return activity;
      },
    );
  } catch (error) {
    if (created) {
      // 提交结果不明时保留对象，避免删除已经成功登记的附件。
      try {
        const registered = await query(pool, `SELECT id FROM ${fileTable} WHERE id=?`, [id]);
        if (!registered.length) await storage.remove(storageKey).catch(ignoreCleanupError);
      } catch {
        /* 数据库不可用时保留对象，等待后续核查。 */
      }
    }
    throw error;
  }
  return {
    id,
    activityId,
    name,
    mime,
    size: buffer.length,
    stage,
    nodeId: access.nodeId,
    fieldKey: access.fieldKey,
    contextId: access.contextId,
    actionKey: access.actionKey,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 忽略失败事务附件的重复清理错误，无返回值。
 */
function ignoreCleanupError(): void {}

/**
 * 在同一事务快照中校验文件读取与独立下载授权并记录访问，防止绕过详情直接获取文件。
 * @param pool 数据库连接池
 * @param actor 当前成员
 * @param id 文件标识
 * @param preview 是否为受支持文件的在线预览
 * @returns 已授权的文件存储标识、名称和类型
 */
export async function authorizeFileRead(
  pool: Pool,
  actor: string,
  id: string,
  preview = false,
): Promise<{ storageKey: string; name: string; mime: string }> {
  /**
   * 读取真实文件归属与实时权限，授权失败时不返回任何元数据。
   * @param connection 事务连接
   * @returns 可以发送的文件信息
   */
  async function authorize(connection: import('mysql2/promise').PoolConnection) {
    const config = (await loadConfig(connection, 'share')).published;
    const rows = await findRequestFile(connection, id);
    ensure(
      rows[0] && /^(?:[a-f0-9]{64}|oss:[a-zA-Z0-9_-]{1,60}\/[a-f0-9]{64})$/.test(rows[0].storage_key),
      404,
      'NOT_FOUND',
      '文件不存在或无访问权限',
    );
    const activity = await loadActivity(connection, rows[0].activity_id);
    ensure(activity, 404, 'NOT_FOUND', '申请不存在或已删除');
    const files = await activityFiles(connection, rows[0].activity_id, lifecycleOf(activity).businessType);
    const file = findById(files, id);
    ensure(
      activity && file && canReadFile(config, actor, activity, file),
      404,
      'NOT_FOUND',
      '文件不存在或无访问权限',
    );
    if (preview)
      ensure(
        ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mime),
        422,
        'PREVIEW_UNSUPPORTED',
        '此格式暂不支持在线预览，请按下载授权获取',
      );
    else
      ensure(
        canDownloadFile(config, actor, activity, file),
        403,
        'FILE_DOWNLOAD_FORBIDDEN',
        '无该附件下载权限',
      );
    await recordDataAccess(
      connection,
      config,
      actor,
      activity.id,
      preview ? '预览授权附件' : '下载授权附件',
      id,
    );
    return { storageKey: rows[0].storage_key, name: file.name, mime: file.mime };
  }
  return transaction(pool, authorize);
}

/**
 * 修改已有附件授权，节点上传人仍有节点阅读资格时可分享自己的附件，其余上传人仅可收紧。
 * @param pool 数据库连接池
 * @param actor 当前成员
 * @param id 文件标识
 * @param command 授权规则、主单版本和幂等键
 * @returns 主单新版本
 */
export async function updateFileAccess(
  pool: Pool,
  actor: string,
  id: string,
  command: import('zod').z.infer<typeof fileAccessWriteSchema>,
): Promise<{ id: string; version: number }> {
  const rows = await findRequestFile(pool, id);
  ensure(rows[0], 404, 'NOT_FOUND', '附件不存在或无访问权限');
  /**
   * 锁定活动后检查旧权限与新规则，再原子更新附件和权限变更记录。
   * @param context 活动变更上下文
   * @returns 更新后的活动
   */
  async function update(context: MutationContext) {
    const activity = context.activity!;
    ensure(
      activity.version === command.expectedVersion,
      409,
      'VERSION_CONFLICT',
      '活动资料已更新，请刷新后重试',
    );
    const file = findById(await activityFiles(context.connection, activity.id, lifecycleOf(activity).businessType), id);
    ensure(
      file && canReadFile(context.config, actor, activity, file),
      404,
      'NOT_FOUND',
      '附件不存在或无访问权限',
    );
    const admin = hasPermission(context.config, actor, 'config:manage');
    ensure(
      admin || file.uploaderId === actor,
      403,
      'FILE_ACCESS_FORBIDDEN',
      '仅上传人或有活动访问权的配置管理员可管理附件权限',
    );
    const errors = [
      ...validateDataAccessRule(context.config, command.access, '附件查看'),
      ...validateDataAccessRule(context.config, command.downloadAccess, '附件下载'),
    ];
    ensure(!errors.length, 422, 'FILE_ACCESS', errors.join('；'));
    ensure(
      file.nodeId || (!command.access?.nodeAssignees && !command.downloadAccess?.nodeAssignees),
      422,
      'FILE_ACCESS',
      '阶段附件不能使用节点受理人授权',
    );
    ensure(
      canUpdateFileAccess(context.config, actor, activity, file, command),
      403,
      'FILE_ACCESS_WIDENING',
      '分享节点附件需上传人仍有该节点内部阅读资格；其他上传人只能收紧授权，或由授权管理员调整',
    );
    await context.connection.execute(
      `UPDATE ${requestTables(activity).files} SET access_rule=?,download_rule=? WHERE id=? AND activity_id=?`,
      [
        command.access ? JSON.stringify(command.access) : null,
        command.downloadAccess ? JSON.stringify(command.downloadAccess) : null,
        id,
        activity.id,
      ],
    );
    activity.audit.push({
      id: crypto.randomUUID(),
      actor,
      actorName: findById(context.config.users, actor)?.name || actor,
      action: '调整附件数据权限',
      note: '更新附件查看与下载授权',
      fileId: id,
      nodeId: file.nodeId,
      createdAt: new Date().toISOString(),
    });
    return activity;
  }
  return mutateActivity(
    pool,
    actor,
    command.idempotencyKey,
    `file-access:${id}:${JSON.stringify(command)}`,
    rows[0].activity_id,
    update,
  );
}
