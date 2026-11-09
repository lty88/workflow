import type { ActivityDetail, CollaborationDispatchCommand, CollaborationActionCommand, WorkflowTask } from '@workflow/domain'
export interface CollaborationPanelProps {
  detail: ActivityDetail
  readOnly?: boolean
}
export interface CollaborationDispatchProps extends CollaborationPanelProps {
  show: boolean
  task?: WorkflowTask
}
export interface CollaborationDraft extends Omit<CollaborationDispatchCommand['tasks'][number], 'assignee' | 'dueAt'> {
  key: string
  assignee: string | null
  dueAt: number | null
}
export type CollaborationAction = CollaborationActionCommand['action']
export const COLLABORATION_STATES = { working: '办理中', submitted: '待验收', accepted: '已验收', cancelled: '已撤销' } as const

export interface CollaborationProgressProps {
  detail: import('@/components/activity/types').WorkflowViewDetail
  parentNodeId: string
  includeHistory?: boolean
}
export interface CollaborationProgressState {
  label: string
  tone: 'info' | 'warning' | 'success' | 'default'
}
