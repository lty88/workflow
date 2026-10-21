/**
 * 显示本地时间，空值保持简洁。
 * @param value ISO时间
 * @returns 中文时间
 */
export function formatTime(value: string | undefined): string {
  if (!value) return '—';
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
}
/**
 * 显示人民币金额。
 * @param value 元金额
 * @returns 格式化金额
 */
export function formatMoney(value: string | undefined): string {
  return value && Number.isFinite(Number(value))
    ? '¥ ' + Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
}
/**
 * 克隆表单和配置中的JSON数据，兼容Vue响应式代理。
 * @param value 可序列化值
 * @returns 独立副本
 */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
/**
 * 生成配置实体的稳定标识。
 * @param prefix 业务前缀
 * @returns 新标识
 */
export function newId(prefix: string): string {
  return prefix + '-' + crypto.randomUUID().slice(0, 8);
}
