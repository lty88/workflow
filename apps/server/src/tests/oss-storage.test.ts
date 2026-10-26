import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { readEnv } from '../env';
import { createAttachmentStorage } from '../storage/attachments';
const mocked = vi.hoisted(
  /** 创建隔离的SDK方法与参数捕获器。
   * @returns SDK方法替身
   */
  () => ({
    options: vi.fn(),
    put: vi.fn().mockResolvedValue({}),
    getStream: vi.fn(),
    head: vi.fn(),
    remove: vi.fn().mockResolvedValue({}),
  }),
);
vi.mock(
  'ali-oss',
  /** 使用SDK替身避免局部校验访问真实OSS。
   * @returns 可实例化的SDK替身模块
   */
  () => ({
    default: class FakeOSS {
      /** 记录SDK初始化参数，不连接阿里云。
       * @param options SDK配置
       */
      constructor(options: unknown) {
        mocked.options(options);
      }
      put = mocked.put;
      getStream = mocked.getStream;
      head = mocked.head;
      delete = mocked.remove;
    },
  }),
);
/** 构造仅用于隔离校验的OSS配置，不使用真实凭据。
 * @returns 已校验环境
 */
function environment() {
  return readEnv({
    MYSQL_PASSWORD: 'test-only',
    STORAGE_DRIVER: 'oss',
    OSS_ACCESS_KEY_ID: 'test-id',
    OSS_ACCESS_KEY_SECRET: 'test-secret',
  });
}
/** 验证SDK使用北京、自定义域名、V4签名和私有ACL，下载不返回公开直链。 */
async function ossCase(): Promise<void> {
  const storage = createAttachmentStorage(environment());
  const id = 'a'.repeat(64);
  const key = await storage.put(id, Buffer.from('%PDF-test'), 'application/pdf');
  expect(key).toBe(`oss:workflow/${id}`);
  expect(mocked.options).toHaveBeenLastCalledWith(
    expect.objectContaining({
      region: 'oss-cn-beijing',
      bucket: 'qyzh2025test',
      endpoint: 'https://oss-test.qyzhjy.com',
      cname: true,
      authorizationV4: true,
    }),
  );
  expect(mocked.put).toHaveBeenLastCalledWith(
    `workflow/${id}`,
    expect.any(Buffer),
    expect.objectContaining({
      headers: expect.objectContaining({ 'x-oss-object-acl': 'private', 'x-oss-forbid-overwrite': 'true' }),
    }),
  );
  const stream = new PassThrough();
  mocked.getStream.mockResolvedValueOnce({ stream });
  expect(await storage.read(key)).toBe(stream);
  await storage.remove(key);
  expect(mocked.remove).toHaveBeenLastCalledWith(`workflow/${id}`);
}
test('OSS私有上传、授权读取与失败清理通过统一存储适配器', ossCase);
/** 验证缺少密钥时启动配置报错，OSS故障转成可理解且不泄露密钥的业务错误。 */
async function configurationCase(): Promise<void> {
  expect(() => readEnv({ MYSQL_PASSWORD: 'test', STORAGE_DRIVER: 'oss' })).toThrow('OSS_ACCESS_KEY_ID');
  expect(() => readEnv({ MYSQL_PASSWORD: 'test', OSS_DOMAIN: 'https://example.com/private' })).toThrow(
    'OSS_DOMAIN',
  );
  mocked.put.mockRejectedValueOnce(new Error('test-secret must never reach the response'));
  await expect(
    createAttachmentStorage(environment()).put('b'.repeat(64), Buffer.from('%PDF'), 'application/pdf'),
  ).rejects.toMatchObject({ code: 'OSS_UPLOAD_FAILED', message: expect.not.stringContaining('test-secret') });
  await expect(createAttachmentStorage(environment()).read('oss:../secret')).rejects.toMatchObject({
    code: 'OSS_READ_FAILED',
  });
}
test('缺失配置、任意路径和SDK故障得到安全的中文错误', configurationCase);

/** 验证PUT成功但响应丢失时，重试通过对象摘要确认成功，不覆盖其他内容。 */
async function uncertainUploadCase(): Promise<void> {
  const buffer = Buffer.from('%PDF-same-content');
  mocked.put.mockRejectedValueOnce(new Error('response lost'));
  mocked.head.mockResolvedValueOnce({ meta: { sha256: createHash('sha256').update(buffer).digest('hex') } });
  await expect(
    createAttachmentStorage(environment()).put('c'.repeat(64), buffer, 'application/pdf'),
  ).resolves.toBe(`oss:workflow/${'c'.repeat(64)}`);
  mocked.put.mockRejectedValueOnce(new Error('already exists'));
  mocked.head.mockResolvedValueOnce({ meta: { sha256: 'different-content' } });
  await expect(
    createAttachmentStorage(environment()).put('d'.repeat(64), buffer, 'application/pdf'),
  ).rejects.toMatchObject({ code: 'OSS_UPLOAD_FAILED' });
}
test('OSS上传响应丢失可按内容摘要安全重试，其他内容不被覆盖', uncertainUploadCase);
