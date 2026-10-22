import type {
  Activity,
  ActivityDetail,
  CompanyConfig,
  Department,
  FileRecord,
  Notification,
  SessionProfile,
  WorkflowNode,
} from '@workflow/domain';

export interface ActivityListItem {
  canDelete: boolean;
  restrictedFields?: string[];
  id: string;
  code: string;
  name: string;
  applicant: string;
  applicantName: string;
  department: string;
  status: Activity['status'];
  version: number;
  budget: string;
  startAt: string;
  location: string;
  updatedAt: string;
}
export interface ActivityPage {
  items: ActivityListItem[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ListParams {
  q?: string;
  status?: string;
  scope?: 'all' | 'mine' | 'tasks' | 'archives';
  page?: number;
  pageSize?: number;
}
export interface Directory {
  users: Array<{ id: string; name: string; department: string; canExecute: boolean }>;
  roles: Array<{ id: string; name: string }>;
  departments: Department[];
}
export interface WorkflowPreview {
  templateId?: string;
  templateVersion?: number;
  nodes: WorkflowNode[];
  participants: Array<{ id: string; name: string }>;
  errors: string[];
}
export interface MutationResult {
  id: string;
  version: number;
}
export type { Activity, ActivityDetail, CompanyConfig, FileRecord, Notification, SessionProfile };
