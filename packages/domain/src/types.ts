export type Permission =
  | 'activity:read'
  | 'activity:create'
  | 'activity:submit'
  | 'activity:export'
  | 'activity:sensitive:read'
  | 'activity:sensitive:export'
  | 'file:download'
  | 'approval:decide'
  | 'task:complete'
  | 'workflow:adjust'
  | 'activity:assign'
  | 'execution:report'
  | 'archive:review'
  | 'config:manage'
  | 'evaluation:read'
  | 'evaluation:manage'
  | 'dashboard:read'
  | 'activity:delete'
  | 'activity:delete:any';
export type Scope = 'self' | 'department' | 'department_tree' | 'tasks' | 'all';
export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'datetime' | 'checkboxes' | 'attachment';
export interface Condition {
  field: string;
  operator: 'eq' | 'neq' | 'gte';
  value: string;
}
export interface DataAccessRule {
  mode: 'shared' | 'restricted';
  roleIds: string[];
  userIds: string[];
  applicant?: boolean;
  executor?: boolean;
  departmentManager?: boolean;
  nodeAssignees?: boolean;
}
export interface FieldAccess {
  read: DataAccessRule;
  write?: DataAccessRule;
  mask: 'hidden' | 'partial';
}
export interface ActivityAccess {
  readableNodeIds: string[];
  uploadNodeIds: string[];
  hiddenFieldKeys: string[];
  containsSensitive: boolean;
}
export interface AttachmentOptions {
  maxCount: number;
  maxSizeMB: number;
  extensions: string[];
}
export interface FileAccessInput {
  contextId?: string;
  actionKey?: string;
  fieldKey?: string;
  nodeId?: string;
  access?: DataAccessRule;
  downloadAccess?: DataAccessRule;
}
export interface FormField {
  upload?: AttachmentOptions;
  accessConstraints?: FieldAccess[];
  access?: FieldAccess;
  readOnly?: boolean;
  redacted?: boolean;
  id: string;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  default: string;
  options: string[];
  visible?: Condition;
  system?: boolean;
}
export interface FormValidationIssue {
  key: string;
  message: string;
}
export interface FormValidationResult {
  errors: string[];
  issues: FormValidationIssue[];
  payload: Record<string, string>;
}
export interface FormDefinition {
  businessType?: 'activity' | 'general';
  id: string;
  name: string;
  fields: FormField[];
}
export interface Department {
  id: string;
  name: string;
  parent: string;
  manager: string;
  active: boolean;
}
export interface Member {
  id: string;
  name: string;
  username: string;
  department: string;
  roles: string[];
  active: boolean;
}
export interface Role {
  id: string;
  name: string;
  permissions: Permission[];
  scope: Scope;
  pages: string[];
}
export type PageComponent =
  | 'summary'
  | 'activity_list'
  | 'activity_form'
  | 'task_list'
  | 'archive_list'
  | 'config_overview'
  | 'leadership_dashboard';
export interface MenuGroup {
  id: string;
  name: string;
  active: boolean;
}
export interface PageDefinition {
  id: string;
  name: string;
  group: string;
  component: PageComponent;
  formId?: string;
  active: boolean;
}
export interface AssigneeRule {
  type: 'manager' | 'department_manager' | 'role' | 'user';
  value: string;
}
export interface NodeApprovalPolicy {
  returnEnabled: boolean;
  returnScope: 'previous' | 'selected';
  returnNodeIds: string[];
  returnToApplicant: boolean;
  allowTerminate: boolean;
  rating: 'off' | 'optional' | 'required';
}
export interface NodeRating {
  nodeId: string;
  generation: number;
  score: number;
}
export interface DecisionTarget {
  nodeId: string;
  label: string;
  generation: number;
  affectedNodeIds: string[];
}
export interface DecisionCapabilities {
  canReturnToApplicant: boolean;
  canTerminate: boolean;
  returnTargets: DecisionTarget[];
  ratingRequirement: NodeApprovalPolicy['rating'];
  ratingTargets: DecisionTarget[];
}
export interface LifecycleDefinition {
  businessType: 'activity' | 'general';
  afterApproval: 'complete' | 'activity_standard';
  version: 1;
}
export type BusinessStage = 'assign' | 'execution' | 'archive_submit' | 'archive_review';
export interface NodeDefinition {
  approvalPolicy?: NodeApprovalPolicy;
  access?: DataAccessRule;
  downloadAccess?: DataAccessRule;
  id: string;
  label: string;
  kind: 'approval' | 'task' | 'notice';
  deps: string[];
  assignee: AssigneeRule;
  condition?: Condition;
  protected?: boolean;
}
export interface CompanyConfig {
  version: number;
  departments: Department[];
  users: Member[];
  roles: Role[];
  groups: MenuGroup[];
  pages: PageDefinition[];
  form: FormDefinition;
  workflow: { name: string; nodes: NodeDefinition[]; ratingEnabled?: boolean; lifecycle?: LifecycleDefinition };
}
export interface ConfigState {
  draft: CompanyConfig;
  published: CompanyConfig;
  revision: number;
  draftRevision: number;
}
export type ActivityStatus =
  | 'draft'
  | 'approving'
  | 'needs_info'
  | 'withdrawn'
  | 'rejected'
  | 'ready_assign'
  | 'ready_execute'
  | 'executing'
  | 'archive_draft'
  | 'archive_review'
  | 'completed'
  | 'archived'
  | 'cancel_review'
  | 'cancelled';
export type NodeStatus = 'waiting' | 'active' | 'completed' | 'invalidated' | 'skipped';
export interface WorkflowNode {
  businessStage?: BusinessStage;
  approvalPolicy?: NodeApprovalPolicy;
  rework?: { fromNodeId: string; targetNodeId: string; returnTaskId: string; at: string };
  access?: DataAccessRule;
  downloadAccess?: DataAccessRule;
  origin?: 'template' | 'instance' | 'business';
  id: string;
  key: string;
  label: string;
  kind: NodeDefinition['kind'];
  deps: string[];
  assigneeRule: AssigneeRule;
  assignees: string[];
  status: NodeStatus;
  generation: number;
  applicationRevision?: number;
}
export interface WorkflowTask {
  ratings?: NodeRating[];
  returnTargetId?: string;
  returnAffectedNodeIds?: string[];
  publicComment?: string;
  id: string;
  activityId: string;
  nodeId: string;
  assignee: string;
  generation: number;
  status: 'pending' | 'approved' | 'completed' | 'returned' | 'rejected' | 'cancelled';
  version: number;
  comment: string;
  actedAt?: string;
  delegated?: boolean;
  createdAt?: string;
}
export interface ExecutionReport {
  title?: string;
  start: string;
  end: string;
  people: number;
  summary: string;
  spend: string;
  exception: string;
}
export interface ExecutionRecord extends ExecutionReport {
  id: string;
  authorId: string;
  authorName: string;
  submittedAt: string;
}
export interface ArchiveRecord {
  version: number;
  summary: string;
  url: string;
  submittedBy: string;
  reviewer: string;
  comment: string;
  code?: string;
}
export interface Cancellation {
  previous: ActivityStatus;
  requester: string;
  reviewer: string;
  reason: string;
  disposal: string;
}
export interface ApplicationRevision {
  lifecycle?: LifecycleDefinition;
  activityTypeId?: string;
  templateId?: string;
  templateVersion?: number;
  templateName?: string;
  definitionHash?: string;
  revision: number;
  schema: FormDefinition;
  payload: Record<string, string>;
  workflow: NodeDefinition[];
  configVersion: number;
  submittedAt: string;
}
export interface AuditEvent {
  publicNote?: string;
  attachmentContextId?: string;
  nodeId?: string;
  fileId?: string;
  id: string;
  actor: string;
  actorName: string;
  action: string;
  note: string;
  createdAt: string;
}
/** 通用申请运行模型；活动专属字段由存储适配器填充，旧接口保留兼容。 */
export interface Activity {
  lifecycle?: LifecycleDefinition;
  completedAt?: string;
  lastApprovalTaskId?: string;
  workflowOwnerId?: string;
  workflowOwnerNodeId?: string;
  applicantName?: string;
  deleted?: { at: string; by: string; reason: string };
  activityTypeId?: string;
  templateId?: string;
  templateVersion?: number;
  templateName?: string;
  id: string;
  code: string;
  applicant: string;
  department: string;
  name: string;
  status: ActivityStatus;
  version: number;
  structureRevision: number;
  revision: number;
  configVersion: number;
  schema: FormDefinition;
  payload: Record<string, string>;
  snapshots: ApplicationRevision[];
  nodes: WorkflowNode[];
  tasks: WorkflowTask[];
  audit: AuditEvent[];
  executor: string;
  assignment: string;
  actualStart: string;
  report: ExecutionReport | null;
  executionRecords?: ExecutionRecord[];
  executionCompletedAt?: string;
  archive: ArchiveRecord | null;
  archives: ArchiveRecord[];
  cancellation: Cancellation | null;
  createdAt: string;
  updatedAt: string;
}
export interface FileRecord extends FileAccessInput {
  uploaderId?: string;
  canManageAccess?: boolean;
  canDownload?: boolean;
  canPreview?: boolean;
  id: string;
  activityId: string;
  name: string;
  size: number;
  mime: string;
  stage: 'application' | 'execution' | 'archive' | 'node' | 'operation';
  createdAt: string;
}
export interface ActivityDetail {
  decisionCapabilities?: Record<string, DecisionCapabilities>;
  access?: ActivityAccess;
  activity: Activity;
  files: FileRecord[];
  actions: string[];
  participants: Array<{ id: string; name: string }>;
  taskWarnings: Array<{ taskId: string; message: string }>;
}
export interface SessionProfile {
  user: Member;
  permissions: Permission[];
  menus: PageDefinition[];
  groups: MenuGroup[];
  form: FormDefinition;
  configVersion: number;
  csrfToken: string;
}
export interface Notification {
  id: string;
  title: string;
  activityId: string;
  readAt: string | null;
  createdAt: string;
}
export interface ApiErrorBody {
  error: { code: string; message: string; details?: string[] };
}
export interface Adjustment {
  attachmentContextId?: string;
  name: string;
  kind: NodeDefinition['kind'];
  assignee: AssigneeRule;
  anchor: string;
  position: 'before' | 'after' | 'parallel';
  reason: string;
  expectedStructureRevision: number;
  idempotencyKey: string;
}
