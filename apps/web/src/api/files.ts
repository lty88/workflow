import { createUuid } from '@workflow/domain'
import type { FileAccessInput } from '@workflow/domain'
import type { FileRecord, MutationResult } from '@/typings/api'
import { ApiError, mutation, request } from './http'

const uploadKeys = new Map<string, string>()

/**
 * 上传单个阶段附件。
 * @param activityId 活动标识
 * @param file 浏览器文件
 * @param stage 文件阶段
 * @param access 所属节点和只收紧的附件授权
 * @returns 文件元数据
 */
export async function uploadApi(activityId: string, file: File, stage: FileRecord['stage'], access: FileAccessInput = {}): Promise<FileRecord> {
  const data = new FormData()
  data.set('access', JSON.stringify(access))
  data.set('file', file)
  const identity = [activityId, stage, file.name, file.size, file.lastModified, JSON.stringify(access)].join(':')
  const key = uploadKeys.get(identity) || createUuid()
  uploadKeys.set(identity, key)
  try {
    const result = await request<FileRecord>(`/activities/${activityId}/files?stage=${stage}`, {
      method: 'POST',
      body: data,
      headers: { 'idempotency-key': key },
    })
    uploadKeys.delete(identity)
    return result
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) uploadKeys.delete(identity)
    throw error
  }
}

/**
 * 修改已上传附件的附加权限，使用主单版本和幂等键防止并发覆盖。
 * @param id 文件标识
 * @param expectedVersion 当前主单版本
 * @param access 新查看和下载授权
 * @returns 主单新版本
 */
export function updateFileAccessApi(id: string, expectedVersion: number, access: FileAccessInput): Promise<MutationResult> {
  return mutation(`/files/${encodeURIComponent(id)}/access`, { expectedVersion, access: access.access, downloadAccess: access.downloadAccess }, 'PATCH')
}
