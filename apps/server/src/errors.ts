export class HttpError extends Error {
  /**
   * 构造可以返回给客户端的业务错误。
   * @param status HTTP状态
   * @param code 稳定错误码
   * @param message 中文说明
   * @param details 字段错误
   */
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: string[],
  ) {
    super(message);
  }
}

/**
 * 在业务条件不满足时中断事务。
 * @param condition 业务条件
 * @param status HTTP状态
 * @param code 错误码
 * @param message 中文说明
 */
export function ensure(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new HttpError(status, code, message);
}
