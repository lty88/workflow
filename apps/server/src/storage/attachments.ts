import OSS from 'ali-oss';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Environment } from '../env';
import type { AttachmentStorage } from './types';
import { HttpError } from '../errors';

/**
 * 创建本地存储适配器，保持历史附件键及文件模式兼容。
 * @param root 受控附件目录
 * @returns 本地保存、删除和读取能力
 */
export function createLocalAttachmentStorage(root: string): AttachmentStorage {
  /** 保存新文件，禁止覆盖相同存储键。
   * @param id 服务器生成的文件摘要标识
   * @param buffer 已验证的文件内容
   * @param _mime 已验证的文件类型，本地写入无需额外元数据
   * @returns 本地存储键
   */
  async function put(id: string, buffer: Buffer, _mime: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('附件存储标识无效');
    await mkdir(root, { recursive: true });
    await writeFile(resolve(root, id), buffer, { flag: 'wx', mode: 0o600 });
    return id;
  }
  /** 清理失败事务创建的本地附件。
   * @param key 已验证的本地存储键
   */
  async function remove(key: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('附件存储标识无效');
    await unlink(resolve(root, key));
  }
  /** 返回已授权的历史或当前本地附件流。
   * @param key 已验证的本地存储键
   * @returns 附件读取流
   */
  async function read(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('附件存储标识无效');
    return createReadStream(resolve(root, key));
  }
  return { put, remove, read };
}

/**
 * 根据服务端配置创建OSS存储，浏览器经业务接口上传；读取始终先经过活动授权，兼容本地旧文件。
 * @param env 已校验的服务端配置，密钥不会下发前端
 * @returns 统一的附件保存、读取和失败清理能力
 */
export function createAttachmentStorage(env: Environment): AttachmentStorage {
  const local = createLocalAttachmentStorage(resolve(env.UPLOAD_DIR));
  let client: OSS | undefined;
  /** 延迟创建阿里云官方SDK，使用V4签名和已绑定的自定义域名。
   * @returns OSS客户端
   */
  function oss(): OSS {
    if (!env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET)
      throw new HttpError(503, 'OSS_NOT_CONFIGURED', 'OSS凭据尚未配置，请联系管理员');
    client ||= new OSS({
      region: env.OSS_REGION,
      bucket: env.OSS_BUCKET,
      endpoint: env.OSS_DOMAIN,
      cname: true,
      authorizationV4: true,
      secure: true,
      accessKeyId: env.OSS_ACCESS_KEY_ID,
      accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
      timeout: 60000,
    });
    return client;
  }
  /** 解析保存在数据库中的OSS路径，不接受客户端地址或任意路径。
   * @param key 含存储提供方前缀的存储键
   * @returns OSS对象键
   */
  function objectKey(key: string): string {
    if (!/^oss:[a-zA-Z0-9_-]{1,60}\/[a-f0-9]{64}$/.test(key))
      throw new HttpError(404, 'NOT_FOUND', '附件不存在');
    return key.slice(4);
  }
  /** 将已验证附件保存至配置的存储后端，OSS对象显式设为私有。
   * @param id 服务器生成的文件标识
   * @param buffer 已验证内容
   * @param mime 已验证MIME
   * @returns 带提供方的持久存储键
   */
  async function put(id: string, buffer: Buffer, mime: string): Promise<string> {
    if (env.STORAGE_DRIVER !== 'oss') return local.put(id, buffer, mime);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('附件存储标识无效');
    const key = `${env.OSS_PREFIX}/${id}`;
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    try {
      await oss().put(key, buffer, {
        mime,
        headers: {
          'x-oss-meta-sha256': sha256,
          'x-oss-object-acl': 'private',
          'x-oss-forbid-overwrite': 'true',
        },
      });
    } catch {
      try {
        const stored = await oss().head(key);
        if (stored.meta?.sha256 === sha256) return `oss:${key}`;
      } catch {
        /* 上传未成功或对象不匹配时返回统一错误，不泄露SDK凭据。 */
      }
      throw new HttpError(
        503,
        'OSS_UPLOAD_FAILED',
        'OSS附件上传失败，请检查服务端凭据、桶权限及域名配置后重试',
      );
    }
    return `oss:${key}`;
  }
  /** 清理失败事务产生的文件，按持久存储键选择后端。
   * @param key 实际保存的文件键
   */
  async function remove(key: string): Promise<void> {
    if (!key.startsWith('oss:')) return local.remove(key);
    await oss().delete(objectKey(key));
  }
  /** 读取私有OSS文件或本地旧文件，代理流不泄露签名和凭据。
   * @param key 授权服务返回的持久存储键
   * @returns 可发送给当前登录用户的附件流
   */
  async function read(key: string) {
    if (!key.startsWith('oss:')) return local.read(key);
    try {
      return (await oss().getStream(objectKey(key))).stream;
    } catch {
      throw new HttpError(503, 'OSS_READ_FAILED', 'OSS附件读取失败，请稍后重试或联系管理员');
    }
  }
  return { put, remove, read };
}
