export type Permission =
  | 'activity:read'
  | 'activity:create'
  | 'activity:submit'
  | 'activity:export'
  | 'approval:decide'
  | 'task:complete'
  | 'workflow:adjust'
  | 'activity:assign'
  | 'execution:report'
  | 'archive:review'
  | 'config:manage';
export type Scope = 'self' | 'department' | 'department_tree' | 'tasks' | 'all';
export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'datetime' | 'checkboxes';
export interface Condition {
  field: string;
  operator: 'eq' | 'neq' | 'gte';
  value: string;
}
export interface FormField {
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
export interface FormDefinition {
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
  'summary' | 'activity_list' | 'activity_form' | 'task_list' | 'archive_list' | 'config_overview';
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
  type: 'manager' | 'role' | 'user';
  value: string;
}
export interface NodeDefinition {
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
  workflow: { name: string; nodes: NodeDefinition[] };
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
  | 'archived'
  | 'cancel_review'
  | 'cancelled';
export type NodeStatus = 'waiting' | 'active' | 'completed' | 'invalidated' | 'skipped';
export interface WorkflowNode {
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
  start: string;
  end: string;
  people: number;
  summary: string;
  spend: string;
  exception: string;
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
  revision: number;
  schema: FormDefinition;
  payload: Record<string, string>;
  workflow: NodeDefinition[];
  configVersion: number;
  submittedAt: string;
}
export interface AuditEvent {
  id: string;
  actor: string;
  actorName: string;
  action: string;
  note: string;
  createdAt: string;
}
export interface Activity {
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
  archive: ArchiveRecord | null;
  archives: ArchiveRecord[];
  cancellation: Cancellation | null;
  createdAt: string;
  updatedAt: string;
}
export interface FileRecord {
  id: string;
  activityId: string;
  name: string;
  size: number;
  mime: string;
  stage: 'application' | 'execution' | 'archive';
  createdAt: string;
}
export interface ActivityDetail {
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
  name: string;
  kind: NodeDefinition['kind'];
  assignee: AssigneeRule;
  anchor: string;
  position: 'before' | 'after' | 'parallel';
  reason: string;
  expectedStructureRevision: number;
  idempotencyKey: string;
}
