import type { Activity, FileRecord, WorkflowNode } from '@workflow/domain'

/** 选择资料节点，本次申请的退回或终止节点保留，旧申请轮次由历史开关控制。
 * @param activity 已授权的流程节点和当前申请版本
 * @param files 服务端已过滤权限的文件
 * @param includeHistory 是否显示历次申请节点
 * @returns 可展示节点，不扩展任何文件阅读或下载权限
 */
export function materialNodes(activity: Pick<Activity, 'nodes' | 'revision'>, files: FileRecord[], includeHistory = false): WorkflowNode[] {
  return activity.nodes.filter(
    /** 业务子流程另有资料区域，条件跳过的节点仅在有授权文件时保留。
     * @param node 实例节点
     * @returns 是否展示资料区域
     */ function visible(node) {
      if (node.businessStage) return false
      if (!includeHistory && (node.applicationRevision || 1) !== (activity.revision || 1)) return false
      return (
        node.status !== 'skipped' ||
        files.some(
          /** 仅依据服务端返回的授权文件判断，不暴露未授权附件存在性。
           * @param file 已授权文件
           * @returns 是否属于当前节点
           */ function attached(file) {
            return file.stage === 'node' && file.nodeId === node.id && !file.fieldKey
          }
        )
      )
    }
  )
}
