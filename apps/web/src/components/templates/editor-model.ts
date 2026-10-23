import type { EdgeData, NodeData } from '@antv/g6';
import { topological } from '@workflow/domain';
import type { CompanyConfig } from '@workflow/domain';
import type { BusinessGraphModel } from '@/components/graph/types';
import { templateGraph } from '@/components/graph/models';

/**
 * 创建只读系统边界，不写入业务节点、待办或模板保存坐标。
 * @param id 系统图标识
 * @param label 显示名称
 * @param summary 触发或结束条件
 * @returns 与普通业务节点区分的系统卡片
 */
function boundaryNode(id: string, label: string, summary: string): NodeData {
  return {
    id,
    data: { businessId: id, kind: 'stage', boundary: true, label, summary },
    style: { labelText: `${label}\n${summary}`, fill: '#eef4fb', stroke: '#c2d2e7' },
  };
}

/**
 * 将业务节点与只读开始、结束边界组合为设计图，知会不作为结束的必办关卡。
 * @param config 当前组织与模板上下文
 * @returns 有开始和完成锚点的设计图，系统锚点不改变真实审批依赖
 */
export function templateEditorGraph(config: CompanyConfig): BusinessGraphModel {
  const checked = topological(config.workflow.nodes);
  if (checked.error) return { data: { nodes: [], edges: [] }, issue: checked.error };
  const workflowNodes = config.workflow.nodes;
  const source = templateGraph(config);
  const nodes: NodeData[] = [
    boundaryNode('stage:apply', '开始 · 提交活动申请', '系统触发，没有前置的节点同时进入'),
    ...(source.data.nodes || []).filter((node) => node.data?.kind === 'workflow'),
    boundaryNode(
      'stage:approved',
      '流程办理完成',
      workflowNodes.length ? '必办节点完成后进入指派执行' : '请先添加业务节点',
    ),
  ];
  const edges: EdgeData[] = [];
  const cache = new Map<string, string[]>();
  /**
   * 将知会前置展开为真正的阻断前置，避免图上出现多余的完成汇合边。
   * @param id 模板节点标识
   * @returns 实际必办前置标识
   */
  function blocking(id: string): string[] {
    const cached = cache.get(id);
    if (cached) return cached;
    const node = workflowNodes.find((item) => item.id === id)!;
    const result = node.kind === 'notice' ? [...new Set(node.deps.flatMap(blocking))] : [id];
    cache.set(id, result);
    return result;
  }
  /**
   * 追加稳定标识的展示连线，虚线用于不阻断的知会或空模板占位。
   * @param from 源图节点
   * @param to 目标图节点
   * @param dashed 是否虚线
   */
  function connect(from: string, to: string, dashed = false): void {
    edges.push({
      id: 'edge:' + JSON.stringify([from, to]),
      source: from,
      target: to,
      style: { stroke: dashed ? '#b8c0cf' : '#9aadc9', lineDash: dashed ? [5, 4] : undefined },
    });
  }
  for (const node of checked.order) {
    if (!node.deps.length) connect('stage:apply', 'workflow:' + node.id, node.kind === 'notice');
    for (const dep of node.deps)
      connect(
        'workflow:' + dep,
        'workflow:' + node.id,
        node.kind === 'notice' || workflowNodes.find((item) => item.id === dep)?.kind === 'notice',
      );
    if (node.kind === 'notice') continue;
    const hasChild = workflowNodes.some(
      (item) => item.kind !== 'notice' && item.deps.flatMap(blocking).includes(node.id),
    );
    if (!hasChild) connect('workflow:' + node.id, 'stage:approved');
  }
  if (!workflowNodes.some((node) => node.kind !== 'notice'))
    connect('stage:apply', 'stage:approved', !workflowNodes.length);
  return { data: { nodes, edges } };
}
