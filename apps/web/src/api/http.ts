import { createUuid } from '@workflow/domain'
import type { ApiErrorBody } from '@workflow/domain'

let csrfToken = ''
const mutationKeys = new Map<string, string>()
export class ApiError extends Error {
  /**
   * 构造服务端业务错误。
   * @param status HTTP状态
   * @param code 错误码
   * @param message 提示
   * @param details 字段错误
   */
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: string[] = []
  ) {
    super(message)
  }
}

/**
 * 更新当前会话的CSRF校验令牌，不持久化原始会话Cookie。
 * @param token 服务端返回令牌
 */
export function setCsrfToken(token: string): void {
  csrfToken = token
}

/**
 * 调用同源API并统一处理错误与会话过期。
 * @param path API路径
 * @param init 请求参数
 * @returns 类型化响应
 */
export async function request<T>(path: string, init: RequestInit & { responseType?: 'json' | 'blob' } = {}): Promise<T> {
  const { responseType = 'json', ...options } = init
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData) && init.body) headers.set('Content-Type', 'application/json')
  if (csrfToken && init.method && init.method !== 'GET') headers.set('x-csrf-token', csrfToken)
  let response: Response
  try {
    response = await fetch('/api' + path, {
      ...options,
      headers,
      credentials: 'same-origin',
      signal: init.signal || AbortSignal.timeout(30000),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查服务后重试；已填写内容会保留')
  }
  if (!response.ok) {
    let body: ApiErrorBody | null = null
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      /* 非JSON网关错误使用统一提示。 */
    }
    if (path !== '/auth/login' && (response.status === 401 || body?.error.code === 'ACCOUNT_DISABLED'))
      window.dispatchEvent(new Event('workflow:session-expired'))
    throw new ApiError(response.status, body?.error.code || 'REQUEST_ERROR', body?.error.message || '请求失败，请稍后重试', body?.error.details || [])
  }
  return (responseType === 'blob' ? response.blob() : response.json()) as Promise<T>
}

/**
 * 执行写操作，网络失败重试沿用相同幂等键。
 * @param path 接口路径
 * @param body 不含幂等键的数据
 * @param method 写入方法
 * @param keyInHeader 是否将键置于请求头
 * @returns 写入结果
 */
export async function mutation<T>(path: string, body: Record<string, unknown>, method = 'POST', keyInHeader = false): Promise<T> {
  const identity = method + path + JSON.stringify(body)
  let key = mutationKeys.get(identity)
  if (!key) {
    key = createUuid()
    mutationKeys.set(identity, key)
  }
  const headers: Record<string, string> = {}
  if (keyInHeader) headers['idempotency-key'] = key
  try {
    const result = await request<T>(path, {
      method,
      headers,
      body: JSON.stringify(keyInHeader ? body : { ...body, idempotencyKey: key }),
    })
    mutationKeys.delete(identity)
    return result
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) mutationKeys.delete(identity)
    throw error
  }
}

/**
 * 提取供页面显示的错误详情。
 * @param error 接口异常
 * @returns 中文提示集合
 */
export function errorMessages(error: unknown): string[] {
  return error instanceof ApiError && error.details.length ? error.details : [error instanceof Error ? error.message : '操作失败，请重试']
}
