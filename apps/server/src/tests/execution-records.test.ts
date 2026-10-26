import { expect, test } from 'vitest';
import {
  actionSchema,
  activityActions,
  applyActivityAction,
  canReadFile,
  evaluationEligible,
  projectActivityDetail,
  seedConfig,
  attachmentContextCommitted,
} from '@workflow/domain';
import type { Activity, ExecutionReport, FileRecord } from '@workflow/domain';

/** 构造已进入执行阶段的活动，保留历史单次汇报兼容字段。
 * @returns 组织、活动与合法执行记录
 */
function fixture() {
  const config = seedConfig();
  const now = Date.now();
  const report: ExecutionReport = {
    title: '首日执行日报',
    start: new Date(now - 3600000).toISOString(),
    end: new Date(now - 1000).toISOString(),
    people: 40,
    summary: '完成首日教学活动安排并收集课堂反馈',
    spend: '100.00',
    exception: '',
  };
  const activity: Activity = {
    id: 'test-activity',
    code: 'HD-EXEC',
    name: '真实执行活动',
    applicant: 'u-lin',
    department: 'd1',
    status: 'executing',
    version: 1,
    revision: 1,
    structureRevision: 1,
    configVersion: config.version,
    schema: config.form,
    payload: {},
    nodes: [],
    tasks: [],
    snapshots: [],
    audit: [],
    executor: 'u-su',
    assignment: '负责现场活动',
    actualStart: report.start,
    report: null,
    archive: null,
    archives: [],
    cancellation: null,
    createdAt: report.start,
    updatedAt: report.start,
  };
  return { config, activity, report };
}

/** 验证多次日报保留内容且不提前进入归档或开放匿名评价。 */
function appendCase(): void {
  const { config, activity, report } = fixture();
  for (const title of ['第一天记录', '第二天记录'])
    applyActivityAction(
      config,
      'u-su',
      activity,
      {
        expectedVersion: 1,
        action: 'report',
        comment: '',
        idempotencyKey: crypto.randomUUID(),
        attachmentContextId: crypto.randomUUID(),
        report: { ...report, title },
      },
      false,
    );
  expect(activity.status).toBe('executing');
  expect(activity.executionRecords?.map((record) => record.title)).toEqual(['第一天记录', '第二天记录']);
  expect(activity.report).toBeNull();
  expect(evaluationEligible(activity)).toBe(false);
  expect(activityActions(config, 'u-su', activity)).toContain('execution-complete');
  expect(activityActions(config, 'u-lin', activity)).not.toContain('execution-complete');
}
test('日报可连续追加，只有执行人拥有完成入口，记录本身不推进归档', appendCase);

/** 验证最终汇总由执行人显式确认，人数采用最终值而非重复累加日报人数。 */
function completionCase(): void {
  const { config, activity, report } = fixture();
  applyActivityAction(
    config,
    'u-su',
    activity,
    { expectedVersion: 1, action: 'report', comment: '', idempotencyKey: crypto.randomUUID(), report },
    false,
  );
  applyActivityAction(
    config,
    'u-su',
    activity,
    {
      expectedVersion: 1,
      action: 'execution-complete',
      comment: '',
      idempotencyKey: crypto.randomUUID(),
      report: { ...report, people: 65, spend: '180.00' },
    },
    false,
  );
  expect(activity.report?.people).toBe(65);
  expect(activity.report?.spend).toBe('180.00');
  expect(activity.executionRecords).toHaveLength(1);
  expect(activity.executionCompletedAt).toBeTruthy();
  expect(activity.status).toBe('archive_draft');
  expect(activityActions(config, 'u-su', activity)).toContain('archive-submit');
  expect(activityActions(config, 'u-lin', activity)).not.toContain('archive-submit');
  expect(evaluationEligible(activity)).toBe(true);
  expect(() =>
    applyActivityAction(
      config,
      'u-su',
      activity,
      { expectedVersion: 1, action: 'report', comment: '', idempotencyKey: crypto.randomUUID(), report },
      false,
    ),
  ).toThrow('当前状态不允许');
}
test('手动完成后冻结记录、保留最终汇总并开放归档及评价', completionCase);

/** 验证相同记录分组不会重复新增，未开始记录的执行不能直接跳过汇报。 */
function conflictCase(): void {
  const { config, activity, report } = fixture();
  const command = {
    expectedVersion: 1,
    action: 'report' as const,
    comment: '',
    idempotencyKey: crypto.randomUUID(),
    attachmentContextId: crypto.randomUUID(),
    report,
  };
  expect(activityActions(config, 'u-su', activity)).not.toContain('execution-complete');
  applyActivityAction(config, 'u-su', activity, command, false);
  expect(() => applyActivityAction(config, 'u-su', activity, command, false)).toThrow('该执行记录已提交');
  expect(activity.executionRecords).toHaveLength(1);
  expect(actionSchema.safeParse({ ...command, report: { ...report, people: -1 } }).success).toBe(false);
}
test('重复记录与非法人数被阻止，空执行不开放完成按钮', conflictCase);

/** 验证未提交附件仅上传人可见，正式提交后才按活动授权开放，日报支出继承预算脱敏。 */
function attachmentProjectionCase(): void {
  const { config, activity, report } = fixture();
  const contextId = crypto.randomUUID();
  const file: FileRecord = {
    id: 'file',
    activityId: activity.id,
    uploaderId: 'u-su',
    name: '现场记录.pdf',
    mime: 'application/pdf',
    size: 15,
    stage: 'execution',
    contextId,
    actionKey: 'report',
    createdAt: report.end,
  };
  expect(canReadFile(config, 'u-lin', activity, file)).toBe(false);
  expect(canReadFile(config, 'u-su', activity, file)).toBe(true);
  applyActivityAction(
    config,
    'u-su',
    activity,
    {
      expectedVersion: 1,
      action: 'report',
      comment: '',
      idempotencyKey: crypto.randomUUID(),
      attachmentContextId: contextId,
      report,
    },
    false,
  );
  expect(attachmentContextCommitted(activity, contextId)).toBe(true);
  expect(canReadFile(config, 'u-lin', activity, file)).toBe(true);
  const budget = config.form.fields.find((field) => field.key === 'budget')!;
  budget.access = { read: { mode: 'restricted', roleIds: [], userIds: ['u-liu'] }, mask: 'hidden' };
  const detail = projectActivityDetail(config, 'u-lin', {
    activity,
    files: [file],
    actions: [],
    participants: [],
    taskWarnings: [],
  });
  expect(detail.activity.executionRecords?.[0]?.spend).toBe('');
  expect(activity.executionRecords?.[0]?.spend).toBe('100.00');
}
test('未提交附件隔离与执行日志金额脱敏保持有效', attachmentProjectionCase);

/** 验证筹备日报允许零参会人数，最终零人数仍需说明原因。 */
function zeroAttendanceCase(): void {
  const { config, activity, report } = fixture();
  applyActivityAction(
    config,
    'u-su',
    activity,
    {
      expectedVersion: 1,
      action: 'report',
      comment: '',
      idempotencyKey: crypto.randomUUID(),
      report: { ...report, people: 0 },
    },
    false,
  );
  expect(activity.executionRecords?.[0]?.people).toBe(0);
  expect(() =>
    applyActivityAction(
      config,
      'u-su',
      activity,
      {
        expectedVersion: 1,
        action: 'execution-complete',
        comment: '',
        idempotencyKey: crypto.randomUUID(),
        report: { ...report, people: 0 },
      },
      false,
    ),
  ).toThrow('需说明原因');
}
test('筹备日报允许零参会人数，完成汇总仍校验异常说明', zeroAttendanceCase);
