import type { ActivityType, TemplateRelease, WorkflowTemplate } from '@workflow/domain';
import { editableTemplateDefinition } from '@workflow/domain';
import { jsonValue, query } from './repository';
import type { Database } from './repository';

interface TemplateRow {
  id: string;
  code: string;
  active: number | boolean;
  current_version: number;
  draft_revision: number;
  draft: unknown;
  published: unknown;
  updated_at: string;
}

/**
 * 将模板记录转换成接口模型，旧草稿解除默认节点锁定，发布历史保持原样。
 * @param row 数据库记录
 * @returns 模板模型
 */
function templateValue(row: TemplateRow): WorkflowTemplate {
  return {
    id: row.id,
    code: row.code,
    active: Boolean(row.active),
    currentVersion: row.current_version,
    draftRevision: row.draft_revision,
    draft: editableTemplateDefinition(jsonValue(row.draft)),
    published: row.published ? jsonValue(row.published) : null,
    updatedAt: row.updated_at,
  };
}

/**
 * 读取模板目录，管理员读取草稿，业务选择另由授权层过滤。
 * @param db 数据库连接
 * @returns 模板列表
 */
export async function loadTemplates(db: Database): Promise<WorkflowTemplate[]> {
  const rows = await query<TemplateRow>(db, 'SELECT * FROM workflow_templates ORDER BY updated_at DESC,id');
  return rows.map(templateValue);
}

/**
 * 读取指定模板并按需锁定发布指针，避免提交与发布竞态。
 * @param db 事务连接
 * @param id 模板标识
 * @param lock 锁方式
 * @returns 模板或空
 */
export async function loadTemplate(
  db: Database,
  id: string,
  lock: 'none' | 'share' | 'update' = 'none',
): Promise<WorkflowTemplate | null> {
  const suffix = lock === 'share' ? ' FOR SHARE' : lock === 'update' ? ' FOR UPDATE' : '';
  const rows = await query<TemplateRow>(db, 'SELECT * FROM workflow_templates WHERE id=?' + suffix, [id]);
  return rows[0] ? templateValue(rows[0]) : null;
}

/**
 * 读取不可变的历史发布版本，兼容MySQL对象及文本JSON。
 * @param db 数据库连接
 * @param id 模板标识
 * @param version 发布版本
 * @returns 发布快照或空
 */
export async function loadTemplateRelease(
  db: Database,
  id: string,
  version: number,
): Promise<TemplateRelease | null> {
  const rows = await query<{
    definition: unknown;
    form_snapshot: unknown;
    published_by: string;
    published_at: string;
  }>(
    db,
    'SELECT definition,form_snapshot,published_by,published_at FROM workflow_template_releases WHERE template_id=? AND version=?',
    [id, version],
  );
  const row = rows[0];
  return row
    ? {
        templateId: id,
        version,
        definition: jsonValue(row.definition),
        form: jsonValue(row.form_snapshot),
        publishedBy: row.published_by,
        publishedAt: row.published_at,
      }
    : null;
}

/**
 * 读取活动类型并统一布尔字段。
 * @param db 数据库连接
 * @returns 活动类型列表
 */
export async function loadActivityTypes(db: Database): Promise<ActivityType[]> {
  const rows = await query<ActivityType>(
    db,
    'SELECT id,code,name,active,sort FROM activity_types ORDER BY sort,id',
  );
  for (const row of rows) row.active = Boolean(row.active);
  return rows;
}
