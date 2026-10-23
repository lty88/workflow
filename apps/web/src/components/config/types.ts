import type { CompanyConfig, Condition, FormField, AssigneeRule } from '@workflow/domain'
export interface ConfigPanelProps {
  modelValue: CompanyConfig
  persist?: (value: CompanyConfig) => Promise<void>
  saving?: boolean
  removeMember?: (id: string) => Promise<void>
  batchMembers?: MemberBatchHandler
}
export interface ConditionProps {
  modelValue?: Condition
  fields: FormField[]
  excluded?: string
  label?: string
}
export interface AssigneeProps {
  modelValue: AssigneeRule
  config: CompanyConfig
}
export interface ConfigSlot {
  config: CompanyConfig
  update: (value: CompanyConfig) => void
  persist: (value: CompanyConfig) => Promise<void>
  saving: boolean
  removeMember: (id: string) => Promise<void>
  batchMembers: MemberBatchHandler
}
export const FIELD_TYPES: Record<FormField['type'], string> = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字',
  select: '单选下拉',
  datetime: '日期时间',
  checkboxes: '多选',
  attachment: '附件上传',
}

export interface OrganizationPresetPreview {
  result: import('@workflow/domain').OrganizationSupplement | null
  error: string
}

export interface MemberDeleteButtonProps {
  member: import('@workflow/domain').Member
  saving?: boolean
  remove?: (id: string) => Promise<void>
}

export type MemberBatchHandler = (action: import('@/typings/api/settings').MemberBatchAction, ids: string[]) => Promise<void>
export interface OrganizationMembersProps {
  config: CompanyConfig
  members: import('@workflow/domain').Member[]
  title: string
  query: string
  saving?: boolean
  removeMember?: (id: string) => Promise<void>
  batchMembers?: MemberBatchHandler
}
export interface MemberBatchActionsProps {
  selected: string[]
  members: import('@workflow/domain').Member[]
  saving?: boolean
  run?: MemberBatchHandler
}

export interface RoleGroupView {
  name: string
  roles: import('@workflow/domain').Role[]
}
