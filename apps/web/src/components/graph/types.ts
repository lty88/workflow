import type { GraphData } from '@antv/g6';
export type GraphNodeKind = 'department' | 'member' | 'workflow' | 'runtime' | 'stage';
export type GraphTone = 'normal' | 'active' | 'success' | 'warning' | 'muted';
export interface BusinessGraphModel {
  data: GraphData;
  issue?: string;
}
export interface GraphSelection {
  id: string;
  graphId: string;
  kind: GraphNodeKind;
}
export interface BusinessGraphProps {
  model: BusinessGraphModel;
  selectedKey?: string;
  height?: number;
  direction?: 'TB' | 'LR';
  label?: string;
}
export interface GraphNodeMeta {
  businessId: string;
  kind: GraphNodeKind;
  label: string;
  summary: string;
  tone: GraphTone;
}
