import { expect, test, vi } from 'vitest';
import { mutation, setCsrfToken } from '../../../web/src/api/http';

/**
 * 验证丢失响应后再次提交沿用同一幂等键，成功后下一次动作获得新键。
 */
async function retryCase(): Promise<void> {
  const bodies: string[] = [];
  let count = 0;
  /**
   * 模拟首次网络中断与随后成功的HTTP响应。
   * @param _input URL
   * @param init 请求参数
   * @returns HTTP响应
   */
  async function fakeFetch(_input: unknown, init?: RequestInit): Promise<Response> {
    bodies.push(String(init?.body));
    count += 1;
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-local-test');
    if (count === 1) throw new TypeError('network interrupted');
    return new Response(JSON.stringify({ id: 'one', version: 2 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  vi.stubGlobal('fetch', fakeFetch);
  setCsrfToken('csrf-local-test');
  try {
    await expect(mutation('/retry-test', { expectedVersion: 1 })).rejects.toThrow('网络连接失败');
    await mutation('/retry-test', { expectedVersion: 1 });
    await mutation('/retry-test', { expectedVersion: 1 });
    const first = JSON.parse(bodies[0]!).idempotencyKey;
    expect(JSON.parse(bodies[1]!).idempotencyKey).toBe(first);
    expect(JSON.parse(bodies[2]!).idempotencyKey).not.toBe(first);
  } finally {
    vi.unstubAllGlobals();
    setCsrfToken('');
  }
}
test('网络失败重试复用原请求标识，成功后新动作使用新标识', retryCase);
