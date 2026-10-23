import type { CompanyConfig } from '@workflow/domain'
export type SettingsModule = 'organization' | 'permissions' | 'menus' | 'forms'
export type SettingsChanges = Partial<Pick<CompanyConfig, 'departments' | 'users' | 'roles' | 'groups' | 'pages' | 'form'>>

export type MemberBatchAction = 'delete' | 'enable' | 'disable'
