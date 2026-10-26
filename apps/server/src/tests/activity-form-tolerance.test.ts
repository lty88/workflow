import { expect, test } from 'vitest';
import type { FormDefinition } from '@workflow/domain';
import {
  amountFen,
  budgetTotal,
  defaultValues,
  formatAmountFen,
  hasBudgetBreakdown,
  seedConfig,
  validateForm,
} from '@workflow/domain';
import { validateActivityStep } from '../../../web/src/components/activity/step-validation';

/**
 * 准备完整可提交的活动表单，开始时间模拟填写五分钟前选择的当前时刻。
 * @returns 表单定义和完整申请输入
 */
function fixture() {
  const form = seedConfig().form;
  const now = Date.now();
  const payload = {
    ...defaultValues(form),
    activity_name: '重庆教师阅读教学研讨活动',
    start_at: new Date(now - 5 * 60000).toISOString(),
    end_at: new Date(now + 3600000).toISOString(),
    location: '重庆市教师发展中心',
    background: '组织教师开展阅读教学交流',
    agenda: '课例展示与集体研讨',
    people: '30',
    contact: '活动联系人',
    contact_info: '13800000001',
    arranger: '活动安排人',
    arranger_info: '13800000002',
    receiver: '现场接待人',
    receiver_info: '13800000003',
  };
  return { form, payload };
}

/** 核对超过原业务上限的金额有效，整数分转换不受二进制小数误差影响。 */
function amountPrecisionCase(): void {
  for (const [yuan, fen] of [
    ['0', 0],
    ['0.29', 29],
    ['100000110.00', 10000011000],
    ['9876543210.37', 987654321037],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ] as const) {
    expect(amountFen(yuan)).toBe(fen);
    expect(amountFen(formatAmountFen(fen))).toBe(fen);
  }
  for (const invalid of ['', '-1', '12.345', 'Infinity', 'NaN', '1e100', '90071992547409.92'])
    expect(Number.isNaN(amountFen(invalid))).toBe(true);
  expect(formatAmountFen(Number.MAX_SAFE_INTEGER + 1)).toBe('');
}
test('金额取消一亿元上限，保留非负、两位小数和整数分安全精度', amountPrecisionCase);

/** 核对自动预算与分步校验共用合计规则，大额、零预算及一分钱均准确。 */
function budgetCalculationCase(): void {
  const { form, payload } = fixture();
  for (const [expert, conference, travel, expected] of [
    ['50', '100000000', '60', '100000110.00'],
    ['200000000.01', '300000000.02', '400000000.03', '900000000.06'],
    ['0.1', '0.2', '0.01', '0.31'],
    ['0', '0', '0', '0.00'],
  ]) {
    const input = {
      ...payload,
      expert_fee: expert!,
      conference_fee: conference!,
      travel_fee: travel!,
      budget: '1',
    };
    expect(budgetTotal(input)).toBe(expected);
    expect(validateActivityStep(form, input, 2, true).errors).toEqual([]);
    const result = validateForm(form, input);
    expect(result.errors).toEqual([]);
    expect(result.payload.budget).toBe(expected);
    expect(input.budget).toBe('1');
  }
}
test('大额和零预算前后端统一按明细精确合计，忽略手工篡改的总额', budgetCalculationCase);

/** 核对未填或填错明细只在对应字段提示，真实合计溢出则准确提示预算范围。 */
function budgetFeedbackCase(): void {
  const { form, payload } = fixture();
  expect(budgetTotal({ expert_fee: '', conference_fee: '20', travel_fee: '0' })).toBe('20.00');
  const missing = validateForm(form, { ...payload, expert_fee: '' });
  expect(
    missing.issues.some(
      /**
       * 检查缺失费用仍按必填规则反馈。
       * @param issue 字段问题
       * @returns 是否专家费必填提示
       */
      (issue) => issue.key === 'expert_fee',
    ),
  ).toBe(true);
  expect(
    missing.issues.some(
      /**
       * 防止自动合计字段重复提示必填。
       * @param issue 字段问题
       * @returns 是否预算问题
       */
      (issue) => issue.key === 'budget',
    ),
  ).toBe(false);
  const invalid = validateForm(form, { ...payload, expert_fee: '-1' });
  expect(invalid.issues).toEqual([{ key: 'expert_fee', message: '专家费（元）需为非负数字，最多两位小数' }]);
  const overflow = validateForm(form, {
    ...payload,
    expert_fee: '90071992547409.91',
    conference_fee: '0.01',
  });
  expect(overflow.issues).toEqual([
    { key: 'budget', message: '预算合计超出系统可精确处理的金额范围，请调整费用明细' },
  ]);
}
test('费用明细必填与预算安全精度分别反馈，避免合计字段级联报错', budgetFeedbackCase);

/** 核对开始时间不随填表耗时失效，同时保留必填、日期格式和时间先后校验。 */
function dateToleranceCase(): void {
  const { form, payload } = fixture();
  expect(validateActivityStep(form, payload, 1, true).errors).toEqual([]);
  expect(validateForm(form, payload).errors).toEqual([]);
  const historic = { ...payload, start_at: '2020-01-01T09:00:00+08:00', end_at: '2020-01-01T12:00:00+08:00' };
  expect(validateForm(form, historic).errors).toEqual([]);
  expect(validateForm(form, { ...payload, end_at: payload.start_at }).errors).toContain(
    '结束时间必须晚于开始时间',
  );
  expect(validateForm(form, { ...payload, start_at: 'invalid' }).errors).toContain('开始时间时间无效');
  expect(validateForm(form, { ...payload, start_at: '' }).errors).toContain('开始时间为必填项');
}
test('前端允许选择当前时刻后继续填表及补录，仍检查时间格式与先后', dateToleranceCase);

/** 核对缺少明细的自定义表单不误用固定预算合计，已有预算保持原值。 */
function partialBudgetFormCase(): void {
  const form: FormDefinition = {
    id: 'budget-only',
    name: '简易预算',
    fields: [
      {
        id: 'budget',
        key: 'budget',
        label: '预算',
        type: 'number',
        required: true,
        default: '',
        options: [],
      },
    ],
  };
  expect(hasBudgetBreakdown(form)).toBe(false);
  expect(validateForm(form, { budget: '100000110.00' }).payload.budget).toBe('100000110.00');
}
test('自定义表单没有完整明细时不覆盖其预算值', partialBudgetFormCase);
