import { expect, test } from 'vitest';
import { parseEnv } from 'node:util';
import {
  configuredPassword,
  grantDatabaseName,
  initialPassword,
  localPassword,
  updateEnv,
} from '../db/local-config';

/** 检查本机向导生成的凭据满足初始化长度和数据库密码复杂度。 */
function passwordCase(): void {
  const a = localPassword();
  const b = localPassword();
  expect(a.length).toBeGreaterThanOrEqual(12);
  expect(a).toMatch(/[A-Z]/);
  expect(a).toMatch(/[a-z]/);
  expect(a).toMatch(/[0-9]/);
  expect(a).toContain('!');
  expect(a).not.toBe(b);
  expect(configuredPassword('replace-with-password')).toBe(false);
  expect(configuredPassword(a)).toBe(true);
  expect(grantDatabaseName('activity_workflow', false)).toBe('activity\\_workflow');
  expect(grantDatabaseName('activity_workflow', true)).toBe('activity_workflow');
}
test('本机配置生成独立随机密码并识别占位值', passwordCase);

/** 检查写入本机配置时保留未知配置与已填写密码，正确处理引号和反斜杠。 */
function envCase(): void {
  const original = "# 自定义配置\nMYSQL_PORT=3307\nADMIN_PASSWORD='Existing\"Password'\nCUSTOM=keep-me\n";
  const result = updateEnv(original, {
    MYSQL_PORT: '3306',
    ADMIN_PASSWORD: 'Existing"Password',
    MYSQL_PASSWORD: 'New#Safe\\Password',
    MYSQL_USER: 'wf_local_test',
  });
  const parsed = parseEnv(result);
  expect(parsed.MYSQL_PORT).toBe('3306');
  expect(parsed.ADMIN_PASSWORD).toBe('Existing"Password');
  expect(parsed.MYSQL_PASSWORD).toBe('New#Safe\\Password');
  expect(parsed.CUSTOM).toBe('keep-me');
  expect(result).toContain("ADMIN_PASSWORD='Existing\"Password'");
  expect(result).toContain('# 自定义配置');
}
test('写入.env保留已有配置和密码，不使用会损坏凭据的JSON转义', envCase);

/** 检查应用密码默认123456，并保留自定义值、拒绝不符合长度规则的值。 */
function initialPasswordCase(): void {
  expect(initialPassword()).toBe('123456');
  expect(initialPassword('')).toBe('123456');
  expect(initialPassword('replace-with-password')).toBe('123456');
  expect(initialPassword('123456')).toBe('123456');
  expect(initialPassword('Custom!Password')).toBe('Custom!Password');
  expect(initialPassword.bind(undefined, '12345')).toThrow();
  expect(initialPassword.bind(undefined, 'a'.repeat(201))).toThrow();
}
test('应用账号默认六位密码，数据库密码仍随机生成', initialPasswordCase);
