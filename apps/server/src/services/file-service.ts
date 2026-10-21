import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { Pool } from 'mysql2/promise';
import { activityActions, hasPermission } from '@workflow/domain';
import type { FileRecord } from '@workflow/domain';
import { query } from '../db/repository';
import { ensure } from '../errors';
import { digest } from './auth';
import { mutateActivity } from './activity-service';

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
 * 在权限与阶段校验后保存附件，数据库失败时清理本次创建的磁盘文件。
 * @param pool 连接池
 * @param root 存储目录
 * @param actor 上传人
 * @param activityId 活动标识
 * @param stage 文件阶段
 * @param originalName 原始文件名
 * @param buffer 内容
 * @param key 幂等键
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
  const storagePath = resolve(root, id);
  let created = false;
  try {
    await mutateActivity(
      pool,
      actor,
      key,
      `upload:${activityId}:${stage}:${name}:${digest(buffer.toString('base64'))}`,
      activityId,
      /**
       * 校验上传归属和数量并原子登记元数据。
       * @param context 事务上下文
       * @returns 更新活动
       */
      async function store(context) {
        const activity = context.activity!;
        let allowed = false;
        if (stage === 'application')
          allowed = activityActions(context.config, actor, activity).includes('edit');
        if (stage === 'execution')
          allowed =
            activity.executor === actor &&
            activity.status === 'executing' &&
            hasPermission(context.config, actor, 'execution:report');
        if (stage === 'archive')
          allowed = activityActions(context.config, actor, activity).includes('archive-submit');
        ensure(allowed, 403, 'FORBIDDEN', '当前身份或阶段不允许上传该类附件');
        const existing = await query<{ total: number }>(
          context.connection,
          'SELECT COUNT(*) AS total FROM files WHERE activity_id=? AND stage=?',
          [activityId, stage],
        );
        ensure(Number(existing[0]?.total || 0) < 10, 422, 'FILE_LIMIT', '该阶段最多上传10个文件');
        await mkdir(root, { recursive: true });
        await writeFile(storagePath, buffer, { flag: 'wx', mode: 0o600 });
        created = true;
        await context.connection.execute(
          'INSERT INTO files(id,activity_id,uploader_id,name,storage_key,mime,size,stage) VALUES (?,?,?,?,?,?,?,?)',
          [id, activityId, actor, name, id, mime, buffer.length, stage],
        );
        activity.audit.push({
          id: crypto.randomUUID(),
          actor,
          actorName: actor,
          action: '上传附件',
          note: `${stage}：${name}`,
          createdAt: new Date().toISOString(),
        });
        return activity;
      },
    );
  } catch (error) {
    if (created) await unlink(storagePath).catch(ignoreCleanupError);
    throw error;
  }
  return { id, activityId, name, mime, size: buffer.length, stage, createdAt: new Date().toISOString() };
}

/**
 * 忽略失败事务附件的重复清理错误，无返回值。
 */
function ignoreCleanupError(): void {}
