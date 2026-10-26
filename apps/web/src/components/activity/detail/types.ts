import type { ActivityDetail } from '@/typings/api'

export interface ActivityActionBarProps extends ActivityDetailSectionProps {
  loading: boolean
  historical: boolean
  actions: string[]
}

export interface DetailActionAppearance {
  type: 'primary' | 'default' | 'success' | 'warning' | 'error'
  secondary: boolean
}

export interface ActivityHistoryProps extends ActivityDetailSectionProps {
  section?: 'all' | 'progress' | 'records'
  readOnly?: boolean
}

export interface ActivityDetailSectionProps {
  detail: ActivityDetail
}

export interface ActivityExecutionProps extends ActivityDetailSectionProps {
  readOnly?: boolean
  executionUpload: boolean
  archiveUpload: boolean
}
