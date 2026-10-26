import type { FileAccessInput } from '@workflow/domain'

/**
 * 在浏览器检查指定授权是否选择至少一类受众，引用有效性仍由服务端核验。
 * @param input 当前文件或新上传文件的查看、下载配置
 * @returns 待补充的必选受众提示
 */
export function fileAccessRequiredErrors(input: FileAccessInput): string[] {
  const errors: string[] = []
  for (const key of ['access', 'downloadAccess'] as const) {
    const rule = input[key]
    if (
      rule?.mode === 'restricted' &&
      !rule.roleIds.length &&
      !rule.userIds.length &&
      !rule.applicant &&
      !rule.executor &&
      !rule.departmentManager &&
      !rule.nodeAssignees
    )
      errors.push(`请为${key === 'access' ? '查看' : '下载'}范围选择至少一类授权人员`)
  }
  return errors
}
