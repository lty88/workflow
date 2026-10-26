import { attachmentIds, attachmentOptions } from './attachments';
import type {
  Condition,
  FormDefinition,
  FormField,
  FormValidationIssue,
  FormValidationResult,
} from './types';

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
export const BUDGET_EXPENSE_KEYS = ['expert_fee', 'conference_fee', 'travel_fee'] as const;

/**
 * 按十进制拆分把非负元金额转换为整数分，取消业务金额上限并保留安全整数精度。
 * @param value 输入值
 * @returns 整数分或 NaN
 */
export function amountFen(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!AMOUNT_PATTERN.test(text)) return NaN;
  const [yuan, decimal = ''] = text.split('.');
  const n = Number(yuan) * 100 + Number(decimal.padEnd(2, '0'));
  return Number.isSafeInteger(n) ? n : NaN;
}

/**
 * 将安全整数分格式化为固定两位小数的元金额，避免大金额除法或浮点舍入丢失分位。
 * @param value 非负整数分
 * @returns 两位小数金额，无效或超出精确范围时返回空字符串
 */
export function formatAmountFen(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return '';
  const digits = String(value).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/**
 * 判断表单是否具备完整且可读取的费用明细与预算字段，供前后端统一启用自动合计。
 * @param form 当前动态表单定义
 * @returns 是否可以从三项费用自动计算预算
 */
export function hasBudgetBreakdown(form: FormDefinition): boolean {
  const keys = new Set<string>();
  for (const field of form.fields) if (field.type === 'number' && !field.redacted) keys.add(field.key);
  return (
    keys.has('budget') &&
    BUDGET_EXPENSE_KEYS.every(
      /**
       * 确认每一项费用字段都可参与合计。
       * @param key 费用字段键
       * @returns 是否存在对应数字字段
       */
      (key) => keys.has(key),
    )
  );
}

/**
 * 用整数分汇总活动三项预算，未填写的明细暂按零展示，必填校验仍由明细字段承担。
 * @param input 包含专家费、会务费与差旅费的表单输入
 * @returns 精确的两位小数总额，明细无效或合计超出安全精度时返回空字符串
 */
export function budgetTotal(input: Record<string, string>): string {
  let total = 0;
  for (const key of BUDGET_EXPENSE_KEYS) {
    const text = (input[key] ?? '').trim();
    total += text ? amountFen(text) : 0;
    if (!Number.isSafeInteger(total)) return '';
  }
  return formatAmountFen(total);
}

/**
 * 执行受控条件比较。
 * @param condition 条件规则
 * @param payload 字段数据
 * @returns 是否命中
 */
export function matches(condition: Condition | undefined, payload: Record<string, string>): boolean {
  if (!condition) return true;
  const value = payload[condition.field] ?? '';
  if (condition.operator === 'gte') {
    const a = amountFen(value);
    const b = amountFen(condition.value);
    return Number.isFinite(a) && Number.isFinite(b) && a >= b;
  }
  return condition.operator === 'neq' ? value !== condition.value : value === condition.value;
}

/**
 * 获取字段输入，保留用户显式填写的空值。
 * @param field 字段定义
 * @param payload 用户输入
 * @returns 输入或默认值
 */
export function fieldValue(field: FormField, payload: Record<string, string>): string {
  return Object.hasOwn(payload, field.key)
    ? payload[field.key]!
    : field.type === 'attachment'
      ? ''
      : field.default;
}

/**
 * 生成表单默认值，前端新建时显式应用。
 * @param form 表单定义
 * @returns 默认输入对象
 */
export function defaultValues(form: FormDefinition): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const field of form.fields) payload[field.key] = field.type === 'attachment' ? '' : field.default;
  return payload;
}

/**
 * 根据显隐依赖计算可见字段，隐藏的上游不能激活下游。
 * @param form 表单定义
 * @param payload 实际输入
 * @returns 可见字段集合
 */
export function visibleFields(form: FormDefinition, payload: Record<string, string>): FormField[] {
  const visible = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const field of form.fields)
      if (
        !visible.has(field.key) &&
        (!field.visible || (visible.has(field.visible.field) && matches(field.visible, payload)))
      ) {
        visible.add(field.key);
        changed = true;
      }
  }
  const result: FormField[] = [];
  for (const field of form.fields) if (visible.has(field.key)) result.push(field);
  return result;
}

/**
 * 按显隐关系校验动态表单与时间先后，统一计算预算，支持已开始活动及补录并剔除未知输入。
 * @param form 表单定义
 * @param input 提交输入
 * @param keys 可选的待校验字段键，省略时完整校验
 * @returns 错误摘要、字段错误及净化后的完整可见数据
 */
export function validateForm(
  form: FormDefinition,
  input: Record<string, string>,
  keys?: string[],
): FormValidationResult {
  const errors: string[] = [];
  const issues: FormValidationIssue[] = [];
  const selected = keys ? new Set(keys) : null;
  /**
   * 仅为当前校验范围记录错误，同时保留字段键用于准确显示和定位。
   * @param key 错误对应的字段键
   * @param message 对用户展示的中文说明
   */
  function report(key: string, message: string): void {
    if (selected && !selected.has(key)) return;
    errors.push(message);
    issues.push({ key, message });
  }
  const payload: Record<string, string> = {};
  input = { ...input };
  const autoBudget = hasBudgetBreakdown(form);
  if (autoBudget) input.budget = budgetTotal(input);
  for (const field of visibleFields(form, input)) {
    const value = (input[field.key] ?? '').trim();
    payload[field.key] = value;
    if (field.type === 'attachment') {
      const ids = attachmentIds(value);
      if (ids === null) report(field.key, `${field.label}附件数据格式无效`);
      else if (field.required && !ids.length) report(field.key, `${field.label}为必填项，请上传附件`);
      else if (ids.length > attachmentOptions(field).maxCount)
        report(field.key, `${field.label}最多上传${attachmentOptions(field).maxCount}个文件`);
      payload[field.key] = ids?.length ? JSON.stringify(ids) : '';
      continue;
    }
    if (autoBudget && field.key === 'budget' && !value) {
      // 明细格式错误由对应字段提示，仅在有效明细合计溢出时提示预算，避免级联报必填。
      const validDetails = BUDGET_EXPENSE_KEYS.every(
        /**
         * 区分明细格式错误和总额超出精确计算范围。
         * @param key 费用字段键
         * @returns 是否为空或有效金额
         */
        (key) => !input[key]?.trim() || Number.isFinite(amountFen(input[key])),
      );
      if (validDetails) report(field.key, '预算合计超出系统可精确处理的金额范围，请调整费用明细');
      continue;
    }
    if (field.required && !value) {
      report(field.key, `${field.label}为必填项`);
      continue;
    }
    if (!value) continue;
    if (field.type === 'number' && !Number.isFinite(amountFen(value)))
      report(
        field.key,
        AMOUNT_PATTERN.test(value)
          ? `${field.label}超出系统可精确处理的数字范围，请减小金额`
          : `${field.label}需为非负数字，最多两位小数`,
      );
    if (field.type === 'select' && !field.options.includes(value))
      report(field.key, `${field.label}请选择有效选项`);
    if (field.type === 'datetime' && !Number.isFinite(Date.parse(value)))
      report(field.key, `${field.label}时间无效`);
    if (field.type === 'checkboxes') {
      const selected = value.split('、');
      for (const option of selected)
        if (!field.options.includes(option)) report(field.key, `${field.label}包含无效选项`);
    }
  }
  if (payload.start_at && payload.end_at && Date.parse(payload.end_at) <= Date.parse(payload.start_at))
    report('end_at', '结束时间必须晚于开始时间');
  if (payload.service_type === '收费课题培训' && !payload.training?.trim())
    report('training', '收费培训需要填写培训要求');
  if (payload.meeting_url && !isHttps(payload.meeting_url))
    report('meeting_url', '线上会议链接必须使用有效HTTPS地址');
  if (
    payload.people &&
    (!/^\d+$/.test(payload.people) || Number(payload.people) < 1 || Number(payload.people) > 100000)
  )
    report('people', '参会人数需为1至100000的整数');
  for (const key of ['contact_info', 'arranger_info', 'receiver_info'])
    if (payload[key] && !/^1\d{10}$|^\+?[\d -]{7,20}$|^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload[key]!))
      report(key, '联系方式需为手机、座机或邮箱');
  return { errors: [...new Set(errors)], issues, payload };
}

/**
 * 检查外部资料链接协议，防止脚本链接。
 * @param value 输入链接
 * @returns 是否为HTTPS链接
 */
export function isHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname;
  } catch {
    return false;
  }
}
