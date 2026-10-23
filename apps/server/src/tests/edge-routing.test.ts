import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import type { BusinessGraphModel } from '../../../web/src/components/graph/types';
import { graphEdgeOptions, refreshRoutedEdges } from '../../../web/src/components/graph/edge-routing';
const webRequire = createRequire(new URL('../../../web/package.json', import.meta.url));
const g6Require = createRequire(webRequire.resolve('@antv/g6'));
const { Polyline } = g6Require('./elements/edges/polyline.js');
const { ElementController } = g6Require('./runtime/element.js');
const { Rect } = g6Require('@antv/g');

/**
 * 创建不挂载画布的矩形几何节点，供真实 G6 路由算法计算边界。
 * @param id 节点标识
 * @param x 中心横坐标
 * @param y 中心纵坐标
 * @returns 提供中心点、边界和可见状态的节点
 */
function geometryNode(id: string, x: number, y: number) {
  const key = new Rect({ style: { x: x - 140, y: y - 44, width: 280, height: 88 } });
  return {
    id,
    isVisible: () => true,
    getCenter: () => [x, y],
    getRenderBounds: () => key.getBounds(),
    getShape: () => key,
  };
}
/**
 * 使用已安装的 G6 算法计算路径，无浏览器或项目启动。
 * @param source 起点
 * @param target 终点
 * @param obstacles 其他节点
 * @returns 按当前坐标生成的折点
 */
function route(
  source: ReturnType<typeof geometryNode>,
  target: ReturnType<typeof geometryNode>,
  obstacles: ReturnType<typeof geometryNode>[] = [],
): number[][] {
  return Polyline.prototype.getControlPoints.call(
    {
      sourceNode: source,
      targetNode: target,
      context: { element: { getNodes: () => [source, target, ...obstacles] } },
      getEndpoints: () => [source.getCenter(), target.getCenter()],
    },
    graphEdgeOptions(true).style,
  );
}
/** 核对设计器覆盖布局旧折点，普通业务图继续沿用布局路径。 */
function routingOptionsCase(): void {
  const style = ElementController.prototype.getElementComputedStyle.call(
    {
      getThemeStyle: () => ({}),
      getPaletteStyle: () => ({}),
      getDefaultStyle: () => graphEdgeOptions(true).style,
      getElementState: () => [],
      getThemeStateStyle: () => ({}),
      getStateStyle: () => ({}),
    },
    'edge',
    { id: 'edge', style: { stroke: '#9aadc9', controlPoints: [[0, 800]] } },
  );
  expect(style.controlPoints).toEqual([]);
  expect(style.router).toMatchObject({ type: 'shortest-path', enableObstacleAvoidance: true });
  expect(style.stroke).toBe('#9aadc9');
  expect(graphEdgeOptions(false).style).not.toHaveProperty('controlPoints');
  expect(graphEdgeOptions(false).style).not.toHaveProperty('router');
}
test('设计器清除旧折点并启用避障，组织和审批展示图保持原样', routingOptionsCase);
/** 核对纵向节点移近后路线收短，不继续绕向旧位置。 */
function verticalCase(): void {
  const source = geometryNode('a', 0, 0);
  const far = route(source, geometryNode('b', 0, 600));
  const near = route(source, geometryNode('b', 0, 160));
  expect(Math.max(...far.map((point) => point[1]!))).toBeGreaterThan(500);
  expect(near.every((point) => point[0] === 0 && point[1]! >= 0 && point[1]! <= 160)).toBe(true);
  expect(Math.max(...near.map((point) => point[1]!))).toBeLessThan(160);
}
test('节点从 600 移回 160 后连线收短，不残留远处折返段', verticalCase);
/** 核对横向和反向拖动按当前位置计算，不依赖固定的上下关系。 */
function horizontalCase(): void {
  for (const x of [400, -400]) {
    const points = route(geometryNode('a', 0, 0), geometryNode('b', x, 0));
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => point[1] === 0 && Math.abs(point[0]!) <= 400)).toBe(true);
  }
}
test('横向和反向移动的连线不绕回旧方向', horizontalCase);
/** 核对其他节点挡住路线时绕行，移开后恢复紧凑连线。 */
function obstacleCase(): void {
  const source = geometryNode('a', 0, 0),
    target = geometryNode('b', 0, 400);
  const blocked = route(source, target, [geometryNode('c', 0, 200)]);
  const clear = route(source, target, [geometryNode('c', 500, 200)]);
  expect(blocked.some((point) => Math.abs(point[0]!) >= 150)).toBe(true);
  expect(clear.every((point) => point[0] === 0)).toBe(true);
}
test('避开中间节点，障碍移走后不保留旧弯折', obstacleCase);
/** 核对重绘全部连线且保留审批依赖、样式和元数据，无节点重新排列。 */
async function redrawCase(): Promise<void> {
  const edges: NonNullable<BusinessGraphModel['data']['edges']> = [
    {
      id: 'one',
      source: 'a',
      target: 'b',
      style: { stroke: '#123456', controlPoints: [[0, 800]] },
      data: { protected: true },
    },
    { id: 'two', source: 'c', target: 'd', style: { lineDash: [5, 4], controlPoints: [[400, 800]] } },
  ];
  const before = JSON.stringify(edges);
  let updated: typeof edges = [],
    draws = 0;
  const graph = {
    getEdgeData: () => edges,
    updateEdgeData: (value: typeof edges) => {
      updated = value;
    },
    draw: async () => {
      draws += 1;
    },
  } as unknown as Parameters<typeof refreshRoutedEdges>[0];
  await refreshRoutedEdges(graph);
  expect(updated.map((edge) => edge.id)).toEqual(['one', 'two']);
  for (const edge of updated) expect(edge.style?.controlPoints).toEqual([]);
  expect(updated[0]?.data).toEqual({ protected: true });
  expect(updated[0]?.style?.stroke).toBe('#123456');
  expect(updated[1]?.style?.lineDash).toEqual([5, 4]);
  expect(updated.map((edge) => [edge.source, edge.target])).toEqual([
    ['a', 'b'],
    ['c', 'd'],
  ]);
  expect(JSON.stringify(edges)).toBe(before);
  expect(draws).toBe(1);
}
test('拖动结束重算全部路线，不改变审批依赖、坐标或业务样式', redrawCase);
