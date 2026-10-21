import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { passwordSchema } from '@workflow/domain';
import { configuredPassword } from '../db/local-config';
import { query, transaction } from '../db/repository';
import { hashPassword } from './auth';

/**
 * 使用维护密码恢复初始管理员登录，事务内更新哈希、撤销旧会话并记录审计。
 * @param pool 项目数据库连接池
 * @param password 从本地配置读取的新密码，不写入日志或审计
 * @returns 已恢复的管理员登录账号
 */
export async function resetAdminPassword(pool: Pool, password: string): Promise<string> {
  passwordSchema.parse({ password });
  if (!configuredPassword(password)) throw new Error('ADMIN_PASSWORD不能使用示例占位值');
  const encoded = await hashPassword(password);

  /**
   * 锁定初始管理员，仅更新该账号密码和会话；任一步失败时整体回滚。
   * @param connection 当前事务连接
   * @returns 已恢复的登录账号
   */
  async function recover(connection: PoolConnection): Promise<string> {
    const rows = await query<{ id: string; username: string }>(
      connection,
      'SELECT id,username FROM members WHERE id=? AND username=? FOR UPDATE',
      ['u-admin', 'admin'],
    );
    const admin = rows[0];
    if (!admin) throw new Error('未找到初始admin账号，请确认连接的是项目数据库且已完成初始化');
    await connection.execute('UPDATE members SET password_hash=? WHERE id=?', [encoded, admin.id]);
    await connection.execute('DELETE FROM sessions WHERE member_id=?', [admin.id]);
    await connection.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
      randomUUID(),
      'local-maintenance',
      '本地恢复管理员密码',
      JSON.stringify({ memberId: admin.id }),
    ]);
    return admin.username;
  }

  return transaction(pool, recover);
}
