import type { ActivityDetail, FileRecord, WorkflowTask } from '@workflow/domain';
export interface DynamicFormProps {
  schema: ActivityDetail['activity']['schema'];
  modelValue: Record<string, string>;
  disabled?: boolean;
  keys?: string[];
  errors?: string[];
}
export interface SubmissionAttempt {
  id: string;
  version: number;
}
export interface AttachmentProps {
  activityId: string;
  files: FileRecord[];
  stage: FileRecord['stage'];
  canUpload: boolean;
}
export interface ActionProps {
  show: boolean;
  detail: ActivityDetail;
  action: string;
  task?: WorkflowTask;
}
export interface AdjustmentProps {
  show: boolean;
  detail: ActivityDetail;
}
export interface WorkflowViewDetail {
  activity: Pick<ActivityDetail['activity'], 'nodes' | 'tasks'> &
    Partial<Pick<ActivityDetail['activity'], 'status' | 'revision' | 'cancellation'>>;
  participants: ActivityDetail['participants'];
  actions?: string[];
  taskWarnings?: ActivityDetail['taskWarnings'];
}
export const ACTION_LABELS: Record<string, string> = {
  edit: '编辑申请',
  submit: '提交申请',
  withdraw: '撤回申请',
  adjust: '新增流程节点',
  assign: '指派执行人',
  start: '开始执行',
  report: '提交执行汇报',
  'archive-submit': '提交档案',
  'archive-approve': '审核归档',
  'archive-return': '退回档案',
  'cancel-request': '申请取消',
  'cancel-approve': '批准取消',
  'cancel-reject': '拒绝取消',
  'cancel-withdraw': '撤销取消申请',
  export: '导出',
  copy: '复制为新申请',
};
export const NODE_STATUSES: Record<string, string> = {
  waiting: '等待前置节点',
  active: '办理中',
  completed: '已完成',
  invalidated: '已失效',
  skipped: '未命中条件',
};
export const TASK_STATUSES: Record<string, string> = {
  pending: '待办理',
  approved: '已通过',
  completed: '已完成',
  returned: '已退回',
  rejected: '已拒绝',
  cancelled: '已取消',
};
