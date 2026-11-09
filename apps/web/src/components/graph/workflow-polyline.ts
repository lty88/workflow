import { ExtensionCategory, Polyline, register } from '@antv/g6';
import type { Point, PolylineStyleProps } from '@antv/g6';

const EDGE_TYPE = 'workflow-polyline';
let registered = false;

/** 清理布局与边界交点产生的连续重复点，确保首尾箭头具有有效方向。 */
export class WorkflowPolyline extends Polyline {
  /** 根据实际路由生成折线顶点，移除长度接近零的相邻线段。
   * @param attributes G6 合并后的折线样式
   * @returns 保持原路线的有效顶点序列
   */
  protected getPoints(attributes: Required<PolylineStyleProps>): Point[] {
    const points: Point[] = [];
    for (const point of super.getPoints(attributes)) {
      const previous = points[points.length - 1];
      if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 0.01)
        points.push(point);
    }
    return points;
  }
}

/** 注册流程折线一次，供自动布局和手工设计画布共同使用。
 * @returns 已注册的 G6 连线类型名称
 */
export function registerWorkflowPolyline(): string {
  if (!registered) {
    register(ExtensionCategory.EDGE, EDGE_TYPE, WorkflowPolyline);
    registered = true;
  }
  return EDGE_TYPE;
}
