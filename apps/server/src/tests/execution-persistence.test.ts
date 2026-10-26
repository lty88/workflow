import { expect, test } from 'vitest';
import { seedConfig } from '@workflow/domain';
import type { Activity, ExecutionRecord } from '@workflow/domain';
import { loadActivity, saveActivity } from '../db/repository';
import type { Database } from '../db/repository';

/** 构造不连接数据库的活动与已提交执行记录，验证规范化读写。
 * @returns 活动和记录
 */
function fixture() {
  const record: ExecutionRecord = {
    id: crypto.randomUUID(),
    authorId: 'u-su',
    authorName: '苏禾',
    submittedAt: '2026-10-26T02:00:00Z',
    start: '2026-10-26T01:00:00Z',
    end: '2026-10-26T02:00:00Z',
    people: 12,
    summary: '现场活动执行完成并收集了教师反馈',
    spend: '10.00',
    exception: '',
  };
  const activity: Activity = {
    id: 'activity',
    code: 'HD-RECORD',
    applicant: 'u-lin',
    department: 'd1',
    name: '持续执行活动',
    status: 'executing',
    version: 1,
    revision: 1,
    structureRevision: 1,
    configVersion: 1,
    schema: seedConfig().form,
    payload: {},
    snapshots: [],
    nodes: [],
    tasks: [],
    audit: [],
    executor: 'u-su',
    assignment: '负责活动',
    actualStart: record.start,
    report: null,
    archive: null,
    archives: [],
    cancellation: null,
    createdAt: record.start,
    updatedAt: record.end,
    executionRecords: [record],
  };
  return { record, activity };
}

/** 验证执行记录写入独立表、只追加，活动主JSON不重复存放全部日报。 */
async function saveCase(): Promise<void> {
  const { activity, record } = fixture();
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  /** 捕获事务写入语句，不执行外部数据库操作。
   * @param sql 写入语句
   * @param values 绑定参数
   * @returns MySQL驱动形式的写入结果
   */
  async function execute(sql: string, values: unknown[] = []) {
    calls.push({ sql, values });
    return [{ affectedRows: 1 }, []];
  }
  await saveActivity({ execute } as unknown as Database, activity);
  const stored = JSON.parse(
    String(calls.find((call) => call.sql.startsWith('UPDATE activities'))!.values[3]),
  );
  expect(stored.executionRecords).toEqual([]);
  expect(activity.executionRecords).toEqual([record]);
  const insert = calls.find((call) => call.sql.startsWith('INSERT IGNORE INTO execution_records'))!;
  expect(insert.values.slice(0, 3)).toEqual([activity.id, record.id, record.authorId]);
  expect(JSON.parse(String(insert.values[4]))).toEqual(record);
  expect(calls.some((call) => /UPDATE execution_records|DELETE FROM execution_records/.test(call.sql))).toBe(
    false,
  );
}
test('执行记录独立存表且只追加，主单JSON不复制日报内容', saveCase);

/** 验证旧JSON记录与独立表记录可以兼容合并，同一记录不被重复展示。 */
async function readCase(): Promise<void> {
  const { activity, record } = fixture();
  const fresh = {
    ...record,
    id: crypto.randomUUID(),
    submittedAt: '2026-10-26T03:00:00Z',
    summary: '补充第二阶段现场执行情况与整改结果',
  };
  /** 按查询对象提供历史JSON和规范化记录，其他业务子表为空。
   * @param sql 读取语句
   * @returns MySQL驱动形式的查询结果
   */
  async function execute(sql: string) {
    if (sql.includes('FROM activities')) return [[{ data: JSON.stringify(activity) }], []];
    if (sql.includes('FROM execution_records')) return [[{ data: record }, { data: fresh }], []];
    return [[], []];
  }
  const loaded = await loadActivity({ execute } as unknown as Database, activity.id);
  expect(loaded?.executionRecords).toEqual([record, fresh]);
}
test('历史JSON日报与独立记录表兼容合并，按时间排序且不重复', readCase);
