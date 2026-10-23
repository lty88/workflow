import type {
  ActivityType,
  CompanyConfig,
  NodeDefinition,
  TemplateDefinition,
  TemplateLayout,
  TemplateRelease,
  TemplateSelection,
  TemplateSummary,
  WorkflowTemplate,
} from '@workflow/domain';
import type { GraphConnection, GraphToolbarControls } from '@/components/graph/types';
export type InsertPosition = 'before' | 'after' | 'parallel';
export interface NodeInspectorHandle {
  draft: () => NodeDefinition | null;
}
export interface EditorHeaderProps {
  name: string;
  code: string;
  version: number;
  revision: number;
  dirty: boolean;
  busy: boolean;
  readonly: boolean;
  expanded: boolean;
  canUndo: boolean;
  canRedo: boolean;
  paletteOpen: boolean;
  inspectorOpen: boolean;
}
export interface EditorPaletteProps {
  nodes: NodeDefinition[];
  selected: string;
  position: InsertPosition;
  collapsed: boolean;
  disabled: boolean;
}
export interface EditorCanvasToolbarProps {
  atStart: boolean;
  canInsert: boolean;
  controls: GraphToolbarControls;
  connectMode: boolean;
  disabled: boolean;
  selectedName: string;
  position: InsertPosition;
  hasEdge: boolean;
  canRemove: boolean;
}
export interface TemplateSettingsProps {
  modelValue: TemplateDefinition;
  config: CompanyConfig;
  types: ActivityType[];
  disabled: boolean;
}
export interface TemplateSelectorProps {
  modelValue: TemplateSelection | null;
  templates: TemplateSummary[];
  types: ActivityType[];
  disabled?: boolean;
}
export interface TemplateLibraryProps {
  items: WorkflowTemplate[];
  types: ActivityType[];
  config: CompanyConfig;
  busy: boolean;
}
export interface TemplateDesignerProps {
  initialExpanded?: boolean;
  errors?: string[];
  modelValue: TemplateDefinition;
  template: WorkflowTemplate;
  config: CompanyConfig;
  types: ActivityType[];
  busy: boolean;
  dirty: boolean;
}
export interface NodeInspectorProps {
  node: NodeDefinition | null;
  nodes: NodeDefinition[];
  config: CompanyConfig;
  disabled: boolean;
}
export interface TemplateCanvasProps {
  canRemove: boolean;
  position: InsertPosition;
  definition: TemplateDefinition;
  config: CompanyConfig;
  selected: string;
  disabled: boolean;
}
export interface TemplateHistoryProps {
  show: boolean;
  versions: TemplateRelease[];
  config: CompanyConfig;
}
export type {
  ActivityType,
  TemplateDefinition,
  TemplateLayout,
  TemplateSelection,
  TemplateSummary,
  WorkflowTemplate,
  GraphConnection,
};

export interface TemplateSystemInspectorProps {
  start: boolean;
  disabled: boolean;
}
export interface TemplateFlowGuideProps {
  nodes: NodeDefinition[];
}
