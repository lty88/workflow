import type { Environment } from '../env';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 校验写入请求来源，仅开发环境允许相同协议和端口的本机回环地址互通。
 * @param origin 浏览器发送的Origin请求头
 * @param env 运行模式与已配置的前端来源
 * @returns 请求是否来自允许的前端地址
 */
export function isAllowedOrigin(origin: string, env: Pick<Environment, 'APP_ORIGIN' | 'NODE_ENV'>): boolean {
  try {
    const incoming = new URL(origin);
    const configured = new URL(env.APP_ORIGIN);
    if (!['http:', 'https:'].includes(incoming.protocol) || incoming.origin !== origin) return false;
    if (incoming.origin === configured.origin) return true;
    return (
      env.NODE_ENV === 'development' &&
      loopbackHosts.has(configured.hostname) &&
      loopbackHosts.has(incoming.hostname) &&
      incoming.protocol === configured.protocol &&
      incoming.port === configured.port
    );
  } catch {
    return false;
  }
}
