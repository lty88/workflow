import type { DataAccessRule } from '@workflow/domain'
import type { AccessRuleMode } from './types'

/** 将已有授权映射为直观选项，兼容旧版仅节点受理人的指定授权。
 * @param rule 实际生效的授权规则
 * @param node 是否为节点附件或节点默认规则
 * @returns 共享、仅本节点或指定人员角色选项
 */
export function accessRuleMode(rule: DataAccessRule, node = false): AccessRuleMode {
  if (
    node &&
    rule.mode === 'restricted' &&
    rule.nodeAssignees &&
    !rule.roleIds.length &&
    !rule.userIds.length &&
    !rule.applicant &&
    !rule.executor &&
    !rule.departmentManager
  )
    return 'node_only'
  return rule.mode
}
