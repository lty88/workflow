import type { CompanyConfig } from '@workflow/domain';
import type { BusinessGraphModel } from '@/components/graph/types';
import { templateGraph } from '@/components/graph/models';

/**
 * 只展示真正可编辑的审批节点与依赖，把公共执行归档阶段留在工作台摘要中。
 * @param config 当前组织与模板上下文
 * @returns 不含展示阶段的设计图模型
 */
export function templateEditorGraph(config: CompanyConfig): BusinessGraphModel {
  const model = templateGraph(config);
  if (model.issue) return model;
  const nodes = [];
  const edges = [];
  for (const node of model.data.nodes || []) if (node.data?.kind === 'workflow') nodes.push(node);
  for (const edge of model.data.edges || [])
    if (edge.source.startsWith('workflow:') && edge.target.startsWith('workflow:')) edges.push(edge);
  return { data: { nodes, edges } };
}
