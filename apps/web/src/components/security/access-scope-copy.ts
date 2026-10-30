import type { AccessOperation, AccessRuleMode, AccessScopeCopy } from './types'

/** 生成权限悬浮提示的精简受众与场景说明，不改变授权规则。
 * @param mode 共享、本节点、指定受众或默认模式
 * @param node 是否为节点资料
 * @param operation 查看、下载或编辑操作
 * @param inheritedScope 服务端解析的实际默认范围
 * @returns 简短选项名称和按需展示的受众、适用场景
 */
export function accessScopeCopy(mode: AccessRuleMode, node = false, operation: AccessOperation = 'view', inheritedScope?: string): AccessScopeCopy {
  const verb = operation === 'download' ? '下载' : operation === 'edit' ? '编辑' : '查看'
  if (mode === 'inherit') {
    const actual = inheritedScope === '流程内共享' ? 'shared' : inheritedScope === '仅本节点办理人' ? 'node_only' : inheritedScope === '指定人员或角色' ? 'restricted' : undefined
    if (!actual) return { title: '沿用默认', audience: '刷新详情后可确认实际范围。', scenario: '不为当前文件另设权限。' }
    const copy = accessScopeCopy(actual, node, operation)
    return { ...copy, title: `默认：${inheritedScope}`, audience: actual === 'restricted' ? '沿用申请中已保存的指定受众。' : copy.audience }
  }
  if (mode === 'node_only') return {
    title: '仅本节点办理人',
    audience: `单人节点仅该办理人可${verb}；多人会签仅本节点有效成员。后续节点不会自动获得权限。`,
    scenario: '本节点敏感材料留存、会签内部核对。',
  }
  if (mode === 'restricted') return {
    title: '指定人员或角色',
    audience: `命中下方任意授权项即可${verb}，仍需有申请访问权限。${node ? '勾选本节点办理人时包含会签成员。' : ''}`,
    scenario: '财务明细、个人资料等定向共享。',
  }
  return {
    title: operation === 'edit' ? '申请内共享' : '流程内共享',
    audience: operation === 'edit' ? '有申请访问、编辑资格及字段阅读权限的人员可编辑。' : `有权查看本申请${operation === 'download' ? '且具备下载权限' : ''}的人员可${verb}，包括后续审批人。`,
    scenario: '正常流转的方案、审批依据和任务成果。',
  }
}
