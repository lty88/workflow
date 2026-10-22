import type {
  ActivityType,
  CompanyConfig,
  TemplateDefinition,
  TemplateRelease,
  TemplateSelection,
  TemplateSummary,
  WorkflowTemplate,
} from '@workflow/domain';
export interface TemplateCatalogue {
  items: WorkflowTemplate[];
  types: ActivityType[];
  config: CompanyConfig;
}
export type {
  ActivityType,
  TemplateDefinition,
  TemplateRelease,
  TemplateSelection,
  TemplateSummary,
  WorkflowTemplate,
};
