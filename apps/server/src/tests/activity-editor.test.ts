import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { defaultValues, seedConfig, validateForm } from '@workflow/domain';
import type { Activity, PageDefinition } from '@workflow/domain';
import {
  activityStepKeys,
  validateActivityStep,
  validateActivityTransition,
} from '../../../web/src/components/activity/step-validation';
import { workspaceNavigation, menuDestination } from '../../../web/src/components/layout/navigation';
import { listActivities } from '../services/list-service';

/**
 * 构造只填基础信息的申请，后续内容刻意保持空白。
 * @returns 基础步骤有效的完整输入对象
 */
function basicPayload(): Record<string, string> {
  return {
    ...defaultValues(seedConfig().form),
    activity_name: '学校教研活动',
    start_at: '2026-12-01T09:00:00+08:00',
    end_at: '2026-12-01T12:00:00+08:00',
    location: '树人学校',
  };
}

/**
 * 构造可通过最终校验的申请，用于步骤跳转与完整校验一致性检查。
 * @returns 内容和联系人均有效的申请
 */
function fullPayload(): Record<string, string> {
  return {
    ...basicPayload(),
    background: '提升教师教学能力',
    agenda: '公开课与教研交流',
    people: '30',
    contact: '张老师',
    contact_info: '13800000001',
    arranger: '活动安排人',
    arranger_info: '13800000002',
    receiver: '学校接收人',
    receiver_info: '13800000003',
  };
}

/** 核对空表单在第一步报错，填写基础信息后不被第二步必填项提前阻止。 */
function basicValidationCase(): void {
  const form = seedConfig().form;
  const missing = validateActivityStep(form, defaultValues(form), 1, true);
  expect(missing.issues.some((issue) => issue.key === 'activity_name')).toBe(true);
  for (const issue of missing.issues) expect(activityStepKeys(form, 1)).toContain(issue.key);
  expect(missing.errors.join()).not.toContain('联系人');
  expect(validateActivityStep(form, basicPayload(), 1, true).errors).toEqual([]);
  expect(validateActivityStep(form, basicPayload(), 1, false).issues[0].key).toBe('__template__');
  expect(validateForm(form, basicPayload()).errors.length).toBeGreaterThan(0);
}
test('基础步骤仅校验当前字段，模板未选时阻止前进', basicValidationCase);

/** 核对跨步骤条件保留完整上下文，收费培训要求只在内容步骤校验。 */
function dependentValidationCase(): void {
  const form = seedConfig().form;
  const input = { ...basicPayload(), service_type: '收费课题培训' };
  expect(validateActivityStep(form, input, 1, true).errors).toEqual([]);
  expect(validateActivityStep(form, input, 2, true).issues.some((issue) => issue.key === 'training')).toBe(
    true,
  );
  const online = {
    ...basicPayload(),
    delivery_mode: '线上',
    location: '',
    meeting_url: 'http://unsafe.example.com',
  };
  const result = validateActivityStep(form, online, 1, true);
  expect(result.issues.some((issue) => issue.key === 'location')).toBe(false);
  expect(result.issues.some((issue) => issue.key === 'meeting_url')).toBe(true);
  expect(
    validateActivityStep(
      form,
      { ...basicPayload(), end_at: '2026-12-01T08:00:00+08:00' },
      1,
      true,
    ).issues.some((issue) => issue.key === 'end_at'),
  ).toBe(true);
}
test('显隐和跨字段规则按正确步骤校验，隐藏字段不阻塞', dependentValidationCase);

/** 核对人数、联系方式、费用及自定义必填字段在第二步准确定位。 */
function contentValidationCase(): void {
  const form = seedConfig().form;
  form.fields.push({
    id: 'custom',
    key: 'custom_requirement',
    label: '现场物料需求',
    type: 'textarea',
    required: true,
    default: '',
    options: [],
  });
  const input = { ...fullPayload(), people: '0', contact_info: '无效联系方式', expert_fee: '-1' };
  const before = JSON.stringify(input);
  const result = validateActivityStep(form, input, 2, true);
  for (const key of ['people', 'contact_info', 'expert_fee', 'custom_requirement'])
    expect(result.issues.some((issue) => issue.key === key)).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
  const guarded = structuredClone(form);
  guarded.fields.find((field) => field.key === 'custom_requirement')!.redacted = true;
  expect(
    validateActivityStep(guarded, fullPayload(), 2, true).issues.some(
      (issue) => issue.key === 'custom_requirement',
    ),
  ).toBe(false);
  expect(activityStepKeys(guarded, 2)).toContain('custom_requirement');
}
test('内容校验覆盖动态字段、人数、联系方式和费用，保留受限占位展示', contentValidationCase);

/** 核对纯校验函数定位第一个未通过的步骤，不修改输入或触发保存。 */
function transitionCase(): void {
  const form = seedConfig().form;
  const input = basicPayload();
  const before = JSON.stringify(input);
  expect(validateActivityTransition(form, input, 2, true).errors).toEqual([]);
  expect(validateActivityTransition(form, input, 3, true).step).toBe(2);
  expect(validateActivityTransition(form, fullPayload(), 3, true).errors).toEqual([]);
  expect(JSON.stringify(input)).toBe(before);
}
test('直接进入提交页先检查基础与内容，校验不保存或改变草稿', transitionCase);

/** 核对按组件去重配置中心，保留其他动态页面，所有配置入口导航到同一管理页面。 */
function navigationCase(): void {
  const pages: PageDefinition[] = [
    { id: 'home', name: '工作台', group: 'business', active: true, component: 'summary' },
    { id: 'config-a', name: '配置中心', group: 'system', active: true, component: 'config_overview' },
    { id: 'config-b', name: '另一个配置中心', group: 'system', active: true, component: 'config_overview' },
    { id: 'list', name: '配置中心', group: 'business', active: true, component: 'activity_list' },
  ];
  const before = JSON.stringify(pages);
  const result = workspaceNavigation(pages);
  expect(result.map((page) => page.id)).toEqual(['home', 'config-a', 'list']);
  expect(menuDestination(result[1])).toBe('/settings');
  expect(menuDestination(result[2])).toBe('/workspace/list');
  expect(JSON.stringify(pages)).toBe(before);
}
test('配置中心导航去重，动态页面权限和分组保持原有定义', navigationCase);

/** 核对列表优先展示新活动的发起人姓名快照，历史活动按已有身份补齐姓名。 */
async function applicantCase(): Promise<void> {
  const config = seedConfig();
  config.users.find((user) => user.id === 'u-lin')!.name = '发起人新姓名';
  const common: Omit<Activity, 'id' | 'code' | 'name'> = {
    applicant: 'u-lin',
    department: 'd1',
    executor: '',
    nodes: [],
    cancellation: null,
    status: 'draft',
    version: 1,
    structureRevision: 1,
    revision: 0,
    configVersion: 1,
    schema: config.form,
    payload: basicPayload(),
    snapshots: [],
    tasks: [],
    audit: [],
    assignment: '',
    actualStart: '',
    report: null,
    archive: null,
    archives: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const activities = [
    { ...common, id: 'new', code: 'HD-NEW', name: '新活动', applicantName: '发起时姓名' },
    { ...common, id: 'legacy', code: 'HD-OLD', name: '历史活动' },
  ] satisfies Activity[];
  /**
   * 返回授权配置与两份活动，覆盖列表展示而不连接真实数据库。
   * @param sql 当前只读查询
   * @returns 内存配置、总数或活动行
   */
  async function execute(sql: string): Promise<[unknown[], unknown[]]> {
    if (sql.includes('FROM configuration'))
      return [[{ published: config, draft: config, revision: 1, draft_revision: 1 }], []];
    if (sql.includes('COUNT(*)')) return [[{ total: 2 }], []];
    if (sql.includes('SELECT a.data')) return [activities.map((activity) => ({ data: activity })), []];
    return [[], []];
  }
  const result = await listActivities({ execute } as unknown as Pool, 'u-lin', {
    q: '',
    status: '',
    scope: 'all',
    page: 1,
    pageSize: 15,
  });
  expect(result.items[0].applicant).toBe('u-lin');
  expect(result.items[0].applicantName).toBe('发起时姓名');
  expect(result.items[1].applicantName).toBe('发起人新姓名');
}
test('发起人身份与姓名快照正确展示，历史活动可直接显示姓名', applicantCase);
