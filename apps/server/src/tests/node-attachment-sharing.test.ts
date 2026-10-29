import { expect, test } from 'vitest';
import {
  canDownloadFile,
  canReadFile,
  instantiateWorkflow,
  NODE_PRIVATE_ACCESS,
  projectActivityDetail,
  seedConfig,
  nodeAttachmentScope,
} from '@workflow/domain';
import type { Activity, ActivityDetail, FileRecord } from '@workflow/domain';
import { accessRuleMode } from '../../../web/src/components/security/access-rule-mode';

/** 构造部门初审到营销复核的附件流转，后续审批人有申请访问与下载资格。
 * @returns 测试配置、申请、初审节点及已提交附件
 */
function fixture() {
  const config = seedConfig();
  config.roles
    .find(
      /** 为后续审核人授予下载能力，独立校验文件受众。
       * @param role 角色
       * @returns 是否营销审核角色
       */ function marketing(role) {
        return role.id === 'marketing';
      },
    )!
    .permissions.push('file:download');
  const plan = instantiateWorkflow(config, { budget: '12000' }, 'u-lin');
  expect(plan.errors).toEqual([]);
  const node = plan.nodes.find(
    /** 定位上传资料的部门初审。
     * @param item 实例节点
     * @returns 是否初审
     */ function initial(item) {
      return item.key === 'n-department';
    },
  )!;
  node.status = 'completed';
  const activity: Activity = {
    id: 'a-sharing',
    code: 'HD-SHARING',
    name: '共享资料审批',
    applicant: 'u-lin',
    department: 'd1',
    status: 'approving',
    version: 1,
    revision: 1,
    structureRevision: 1,
    configVersion: 1,
    schema: structuredClone(config.form),
    payload: {},
    snapshots: [],
    nodes: plan.nodes,
    tasks: [],
    audit: [],
    executor: '',
    assignment: '',
    actualStart: '',
    report: null,
    archive: null,
    archives: [],
    cancellation: null,
    createdAt: '',
    updatedAt: '',
  };
  const file: FileRecord = {
    id: 'f-sharing',
    activityId: activity.id,
    nodeId: node.id,
    stage: 'node',
    uploaderId: 'u-chen',
    name: '初审方案.pdf',
    mime: 'application/pdf',
    size: 100,
    createdAt: '',
  };
  const detail: ActivityDetail = { activity, files: [file], actions: [], participants: [], taskWarnings: [] };
  return { config, activity, node, file, detail };
}

/** 新提交冻结共享默认值，后续审批人及申请人可见，未参与申请的人仍无法访问。 */
function newSubmissionCase(): void {
  const { config, activity, node, file, detail } = fixture();
  expect(node.access?.mode).toBe('shared');
  expect(config.workflow.nodes[0]!.access).toBeUndefined();
  expect(canReadFile(config, 'u-zhao', activity, file)).toBe(true);
  expect(canDownloadFile(config, 'u-zhao', activity, file)).toBe(true);
  expect(canReadFile(config, 'u-lin', activity, file)).toBe(true);
  expect(canDownloadFile(config, 'u-lin', activity, file)).toBe(false);
  expect(canReadFile(config, 'u-qiao', activity, file)).toBe(false);
  expect(projectActivityDetail(config, 'u-zhao', detail).files[0]?.id).toBe(file.id);
}
test('新提交默认共享允许后续审批人查看，申请范围与下载能力继续校验', newSubmissionCase);

/** 旧申请缺失权限仍保持原私有语义，明确受限节点和单文件也不被新默认值覆盖。 */
function explicitAndLegacyCase(): void {
  const { config, activity, node, file } = fixture();
  delete node.access;
  expect(canReadFile(config, 'u-zhao', activity, file)).toBe(false);
  node.access = structuredClone(NODE_PRIVATE_ACCESS);
  expect(canReadFile(config, 'u-zhao', activity, file)).toBe(false);
  expect(canReadFile(config, 'u-chen', activity, file)).toBe(true);
  node.access = { mode: 'shared', roleIds: [], userIds: [] };
  file.access = structuredClone(NODE_PRIVATE_ACCESS);
  expect(canReadFile(config, 'u-zhao', activity, file)).toBe(false);
  file.access = { mode: 'restricted', roleIds: [], userIds: ['u-zhao'] };
  expect(canReadFile(config, 'u-zhao', activity, file)).toBe(true);
  file.downloadAccess = structuredClone(NODE_PRIVATE_ACCESS);
  expect(canDownloadFile(config, 'u-zhao', activity, file)).toBe(false);
  expect(canReadFile(config, 'u-lin', activity, file)).toBe(false);
}
test('原私有默认值与显式授权保留，单文件受众和下载限制独立执行', explicitAndLegacyCase);

/** 未提交附件不会因为共享而提前暴露，提交记录出现后才向后续审核人开放。 */
function pendingCase(): void {
  const { config, activity, file } = fixture();
  file.contextId = 'decision-context';
  expect(canReadFile(config, 'u-zhao', activity, file)).toBe(false);
  expect(canReadFile(config, 'u-chen', activity, file)).toBe(true);
  activity.audit.push({
    id: 'e-committed',
    actor: 'u-chen',
    actorName: '初审人',
    action: '审批通过',
    note: '',
    createdAt: '',
    attachmentContextId: file.contextId,
  });
  expect(canReadFile(config, 'u-zhao', activity, file)).toBe(true);
}
test('节点共享仍等待附件所属办理表单正式提交', pendingCase);

/** 模板明确选择私有或指定人员时，实例冻结原规则且不与模板对象共用引用。 */
function configuredTemplateCase(): void {
  const config = seedConfig();
  config.workflow.nodes[0]!.access = structuredClone(NODE_PRIVATE_ACCESS);
  const plan = instantiateWorkflow(config, { budget: '12000' }, 'u-lin');
  const node = plan.nodes.find(
    /** 取得显式限制的初审节点。
     * @param item 实例节点
     * @returns 是否初审
     */ function initial(item) {
      return item.key === 'n-department';
    },
  )!;
  expect(node.access).toEqual(NODE_PRIVATE_ACCESS);
  expect(node.access).not.toBe(config.workflow.nodes[0]!.access);
  expect(accessRuleMode(node.access!, true)).toBe('node_only');
  expect(accessRuleMode({ ...node.access!, userIds: ['u-zhao'] }, true)).toBe('restricted');
  expect(accessRuleMode({ ...node.access!, applicant: true }, true)).toBe('restricted');
  expect(accessRuleMode({ mode: 'shared', roleIds: [], userIds: [] }, true)).toBe('shared');
  expect(accessRuleMode(node.access!, false)).toBe('restricted');
}
test('模板显式限制冻结保留，前端准确区分仅本节点和指定人员', configuredTemplateCase);


/** 页面实际默认范围取自实例，既有私有规则与新共享规则分别展示，单文件另行覆盖。 */
function scopeSummaryCase(): void {
  const { config, node, file, detail } = fixture();
  let safe = projectActivityDetail(config, 'u-chen', detail);
  expect(safe.access?.nodeAttachmentScopes?.[node.id]).toEqual({ view: '流程内共享', download: '流程内共享' });
  expect(safe.files[0]!.inheritedScope?.view).toBe('流程内共享');
  expect(safe.files[0]!.viewScopeLabel).toBe('流程内共享');
  delete node.access;
  expect(nodeAttachmentScope(node)).toEqual({ view: '仅本节点办理人', download: '仅本节点办理人' });
  safe = projectActivityDetail(config, 'u-chen', detail);
  expect(safe.access?.nodeAttachmentScopes?.[node.id]?.view).toBe('仅本节点办理人');
  expect(safe.activity.nodes[0]!.access).toBeUndefined();
  file.access = { mode: 'shared', roleIds: [], userIds: [] };
  file.downloadAccess = { mode: 'restricted', roleIds: [], userIds: ['u-chen'] };
  safe = projectActivityDetail(config, 'u-chen', detail);
  expect(safe.files[0]!.inheritedScope?.view).toBe('仅本节点办理人');
  expect(safe.files[0]!.viewScopeLabel).toBe('流程内共享');
  expect(safe.files[0]!.downloadScopeLabel).toBe('指定人员或角色');
  node.access = { mode: 'restricted', roleIds: ['director'], userIds: [], nodeAssignees: true };
  expect(nodeAttachmentScope(node).view).toBe('指定人员或角色');
  expect(nodeAttachmentScope().view).toBe('流程内共享');
}
test('权限摘要真实显示节点默认与单文件覆盖，不改变历史授权或暴露名单', scopeSummaryCase);
