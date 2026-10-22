import { readEnv } from "../env";
import { createPool } from "./repository";
import { seedCommonOrganization } from "./organization-seed";

/** 连接当前环境数据库批量补齐常用部门，输出结果并释放连接，不启动应用或数据库服务。 */
async function seedOrganization(): Promise<void> {
  const pool = createPool(readEnv());
  try {
    const result = await seedCommonOrganization(pool);
    console.info(JSON.stringify(result, null, 2));
    console.info(
      result.draftUpdated
        ? "常用部门及岗位角色已批量补齐，刷新组织架构页即可查看；现有账号密码、权限与活动历史均保留。"
        : "常用部门及岗位角色已齐全，本次无需写入。",
    );
  } finally {
    await pool.end();
  }
}

await seedOrganization();
