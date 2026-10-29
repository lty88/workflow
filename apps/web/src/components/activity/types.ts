import type { ActivityDetail, AttachmentScopeSummary, FileRecord, FormDefinition, FormValidationIssue, WorkflowTask, WorkflowNode } from '@workflow/domain'
import type { ComputedRef, Ref } from 'vue'
export interface DeleteActivityProps {
  activity: Pick<ActivityDetail['activity'], 'id' | 'code' | 'name' | 'version'>
  allowed: boolean
  prominent?: boolean
  disabled?: boolean
}
export interface ActivityTemplateOptions {
  businessType?: ComputedRef<'activity' | 'general'>
  existingDetail?: ComputedRef<ActivityDetail | null>
  payload: Ref<Record<string, string>>
  fallbackForm: ComputedRef<FormDefinition>
  invalidatePreview: () => void
}
export interface DynamicFormProps {
  schema: ActivityDetail['activity']['schema']
  modelValue: Record<string, string>
  disabled?: boolean
  keys?: string[]
  errors?: string[]
  issues?: FormValidationIssue[]
  activityId?: string
  files?: FileRecord[]
  prepareUpload?: () => Promise<string>
  refreshFiles?: () => Promise<void>
}
export interface FormAttachmentProps {
  field: import('@workflow/domain').FormField
  modelValue: string
  files?: FileRecord[]
  activityId?: string
  disabled?: boolean
  prepareUpload?: () => Promise<string>
  refreshFiles?: () => Promise<void>
}
export interface ActivityStepOptions {
  schema: ComputedRef<FormDefinition>
  payload: Ref<Record<string, string>>
  hasTemplate: ComputedRef<boolean>
  disabled: ComputedRef<boolean>
}
export interface ActivityStepValidation {
  step: number
  errors: string[]
  issues: FormValidationIssue[]
}
export interface SubmissionAttempt {
  templateVersion?: number
  id: string
  version: number
}
export interface BusinessFormAttachmentProps {
  detail: ActivityDetail
  contextId: string
  actionKey: string
  stage: FileRecord['stage']
  nodeId?: string
  disabled?: boolean
}
export interface ExecutionReportFormProps {
  completion?: boolean
}
export interface AttachmentUploadPromptProps {
  busy?: boolean
  disabled?: boolean
  description: string
  limitLabel: string
}
export interface AttachmentProps {
  nodeScope?: AttachmentScopeSummary
  contextId?: string
  actionKey?: string
  includeContexts?: boolean
  prepareUpload?: () => Promise<string>
  refreshFiles?: () => Promise<void>
  nodeId?: string
  activityVersion?: number
  activityId: string
  files: FileRecord[]
  stage: FileRecord['stage']
  canUpload: boolean
}
export interface ActionProps {
  show: boolean
  detail: ActivityDetail
  action: string
  task?: WorkflowTask
}
export interface AdjustmentProps {
  show: boolean
  detail: ActivityDetail
}
export interface WorkflowViewDetail {
  activity: Pick<ActivityDetail['activity'], 'nodes' | 'tasks'> &
    Partial<Pick<ActivityDetail['activity'], 'status' | 'revision' | 'cancellation' | 'applicant' | 'executor' | 'archive' | 'workflowOwnerId' | 'lifecycle'>>
  participants: ActivityDetail['participants']
  actions?: string[]
  taskWarnings?: ActivityDetail['taskWarnings']
}
export const ACTION_LABELS: Record<string, string> = {
  edit: '编辑申请',
  submit: '提交申请',
  withdraw: '撤回申请',
  adjust: '新增流程节点',
  assign: '指派执行人',
  start: '开始执行',
  report: '新增执行记录',
  'execution-complete': '完成执行并提交归档',
  'archive-submit': '提交档案',
  'archive-approve': '审核归档',
  'archive-return': '退回档案',
  'cancel-request': '申请取消',
  'cancel-approve': '批准取消',
  'cancel-reject': '拒绝取消',
  'cancel-withdraw': '撤销取消申请',
  export: '导出',
  copy: '复制为新申请',
}
export const NODE_STATUSES: Record<string, string> = {
  waiting: '等待前置节点',
  active: '办理中',
  completed: '已完成',
  invalidated: '已失效',
  returned: '已退回修改',
  rejected: '已终止申请',
  skipped: '未命中条件',
  reworking: '待重新办理',
  terminated: '因申请终止而取消',
}
export const TASK_STATUSES: Record<string, string> = {
  pending: '待办理',
  approved: '已通过',
  completed: '已完成',
  returned: '已退回修改',
  rejected: '已终止申请',
  cancelled: '已取消',
}

export interface FileAccessDialogProps {
  show: boolean
  file: FileRecord | null
  activityVersion: number
}

export type NodeProgressStatus = WorkflowNode['status'] | 'returned' | 'rejected' | 'reworking' | 'terminated'
export interface WorkflowProgressNode extends WorkflowNode {
  displayStatus: NodeProgressStatus
}

export interface ApprovalDecisionFieldsProps {
  detail: ActivityDetail
  task: WorkflowTask
  capabilities?: import('@workflow/domain').DecisionCapabilities
  opinion: string
  scores: Record<string, number | null>
  required: boolean
}
export interface ApprovalReturnDialogProps {
  show: boolean
  decision: 'return' | 'reject'
  detail: ActivityDetail
  capabilities?: import('@workflow/domain').DecisionCapabilities
  opinion: string
  busy: boolean
}
export interface NegativeDecisionInput {
  decision: 'return' | 'reject'
  publicComment: string
  returnTargetId?: string
  expectedTargetGeneration?: number
}
