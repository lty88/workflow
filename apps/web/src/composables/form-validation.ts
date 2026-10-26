import type { FormItemRule } from 'naive-ui'

/**
 * 判断必填控件是否为空；零值有效，空白文本和空多选无效。
 * @param value 输入框、选择器或数字控件的当前值
 * @returns 是否缺少必填内容
 */
export function isRequiredEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)
}

/**
 * 创建统一的必填规则，用于输入、选择和数字控件，错误直接展示在字段下方。
 * @param label 字段名称
 * @param selecting 是否为选择控件
 * @returns Naive UI表单必填规则
 */
export function requiredRule(label: string, selecting = false): FormItemRule {
  return {
    required: true,
    trigger: ['input', 'change', 'blur'],
    /** 校验当前字段非空，避免空白文字或空多选绕过必填。
     * @param _rule 当前规则
     * @param value 字段当前值
     * @returns 校验通过标记或可展示错误
     */
    validator(_rule, value) {
      return isRequiredEmpty(value) ? new Error(`${selecting ? '请选择' : '请填写'}${label}`) : true
    },
  }
}
