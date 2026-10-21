import type { GraphData } from '@antv/g6';
import type { SelectOption } from 'naive-ui';
export type GraphNodeKind = 'department' | 'member' | 'workflow' | 'runtime' | 'stage';
export type GraphTone = 'normal' | 'active' | 'success' | 'warning' | 'muted';
export type GraphDirection = 'TB' | 'LR';
export interface GraphLocateOption extends SelectOption {
  label: string;
  value: string;
}
export interface GraphToolbarProps {
  label: string;
  nodeCount: number;
  options: GraphLocateOption[];
  selected: string;
  busy: boolean;
  issue: boolean;
  zoom: number;
  expanded: boolean;
  direction: GraphDirection;
}
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
  direction?: GraphDirection;
  label?: string;
}
export interface GraphNodeMeta {
  businessId: string;
  kind: GraphNodeKind;
  label: string;
  summary: string;
  tone: GraphTone;
}
