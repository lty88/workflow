import { expect, test } from 'vitest';
import { isAllowedOrigin } from '../services/origin';

/** 检查本机开发入口在localhost、IPv4和IPv6回环地址之间切换时可正常登录。
 */
function loopbackCase(): void {
  const env = { NODE_ENV: 'development' as const, APP_ORIGIN: 'http://localhost:5173' };
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'])
    expect(isAllowedOrigin(origin, env)).toBe(true);
  expect(isAllowedOrigin('http://localhost:5173', { ...env, APP_ORIGIN: 'http://127.0.0.1:5173/' })).toBe(
    true,
  );
}
test('开发环境允许相同协议和端口的本机回环来源', loopbackCase);

/** 检查开发兼容只适用于回环地址且不扩大端口、协议或外部域名授权。
 */
function rejectedOriginCase(): void {
  const env = { NODE_ENV: 'development' as const, APP_ORIGIN: 'http://localhost:5173' };
  for (const origin of [
    'http://localhost:5174',
    'https://127.0.0.1:5173',
    'http://localhost.example.com:5173',
    'http://127.0.0.2:5173',
    'http://192.168.1.10:5173',
    'null',
    'file:///tmp/index.html',
    'http://localhost:5173/path',
    'http://user@localhost:5173',
  ])
    expect(isAllowedOrigin(origin, env)).toBe(false);
  expect(isAllowedOrigin('http://localhost:5173', { ...env, APP_ORIGIN: 'http://192.168.1.10:5173' })).toBe(
    false,
  );
}
test('开发来源校验拒绝异端口、异协议、非回环主机和伪造来源', rejectedOriginCase);

/** 检查生产模式保持配置来源的精确匹配，不沿用开发环境的回环兼容。
 */
function productionCase(): void {
  const env = { NODE_ENV: 'production' as const, APP_ORIGIN: 'http://localhost:5173' };
  expect(isAllowedOrigin('http://localhost:5173', env)).toBe(true);
  expect(isAllowedOrigin('http://127.0.0.1:5173', env)).toBe(false);
  expect(isAllowedOrigin('https://erp.example.com', { ...env, APP_ORIGIN: 'https://erp.example.com/' })).toBe(
    true,
  );
  expect(
    isAllowedOrigin('https://erp.example.com:5173', { ...env, APP_ORIGIN: 'https://erp.example.com' }),
  ).toBe(false);
}
test('生产环境仅允许配置中的前端来源', productionCase);
