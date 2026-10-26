import { expect, test, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createUuid, instantiateWorkflow, seedConfig } from '@workflow/domain';
const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** 核对安全环境优先调用原生随机UUID，保留方法调用的正确上下文。 */
function nativeCase(): void {
  const expected = '9a1107dd-33cb-4f8f-a922-64b476751a87';
  /** 模拟浏览器原生UUID方法。
   * @returns 固定的合法UUID
   */
  function randomUUID(): string {
    return expected;
  }
  const native = vi.fn(randomUUID);
  vi.stubGlobal('crypto', { randomUUID: native });
  try {
    expect(createUuid()).toBe(expected);
    expect(native).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
}
test('存在原生randomUUID时优先使用原生实现', nativeCase);
/** 模拟HTTP IP环境，校验安全随机回退的UUID格式、重复生成及路线演算兼容性。 */
function insecureHttpCase(): void {
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  try {
    const ids = new Set<string>();
    for (let i = 0; i < 32; i++) {
      const id = createUuid();
      expect(id).toMatch(uuidV4);
      ids.add(id);
    }
    expect(ids.size).toBe(32);
    const result = instantiateWorkflow(seedConfig(), { budget: '1000' }, 'u-lin');
    expect(result.errors).toEqual([]);
    for (const node of result.nodes) expect(node.id).toMatch(uuidV4);
  } finally {
    vi.unstubAllGlobals();
  }
}
test('缺少randomUUID的HTTP IP环境可生成UUID并演算流程', insecureHttpCase);
/** 检查极旧浏览器缺少安全随机源时给出可操作的中文提示。 */
function missingCryptoCase(): void {
  vi.stubGlobal('crypto', undefined);
  try {
    expect(createUuid).toThrow('当前浏览器不支持安全随机数');
  } finally {
    vi.unstubAllGlobals();
  }
}
test('缺少安全随机源时提供明确提示', missingCryptoCase);
