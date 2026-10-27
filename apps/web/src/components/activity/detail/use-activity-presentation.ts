import { computed } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { visibleFields } from '@workflow/domain'
import type { FormField } from '@workflow/domain'
import type { ActivityDetail } from '@/typings/api'
import { formatMoney, formatTime } from '@/composables/format'
import { participantName as nameFor } from './presentation'

/**
 * 根据当前或历史申请快照生成只读展示数据，保留字段脱敏与预算受限提示。
 * @param detail 服务端按当前权限裁剪后的活动详情
 * @param revision 当前选择的申请版本
 * @returns 申请字段分组、预算、版本选项、当前负责人和展示文本能力
 */
export function useActivityPresentation(detail: ComputedRef<ActivityDetail>, revision: Ref<string>) {
  const STATUS_TONE: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
    draft: 'default',
    approving: 'info',
    needs_info: 'warning',
    withdrawn: 'default',
    rejected: 'error',
    ready_assign: 'info',
    ready_execute: 'info',
    executing: 'success',
    archive_draft: 'warning',
    archive_review: 'info',
    archived: 'success',
    cancel_review: 'warning',
    cancelled: 'default',
  }
  const statusTone = computed(() => STATUS_TONE[detail.value?.activity.status ?? 'draft'] ?? 'default')
  /**
   * 计算当前查看的申请数据：当前内容或指定历史快照。
   * @returns 表单定义、填写数据与是否历史快照
   */
  const viewData = computed(() => {
    const item = detail.value?.activity
    if (!item) return null
    if (revision.value !== 'current') {
      const snapshot = item.snapshots.find((entry) => String(entry.revision) === revision.value)
      if (snapshot) return { schema: snapshot.schema, payload: snapshot.payload, old: true }
    }
    return { schema: item.schema, payload: item.payload, old: false }
  })
  const isOld = computed(() => viewData.value?.old ?? false)
  const templateLabel = computed(() => {
    const item = detail.value?.activity
    if (!item) return ''
    if (revision.value !== 'current')
      for (const snapshot of item.snapshots)
        if (String(snapshot.revision) === revision.value)
          return snapshot.templateName ? `流程模板：${snapshot.templateName} · V${snapshot.templateVersion}` : '历史流程快照'
    return item.templateName ? `流程模板：${item.templateName} · V${item.templateVersion}` : '历史流程快照'
  })
  const fields = computed(() => (viewData.value ? visibleFields(viewData.value.schema, viewData.value.payload) : []))
  /**
   * 判断动态字段是否为金额字段，金额进入费用预算表展示。
   * @param field 字段定义
   * @returns 是否金额字段
   */
  function isMoneyField(field: FormField): boolean {
    return field.key === 'budget' || field.key.endsWith('_fee')
  }
  const moneyFields = computed(() => fields.value.filter(isMoneyField))
  const infoFields = computed(() => fields.value.filter((field) => !isMoneyField(field) && field.type !== 'textarea' && field.type !== 'attachment'))
  const attachmentFields = computed(() =>
    fields.value.filter(
      /** 将附件控件从普通文本中单独分组展示。
       * @param field 当前字段
       * @returns 是否附件控件
       */ function attachment(field) {
        return field.type === 'attachment'
      }
    )
  )
  const textFields = computed(() => fields.value.filter((field) => field.type === 'textarea'))
  const budgetRestricted = computed(() => {
    if (revision.value === 'current' && detail.value?.access?.hiddenFieldKeys.includes('budget')) return true
    for (const field of viewData.value?.schema.fields || []) if (field.key === 'budget') return !!field.redacted
    return true
  })
  const budgetTotal = computed(() =>
    moneyFields.value.reduce((total, field) => {
      const amount = Number(viewData.value?.payload[field.key])
      return Number.isFinite(amount) ? total + amount : total
    }, 0)
  )
  const revisionOptions = computed(() => [
    { label: '当前申请内容', value: 'current' },
    ...(detail.value?.activity.snapshots || []).map((snapshot) => ({
      label: '申请 V' + snapshot.revision + ' · ' + formatTime(snapshot.submittedAt),
      value: String(snapshot.revision),
    })),
  ])
  const nextHint = computed(() => {
    const item = detail.value?.activity
    if (!item) return null
    if (item.status === 'approving') {
      const nodes = item.nodes.filter((node) => node.status === 'active')
      const owners = [...new Set(nodes.flatMap((node) => node.assignees))].map((id) => nameFor(detail.value, id)).join('、')
      return {
        owner: owners || '—',
        text: nodes.length ? '等待' + nodes.map((node) => node.label).join('、') + '办理' : '等待流程办理',
      }
    }
    const hints: Record<string, { owner: string; text: string }> = {
      draft: { owner: nameFor(detail.value, item.applicant), text: '填写资料并提交申请' },
      needs_info: { owner: nameFor(detail.value, item.applicant), text: '按退回意见补充后重新提交' },
      withdrawn: { owner: nameFor(detail.value, item.applicant), text: '修改后可重新提交' },
      cancel_review: { owner: item.cancellation ? nameFor(detail.value, item.cancellation.reviewer) : '—', text: '取消审批处理中，执行操作已冻结' },
      ready_assign: {
        owner: nameFor(detail.value, item.workflowOwnerId || ''),
        text: item.workflowOwnerId ? '由最后审批人指派执行人，并负责后续归档审核' : '无审批节点，由流程协调人指派执行人',
      },
      ready_execute: { owner: nameFor(detail.value, item.executor), text: '按计划时间开始执行' },
      executing: { owner: nameFor(detail.value, item.executor), text: '持续记录执行进展，全部结束后确认完成' },
      archive_draft: { owner: nameFor(detail.value, item.executor), text: '由执行人补齐成果材料并提交归档审核' },
      archive_review: {
        owner: item.archive ? nameFor(detail.value, item.archive.reviewer) : '—',
        text: '核查执行结果与成果后归档',
      },
      archived: { owner: '—', text: '活动闭环完成，档案只读' },
      rejected: { owner: '—', text: '查看终止原因，可复制为新申请' },
      cancelled: { owner: '—', text: '活动已取消，可复制为新申请' },
    }
    return hints[item.status] || { owner: '—', text: '查看办理记录' }
  })

  /**
   * 按字段类型格式化展示值。
   * @param field 字段定义
   * @returns 展示文本
   */
  function displayValue(field: FormField): string {
    const raw = viewData.value?.payload[field.key]
    if (field.redacted) return raw || '权限受限'
    if (isMoneyField(field)) return formatMoney(raw)
    if (field.type === 'datetime') return formatTime(raw)
    return raw || '未填写'
  }

  return {
    statusTone,
    viewData,
    isOld,
    templateLabel,
    infoFields,
    textFields,
    attachmentFields,
    moneyFields,
    budgetRestricted,
    budgetTotal,
    revisionOptions,
    nextHint,
    displayValue,
  }
}
