import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { DEFAULT_PASSWORD, passwordSchema } from '@workflow/domain';

/**
 * 读取应用账号初始密码，未填写或仍为占位值时使用统一默认密码。
 * @param value 环境变量中的初始密码
 * @returns 满足应用密码规则的初始值
 */
export function initialPassword(value?: string): string {
  return passwordSchema.parse({ password: configuredPassword(value) ? value : DEFAULT_PASSWORD }).password;
}

/** 判断密码是否仍为示例占位值，避免将模板内容用作真实凭据。
 * @param value 本地配置值
 * @returns 是否已填写真实值
 */
export function configuredPassword(value?: string): boolean {
  return !!value && !value.startsWith('replace-');
}

/** 生成本地开发凭据，保证包含大小写、数字和特殊字符。
 * @returns 新的随机密码
 */
export function localPassword(): string {
  return 'Wf9!' + randomBytes(24).toString('hex');
}

/** 按MySQL授权模式转义库名中的下划线，确保授权仅匹配项目数据库。
 * @param database 实际项目库名
 * @param partialRevokes MySQL是否启用按字面量解析数据库名的模式
 * @returns 用于GRANT数据库限定符的名称
 */
export function grantDatabaseName(database: string, partialRevokes: boolean): string {
  return partialRevokes ? database : database.replaceAll('_', '\\_');
}

/** 选择Node环境文件支持的引号，保留密码中的反斜杠、空格和井号。
 * @param value 环境变量值
 * @returns 可以直接写入.env的文本
 */
function quoteEnv(value: string): string {
  for (const quote of ['"', "'", '`']) if (!value.includes(quote)) return quote + value + quote;
  throw new Error('配置值包含三种引号，请手动编辑对应.env变量后重试。');
}

/** 更新指定环境变量，保留其他变量、说明及已正确填写的原始行。
 * @param source 原始环境文件
 * @param values 本次需要更新的变量
 * @returns 更新后的环境文件内容
 */
export function updateEnv(source: string, values: Record<string, string>): string {
  const remaining = new Map(Object.entries(values));
  const current = parseEnv(source);
  const lines = source.split(/\r?\n/);
  const result: string[] = [];
  for (const line of lines) {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key && Object.hasOwn(values, key)) {
      if (remaining.has(key)) {
        const value = remaining.get(key)!;
        result.push(current[key] === value ? line : key + '=' + quoteEnv(value));
        remaining.delete(key);
      }
    } else result.push(line);
  }
  for (const [key, value] of remaining) result.push(key + '=' + quoteEnv(value));
  return result.join('\n').trimEnd() + '\n';
}
