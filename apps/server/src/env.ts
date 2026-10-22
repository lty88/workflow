import { z } from 'zod';

/**
 * 读取环境变量并校验数据库连接与服务参数，不输出密码。
 * @param input 进程环境
 * @returns 已校验环境配置
 */
export function readEnv(input: NodeJS.ProcessEnv = process.env) {
  return z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      HOST: z.string().default('127.0.0.1'),
      PORT: z.coerce.number().int().default(3100),
      APP_ORIGIN: z.url().default('http://localhost:5173'),
      PUBLIC_APP_URL: z.url().optional(),
      MYSQL_HOST: z.string().default('127.0.0.1'),
      MYSQL_PORT: z.coerce.number().int().default(3307),
      MYSQL_DATABASE: z
        .string()
        .regex(/^[a-zA-Z0-9_]+$/)
        .default('activity_workflow'),
      MYSQL_USER: z.string().min(1).default('workflow'),
      MYSQL_PASSWORD: z.string().min(1),
      UPLOAD_DIR: z.string().default('../../data/uploads'),
      SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    })
    .parse(input);
}
export type Environment = ReturnType<typeof readEnv>;
