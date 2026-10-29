import type { AttachmentScopeSummary, DataAccessRule, FieldAccess, NodeDefinition } from '@workflow/domain'
export interface AccessDirectory {
  users: Array<{ id: string; name: string; active?: boolean }>
  roles: Array<{ id: string; name: string }>
}
export type AccessRuleMode = 'inherit' | 'node_only' | DataAccessRule['mode']
export interface AccessRuleEditorProps {
  modelValue?: DataAccessRule
  fallback?: DataAccessRule
  config: AccessDirectory
  disabled?: boolean
  node?: boolean
  forceNodeAssignees?: boolean
  inherit?: boolean
  inheritLabel?: string
  inheritHint?: string
  label: string
}
export interface NodeAccessEditorProps {
  modelValue: NodeDefinition
  config: AccessDirectory
  disabled?: boolean
}
export interface FieldAccessEditorProps {
  modelValue?: FieldAccess
  config: AccessDirectory
  disabled?: boolean
}
export interface FileUploadAccessProps {
  nodeScope?: AttachmentScopeSummary
  modelValue: import('@workflow/domain').FileAccessInput
  node?: boolean
  disabled?: boolean
}
