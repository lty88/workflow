import { expect, test } from 'vitest';
import {
  actionSchema,
  activityDeleteSchema,
  adjustmentSchema,
  executionReportErrors,
  reportSchema,
  transferSchema,
  validateForm,
} from '@workflow/domain';
import { isRequiredEmpty, requiredRule } from '../../../web/src/composables/form-validation';
import { fileAccessRequiredErrors } from '../../../web/src/components/security/access-validation';

/** 验证前端对空白、空多选和数字零值的必填语义一致。 */
function emptyInputCase(): void {
  for (const value of ['', '  ', '\t\n', null, undefined, []]) expect(isRequiredEmpty(value)).toBe(true);
  for (const value of [0, false, '简', ['x']]) expect(isRequiredEmpty(value)).toBe(false);
  const rule = requiredRule('说明');
  /** 接收规则回调，当前规则直接返回校验结果，无额外副作用。 */
  function callback(): void {}
  expect(rule.validator?.(rule, '简', callback, {}, {})).toBe(true);
  expect(rule.validator?.(rule, '   ', callback, {}, {})).toBeInstanceOf(Error);
  expect(rule.validator?.(rule, 0, callback, {}, {})).toBe(true);
}
test('浏览器必填规则拒绝空白和空选择，零人数和单字内容有效', emptyInputCase);

/** 验证业务文本仅要求非空，单字说明可通过且空白说明仍被拒绝。 */
function businessTextCase(): void {
  const key = crypto.randomUUID();
  const report = {
    start: '2026-01-01T01:00:00Z',
    end: '2026-01-01T02:00:00Z',
    people: 1,
    summary: '成',
    spend: '',
    exception: '',
  };
  expect(reportSchema.safeParse(report).success).toBe(true);
  expect(executionReportErrors(report)).toEqual([]);
  expect(reportSchema.safeParse({ ...report, summary: '   ' }).success).toBe(false);
  expect(executionReportErrors({ ...report, summary: '   ' })).toContain('请填写执行情况与成果');
  expect(
    transferSchema.safeParse({
      assignee: 'u-other',
      reason: '调',
      expectedTaskVersion: 1,
      idempotencyKey: key,
    }).success,
  ).toBe(true);
  expect(
    adjustmentSchema.safeParse({
      name: '审',
      reason: '补',
      assignee: { type: 'manager', value: '' },
      kind: 'approval',
      anchor: 'first',
      position: 'after',
      expectedStructureRevision: 1,
      idempotencyKey: key,
    }).success,
  ).toBe(true);
  expect(
    activityDeleteSchema.safeParse({ reason: '删', expectedVersion: 1, idempotencyKey: key }).success,
  ).toBe(true);
  expect(
    actionSchema.safeParse({
      action: 'assign',
      comment: '办',
      executor: 'u-executor',
      expectedVersion: 1,
      idempotencyKey: key,
    }).success,
  ).toBe(true);
}
test('汇报、转交、调整、删除和执行安排不再要求5字或10字', businessTextCase);

/** 验证动态文本不在服务端做字数校验，必填缺项仍能定位到字段。 */
function dynamicTextCase(): void {
  const form = {
    id: 'test',
    name: '表单',
    fields: [
      {
        id: 'f',
        key: 'notes',
        label: '说明',
        type: 'textarea' as const,
        required: true,
        default: '',
        options: [],
      },
    ],
  };
  expect(validateForm(form, { notes: '简' }).errors).toEqual([]);
  expect(validateForm(form, { notes: '文'.repeat(4000) }).errors).toEqual([]);
  expect(validateForm(form, { notes: '   ' }).issues).toContainEqual({
    key: 'notes',
    message: '说明为必填项',
  });
}
test('动态表单后端按必填校验文本，缺项仍保留字段反馈', dynamicTextCase);

/** 验证指定授权未选择人员时在浏览器阻止提交，继承和共享不强迫选择受众。 */
function attachmentAudienceCase(): void {
  expect(fileAccessRequiredErrors({})).toEqual([]);
  expect(fileAccessRequiredErrors({ access: { mode: 'shared', roleIds: [], userIds: [] } })).toEqual([]);
  expect(fileAccessRequiredErrors({ access: { mode: 'restricted', roleIds: [], userIds: [] } })).toEqual([
    '请为查看范围选择至少一类授权人员',
  ]);
  expect(
    fileAccessRequiredErrors({ access: { mode: 'restricted', roleIds: [], userIds: [], applicant: true } }),
  ).toEqual([]);
  expect(
    fileAccessRequiredErrors({ downloadAccess: { mode: 'restricted', roleIds: [], userIds: [] } }),
  ).toEqual(['请为下载范围选择至少一类授权人员']);
}
test('新文件默认权限和单文件权限共用必选受众校验', attachmentAudienceCase);
