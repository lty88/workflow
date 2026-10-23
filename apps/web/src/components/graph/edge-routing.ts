import type { EdgeData, Graph, GraphOptions } from '@antv/g6';

/**
 * 配置连线样式：手工设计布局实时寻路，其他业务图继续沿用自动布局折点。
 * @param manualLayout 是否允许手工布局或正在恢复模板坐标
 * @returns G6 折线配置，设计器忽略旧折点并根据当前位置避开节点
 */
export function graphEdgeOptions(manualLayout: boolean): NonNullable<GraphOptions['edge']> {
  return {
    type: 'polyline',
    style: {
      endArrow: true,
      endArrowSize: 7,
      lineWidth: 1.5,
      radius: 8,
      ...(manualLayout
        ? {
            controlPoints: [],
            router: {
              type: 'shortest-path',
              enableObstacleAvoidance: true,
              offset: 12,
              gridSize: 10,
            },
          }
        : {}),
    },
  };
}

/**
 * 清除自动排列遗留的绝对折点，保留连接方向、业务数据和状态颜色。
 * @param edge 当前连线数据
 * @returns 仅重置折点的新连线数据，不修改原对象
 */
function withoutLayoutPoints(edge: EdgeData): EdgeData {
  return { ...edge, style: { ...edge.style, controlPoints: [] } };
}

/**
 * 按当前节点位置重新绘制全部连线，移动无关节点时也更新受其遮挡影响的路径。
 * @param graph 当前 G6 实例
 */
export async function refreshRoutedEdges(graph: Graph): Promise<void> {
  const edges = graph.getEdgeData();
  if (!edges.length) return;
  graph.updateEdgeData(edges.map(withoutLayoutPoints));
  await graph.draw();
}
