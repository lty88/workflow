import { nextTick, ref } from 'vue'
import type { FormInst } from 'naive-ui'

/**
 * 管理必填表单实例，提交前等待条件字段渲染并校验，校验失败时保留表单与字段提示。
 * @returns 表单引用、提交前校验及清理提示的方法
 */
export function useFormValidation() {
  const formRef = ref<FormInst | null>(null)
  const validating = ref(false)
  /** 等待条件字段更新后执行校验，未挂载或有错误时阻止接口请求。
   * @returns 当前表单是否校验通过
   */
  async function validate(): Promise<boolean> {
    if (validating.value) return false
    validating.value = true
    try {
      await nextTick()
      if (!formRef.value) return false
      await formRef.value.validate()
      return true
    } catch {
      return false
    } finally {
      validating.value = false
    }
  }
  /** 清除上次校验提示，在重新打开表单时使用。 */
  function resetValidation(): void {
    formRef.value?.restoreValidation()
  }
  return { formRef, validate, resetValidation }
}
