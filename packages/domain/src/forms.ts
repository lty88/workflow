import type {
  Condition,
  FormDefinition,
  FormField,
  FormValidationIssue,
  FormValidationResult,
} from './types';

/**
 * 将非负元金额转换为整数分，拒绝空值和精度超限。
 * @param value 输入值
 * @returns 整数分或 NaN
 */
export function amountFen(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN;
  const n = Math.round(Number(text) * 100);
  return Number.isSafeInteger(n) && n <= 10000000000 ? n : NaN;
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
  return Object.hasOwn(payload, field.key) ? payload[field.key]! : field.default;
}

/**
 * 生成表单默认值，前端新建时显式应用。
 * @param form 表单定义
 * @returns 默认输入对象
 */
export function defaultValues(form: FormDefinition): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const field of form.fields) payload[field.key] = field.default;
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
 * 按完整显隐关系校验动态表单，可限定当前步骤字段，并剔除隐藏和未知输入。
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
  let expenseFields = 0;
  for (const field of form.fields)
    if (['expert_fee', 'conference_fee', 'travel_fee'].includes(field.key)) expenseFields += 1;
  if (expenseFields === 3) {
    let total = 0;
    for (const key of ['expert_fee', 'conference_fee', 'travel_fee']) total += amountFen(input[key]);
    input.budget = Number.isFinite(total) ? (total / 100).toFixed(2) : '';
  }
  for (const field of visibleFields(form, input)) {
    const value = (input[field.key] ?? '').trim();
    payload[field.key] = value;
    if (field.required && !value) {
      report(field.key, `${field.label}为必填项`);
      continue;
    }
    if (!value) continue;
    if (value.length > 3000) report(field.key, `${field.label}不能超过3000字`);
    if (field.type === 'number' && !Number.isFinite(amountFen(value)))
      report(field.key, `${field.label}需为非负数字，最多两位小数`);
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
