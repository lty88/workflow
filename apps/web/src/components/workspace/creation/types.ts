export type CreationKind = 'activity' | 'general'
export interface CreationMenuProps {
  appearance?: 'button' | 'shortcut' | 'sidebar' | 'mobile'
  activityPath?: string
  selected?: boolean
  disabled?: boolean
}
