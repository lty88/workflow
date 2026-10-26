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
      STORAGE_DRIVER: z.enum(['local', 'oss']).default('local'),
      OSS_REGION: z
        .string()
        .regex(/^oss-[a-z0-9-]+$/)
        .default('oss-cn-beijing'),
      OSS_BUCKET: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
        .default('qyzh2025test'),
      OSS_DOMAIN: z.url().default('https://oss-test.qyzhjy.com'),
      OSS_ACCESS_KEY_ID: z.string().default(''),
      OSS_ACCESS_KEY_SECRET: z.string().default(''),
      OSS_PREFIX: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,60}$/)
        .default('workflow'),
      SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    })
    .superRefine(
      /** 校验OSS启用时的凭据与HTTPS自定义域名，配置错误直接阻止启动。
       * @param env 当前服务端配置
       * @param context 配置校验错误收集器
       */
      function validateStorage(env, context) {
        if (
          env.STORAGE_DRIVER === 'oss' &&
          (!env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET || /^x+$/i.test(env.OSS_ACCESS_KEY_SECRET))
        )
          context.addIssue({
            code: 'custom',
            message: '启用OSS需要在服务端.env填写有效的OSS_ACCESS_KEY_ID和OSS_ACCESS_KEY_SECRET',
          });
        const domain = new URL(env.OSS_DOMAIN);
        if (
          domain.protocol !== 'https:' ||
          domain.pathname !== '/' ||
          domain.search ||
          domain.hash ||
          domain.username ||
          domain.password
        )
          context.addIssue({ code: 'custom', message: 'OSS_DOMAIN必须为不带路径的HTTPS域名' });
      },
    )
    .parse(input);
}
export type Environment = ReturnType<typeof readEnv>;
