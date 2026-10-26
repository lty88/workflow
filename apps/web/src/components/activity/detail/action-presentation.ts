import type { DetailActionAppearance } from './types'

const ACTION_APPEARANCES: Record<string, DetailActionAppearance> = {
  submit: { type: 'primary', secondary: false },
  assign: { type: 'primary', secondary: false },
  start: { type: 'primary', secondary: false },
  report: { type: 'primary', secondary: false },
  'execution-complete': { type: 'success', secondary: false },
  'archive-submit': { type: 'primary', secondary: false },
  'archive-approve': { type: 'success', secondary: false },
  'cancel-approve': { type: 'error', secondary: true },
  'archive-return': { type: 'warning', secondary: true },
  'cancel-request': { type: 'warning', secondary: true },
  withdraw: { type: 'warning', secondary: true },
  'cancel-withdraw': { type: 'warning', secondary: true },
}

/**
 * 为活动业务操作分配明确的语义颜色，次要操作仍保留实体边框。
 * @param action 服务端授予的业务动作码
 * @returns 按钮颜色与浅色填充配置
 */
export function detailActionAppearance(action: string): DetailActionAppearance {
  return ACTION_APPEARANCES[action] || { type: 'default', secondary: false }
}
