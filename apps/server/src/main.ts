import { buildApp } from './app';
import { readEnv } from './env';
import { createPool, flushOutbox } from './db/repository';
import { scheduleReminders } from './services/reminder-service';
import { requireDatabaseReady } from './db/readiness';

/**
 * 检查数据库就绪后启动API与站内通知投递，关闭时释放连接。
 */
async function main(): Promise<void> {
  const env = readEnv();
  const pool = createPool(env);
  try { await requireDatabaseReady(pool); } catch (error) { await pool.end(); throw error; }
  const app = await buildApp(pool, env);
  /**
   * 投递已提交事务产生的站内消息，不改变审批决定。
   */
  async function deliver(): Promise<void> {
    try {
      await flushOutbox(pool);
    } catch {
      app.log.error('站内通知投递失败，将在下个周期重试');
    }
  }
  const timer = setInterval(deliver, 10000);
  timer.unref();
  let scanning = false;
  /**
   * 定期扫描超时待办，避免同进程重复扫描。
   */
  async function remind(): Promise<void> {
    if (scanning) return;
    scanning = true;
    try {
      await scheduleReminders(pool);
    } catch {
      app.log.error('超时待办扫描失败，将在下个周期重试');
    } finally {
      scanning = false;
    }
  }
  const reminderTimer = setInterval(remind, 60000);
  reminderTimer.unref();
  /**
   * 清理通知定时器和数据库连接。
   */
  async function cleanup(): Promise<void> {
    clearInterval(timer);
    clearInterval(reminderTimer);
    await pool.end();
  }
  app.addHook('onClose', cleanup);
  /**
   * 响应进程关闭信号，等待在途请求完成。
   */
  async function shutdown(): Promise<void> {
    await app.close();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try { await app.listen({ host: env.HOST, port: env.PORT }); } catch (error) { await app.close(); throw error; }
}

/** 以明确的启动错误结束当前进程，避免数据库未就绪时仍显示API监听成功。
 * @param error 启动异常
 */
function startupFailure(error: unknown): void { console.error('服务启动中止：' + (error instanceof Error ? error.message : '请检查配置后重试')); process.exitCode = 1; }

main().catch(startupFailure);
