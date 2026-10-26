import type { FileAccessInput, FileRecord } from '@workflow/domain'
import { request } from './http'

/**
 * 经受会话保护的接口上传OSS附件，服务端校验内容与授权后写入私有桶，兼容本地存储配置。
 * @param activityId 附件所属活动
 * @param file 浏览器选择的文件
 * @param stage 业务附件阶段
 * @param access 表单分组、动作和查看下载权限
 * @param idempotencyKey 本文件稳定的幂等请求键
 * @returns 授权文件元数据，不包含OSS密钥或公开对象地址
 */
export function uploadOssAttachment(
  activityId: string,
  file: File,
  stage: FileRecord['stage'],
  access: FileAccessInput,
  idempotencyKey: string
): Promise<FileRecord> {
  const body = new FormData()
  body.set('access', JSON.stringify(access))
  body.set('file', file)
  return request(`/activities/${encodeURIComponent(activityId)}/files?stage=${stage}`, { method: 'POST', body, headers: { 'idempotency-key': idempotencyKey } })
}
