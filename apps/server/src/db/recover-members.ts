import { readEnv } from '../env';
import { createPool, query, transaction, jsonValue } from './repository';
import { hashPassword } from '../services/password';
import { DEFAULT_PASSWORD } from '@workflow/domain';
import type { CompanyConfig } from '@workflow/domain';
import type { PoolConnection } from 'mysql2/promise';
/** 显式恢复迁移前被误删的成员，仅插入缺失账号，初始密码123456，已有账号及密码保持不变。 */
async function recover(): Promise<void> {
  const pool = createPool(readEnv());
  try {
    /** 锁定旧配置，在第六版迁移前恢复缺失账号并记录审计。
     * @param db 事务连接
     * @returns 恢复的账号数
     */
    async function restore(db: PoolConnection): Promise<number> {
      if ((await query(db, 'SELECT version FROM schema_migrations WHERE version=6')).length)
        throw new Error('仅允许在第六版迁移前恢复；升级后请通过人员管理维护');
      const rows = await query<{ published: unknown }>(
        db,
        "SELECT published FROM configuration WHERE id='company' FOR UPDATE",
      );
      if (!rows[0]) throw new Error('旧配置不存在，请恢复数据库备份');
      const config = jsonValue<CompanyConfig>(rows[0].published);
      let count = 0;
      for (const user of config.users) {
        if (
          (await query(db, 'SELECT id FROM members WHERE id=? OR username=?', [user.id, user.username]))
            .length
        )
          continue;
        await db.execute(
          'INSERT INTO members(id,username,name,department_id,active,roles,password_hash) VALUES (?,?,?,?,?,?,?)',
          [
            user.id,
            user.username,
            user.name,
            user.department,
            user.active,
            JSON.stringify(user.roles),
            await hashPassword(DEFAULT_PASSWORD),
          ],
        );
        await db.execute('DELETE FROM sessions WHERE member_id=?',[user.id]);
      count++;
      }
      await db.execute('INSERT INTO audit_events(id,actor_id,action,data) VALUES (?,?,?,?)', [
        crypto.randomUUID(),
        'local-maintenance',
        '显式恢复误删成员',
        JSON.stringify({ count }),
      ]);
      return count;
    }
    console.info(
      `已恢复${await transaction(pool, restore)}个缺失账号，恢复账号的初始密码为123456；请继续运行 pnpm db:migrate。`,
    );
  } finally {
    await pool.end();
  }
}
await recover();
