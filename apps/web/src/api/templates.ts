import type {
  TemplateCatalogue,
  TemplateDefinition,
  TemplateRelease,
  TemplateSelection,
  TemplateSummary,
  WorkflowTemplate,
} from '@/typings/api/templates';
import type { WorkflowPreview } from '@/typings/api';
import type { ActivityType, NodeDefinition } from '@workflow/domain';
import { mutation, request } from './http';

/** 读取当前申请人可选择的发布模板与冻结表单。
 * @returns 授权模板列表
 */
export function templatesApi(): Promise<TemplateSummary[]> {
  return request('/workflow-templates');
}
/** 读取当前申请人有模板可选的活动类型。
 * @returns 类型列表
 */
export function activityTypesApi(): Promise<ActivityType[]> {
  return request('/activity-types');
}
/** 读取管理员模板目录、活动类型和组织上下文。
 * @returns 模板配置目录
 */
export function templateCatalogueApi(): Promise<TemplateCatalogue> {
  return request('/admin/workflow-templates');
}
/** 创建独立模板草稿，网络重试复用幂等键。
 * @param code 新模板编码
 * @param sourceId 可选复制源
 * @param firstNodeKind 无复制源时使用的首个业务节点类型
 * @returns 新模板
 */
export function createTemplateApi(
  code: string,
  sourceId?: string,
  firstNodeKind: NodeDefinition['kind'] = 'approval',
): Promise<WorkflowTemplate> {
  return mutation('/admin/workflow-templates', { code, ...(sourceId ? { sourceId } : { firstNodeKind }) });
}
/** 保存模板草稿并检查草稿版本。
 * @param id 模板标识
 * @param definition 编辑定义
 * @param expectedDraftRevision 草稿版本
 * @returns 最新模板
 */
export function saveTemplateApi(
  id: string,
  definition: TemplateDefinition,
  expectedDraftRevision: number,
): Promise<WorkflowTemplate> {
  return mutation(`/admin/workflow-templates/${id}/draft`, { definition, expectedDraftRevision }, 'PUT');
}
/** 发布已保存草稿的新版本。
 * @param id 模板标识
 * @param expectedDraftRevision 草稿版本
 * @returns 最新模板
 */
export function publishTemplateApi(id: string, expectedDraftRevision: number): Promise<WorkflowTemplate> {
  return mutation(`/admin/workflow-templates/${id}/publish`, { expectedDraftRevision });
}
/** 启停模板，保留已提交实例。
 * @param template 当前模板与草稿版本
 * @param active 新启用状态
 * @returns 最新模板
 */
export function templateActiveApi(template: WorkflowTemplate, active: boolean): Promise<WorkflowTemplate> {
  return mutation(`/admin/workflow-templates/${template.id}/active`, {
    active,
    expectedDraftRevision: template.draftRevision,
  });
}
/** 删除没有业务引用的未发布草稿，保留管理审计。
 * @param template 草稿模板及版本
 * @returns 删除结果
 */
export function deleteTemplateApi(template: WorkflowTemplate): Promise<{ ok: boolean }> {
  return mutation(
    `/admin/workflow-templates/${template.id}`,
    { expectedDraftRevision: template.draftRevision },
    'DELETE',
  );
}
/** 由服务端校验未发布模板的所有分支与办理权限。
 * @param id 模板标识
 * @param definition 模板定义
 * @returns 节点与规则错误
 */
export function validateTemplateApi(
  id: string,
  definition: TemplateDefinition,
): Promise<{ errors: string[] }> {
  return request(`/admin/workflow-templates/${id}/validate`, {
    method: 'POST',
    body: JSON.stringify(definition),
  });
}
/** 读取管理员可核对的不可变发布历史。
 * @param id 模板标识
 * @returns 发布历史
 */
export function templateVersionsApi(id: string): Promise<TemplateRelease[]> {
  return request(`/admin/workflow-templates/${id}/versions`);
}
/** 用真实申请人和预算演算未发布草稿，不创建任务。
 * @param id 模板标识
 * @param definition 当前草稿
 * @param applicant 演算申请人
 * @param payload 条件字段内容
 * @returns 实际路线
 */
export function simulateTemplateApi(
  id: string,
  definition: TemplateDefinition,
  applicant: string,
  payload: Record<string, string>,
): Promise<WorkflowPreview> {
  return request(`/admin/workflow-templates/${id}/preview`, {
    method: 'POST',
    body: JSON.stringify({ definition, applicant, payload }),
  });
}
/** 预览申请人所选的已发布模板及版本。
 * @param selection 模板选择
 * @param payload 申请内容
 * @param activityId 可编辑旧活动标识，用于服务端合并只读原值
 * @returns 路线、受理人和模板版本
 */
export function templatePreviewApi(
  selection: TemplateSelection,
  payload: Record<string, string>,
  activityId?: string,
): Promise<WorkflowPreview> {
  return request(`/workflow-templates/${selection.templateId}/preview`, {
    method: 'POST',
    body: JSON.stringify({ ...selection, payload, activityId }),
  });
}
