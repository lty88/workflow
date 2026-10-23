import { activeMember, hasPermission } from '@workflow/domain';
import type { TemplateDefinition } from '@workflow/domain';
import { readEnv } from '../env';
import { createPool, loadConfig } from './repository';
import { createTemplate, publishTemplate, saveTemplate } from '../services/template-service';

/**
 * 一次性种子：按《线下活动申请表》审批链创建并发布"常规活动申请模板"。
 * 链路为部门领导审批（申请人部门负责人，必要审核）→ 分管院领导审批（director）
 * → 营销中心领导审批（marketing）；后续指派、汇报、归档使用系统内置阶段。
 * 重复执行时检测编码已存在则跳过，不改动已有模板。
 */
async function seed(): Promise<void> {
  const pool = createPool(readEnv());
  try {
    const config = (await loadConfig(pool)).published;
    let actor = '';
    for (const user of config.users)
      if (activeMember(config, user.id) && hasPermission(config, user.id, 'config:manage')) {
        actor = user.id;
        break;
      }
    if (!actor) throw new Error('未找到具备 config:manage 权限的成员，无法创建模板');
    const departments = new Set<string>();
    for (const user of config.users)
      if (
        hasPermission(config, user.id, 'activity:create') &&
        hasPermission(config, user.id, 'activity:read')
      )
        departments.add(user.department);
    const definition: TemplateDefinition = {
      name: '常规活动申请模板',
      activityTypeIds: ['teaching', 'reading'],
      defaultForTypeIds: [],
      departmentIds: [...departments],
      roleIds: [],
      nodes: [
        {
          id: 'n-dept-leader',
          label: '部门领导审批',
          kind: 'approval',
          deps: [],
          assignee: { type: 'manager', value: '' },
          protected: true,
        },
        {
          id: 'n-college-leader',
          label: '分管院领导审批',
          kind: 'approval',
          deps: ['n-dept-leader'],
          assignee: { type: 'role', value: 'director' },
        },
        {
          id: 'n-marketing-leader',
          label: '营销中心领导审批',
          kind: 'approval',
          deps: ['n-college-leader'],
          assignee: { type: 'role', value: 'marketing' },
        },
      ],
      layout: { direction: 'TB', positions: {} },
    };
    const created = await createTemplate(pool, actor, {
      code: 'regular',
      idempotencyKey: 'seed-regular-create-20261022',
    });
    const saved = await saveTemplate(pool, actor, created.id, {
      definition,
      expectedDraftRevision: created.draftRevision,
      idempotencyKey: 'seed-regular-save-2026102201',
    });
    const published = await publishTemplate(pool, actor, created.id, {
      expectedDraftRevision: saved.draftRevision,
      idempotencyKey: 'seed-regular-publish-2026102',
    });
    console.info(
      `常规活动申请模板已发布：id=${published.id} code=${published.code} v${published.currentVersion} 授权部门=${definition.departmentIds.join(',')}`,
    );
  } finally {
    await pool.end();
  }
}
await seed();
