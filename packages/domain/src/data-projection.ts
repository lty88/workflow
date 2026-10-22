import type { Activity, ActivityDetail, CompanyConfig, FileRecord, FormDefinition, FormField } from './types';
import { canHandleTask, canReadActivity, findById, hasPermission } from './permissions';
import { visibleFields } from './forms';
import {
  canAccessField,
  canDownloadFile,
  canReadFile,
  canReadNodeContent,
  fieldConstraints,
  hasScopedDataPermission,
  isSensitiveField,
} from './data-access';

/**
 * 生成部分脱敏文本，短值全部隐藏，空值保持为空。
 * @param value 字段原文
 * @returns 脱敏文本
 */
export function maskSensitiveValue(value: string): string {
  if (!value) return '';
  return value.length < 5 ? '****' : value.slice(0, 2) + '****' + value.slice(-2);
}

/**
 * 过滤表单字段与值，禁止默认值、显隐条件或未知键绕过内容授权。
 * @param config 当前配置
 * @param actor 当前成员
 * @param activity 已通过活动范围校验的实例
 * @param form 当前或历史表单
 * @param payload 对应原始数据
 * @param exporting 是否用于导出，受限字段另需敏感导出权限
 * @returns 安全表单、安全值及被隐藏的字段键
 */
export function projectFormData(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  form: FormDefinition,
  payload: Record<string, string>,
  exporting = false,
): { schema: FormDefinition; payload: Record<string, string>; hidden: string[] } {
  const fields: FormField[] = [];
  const values: Record<string, string> = {};
  const hidden: string[] = [];
  const visible = new Set(
    visibleFields(form, payload).map(
      /**
       * 收集当前实际显示的字段键，避免依赖被隐藏后错误展示。
       * @param field 表单字段
       * @returns 字段键
       */
      function key(field) {
        return field.key;
      },
    ),
  );
  for (const field of form.fields) {
    const read = canAccessField(config, actor, activity, field);
    const sensitive = isSensitiveField(config, field);
    const exportable =
      !exporting ||
      !sensitive ||
      hasScopedDataPermission(config, actor, activity, 'activity:sensitive:export');
    const constraints = fieldConstraints(config, field);
    let partial = false;
    let hiddenMask = false;
    for (const item of constraints)
      if (item.access?.read.mode === 'restricted') {
        if (item.access.mask === 'hidden') hiddenMask = true;
        else partial = true;
      }
    if (!read || !exportable) {
      hidden.push(field.key);
      if (!exporting && partial && !hiddenMask && visible.has(field.key)) {
        fields.push({
          id: field.id,
          key: field.key,
          label: field.label,
          type: 'text',
          required: false,
          default: '',
          options: [],
          readOnly: true,
          redacted: true,
        });
        values[field.key] = maskSensitiveValue(payload[field.key] || '');
      }
      continue;
    }
    const safe = structuredClone(field);
    delete safe.access;
    delete safe.accessConstraints;
    safe.default = '';
    safe.readOnly = !canAccessField(config, actor, activity, field, true);
    if (safe.visible) {
      const source = form.fields.find(
        /**
         * 查找显隐条件依赖字段。
         * @param item 候选字段
         * @returns 是否为条件来源
         */
        function dependency(item) {
          return item.key === safe.visible?.field;
        },
      );
      if (!source || !canAccessField(config, actor, activity, source)) {
        if (!visible.has(field.key)) continue;
        delete safe.visible;
      }
    }
    fields.push(safe);
    if (Object.hasOwn(payload, field.key)) values[field.key] = payload[field.key]!;
  }
  return { schema: { ...form, fields }, payload: values, hidden };
}

/**
 * 合并可编辑字段，隐藏或只读字段保留服务器原值，越权修改直接拒绝。
 * @param config 当前配置
 * @param actor 当前申请人
 * @param activity 已锁定活动或新建上下文
 * @param form 目标模板表单
 * @param input 客户端输入
 * @returns 不含越权修改的完整表单数据
 */
export function mergeWritablePayload(
  config: CompanyConfig,
  actor: string,
  activity: Activity,
  form: FormDefinition,
  input: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of form.fields) {
    const previous = activity.payload[field.key];
    if (previous !== undefined) next[field.key] = previous;
    if (!Object.hasOwn(input, field.key)) continue;
    const value = input[field.key]!;
    if (canAccessField(config, actor, activity, field, true)) next[field.key] = value;
    else if (value !== previous && value !== maskSensitiveValue(previous || ''))
      throw Object.assign(new Error(`无权修改字段：${field.label}`), {
        statusCode: 403,
        code: 'FIELD_FORBIDDEN',
      });
  }
  return next;
}

/**
 * 构造安全活动详情，历史快照、节点意见、附件及审计备注统一执行内容授权。
 * @param config 实时组织与字段权限
 * @param actor 当前成员
 * @param detail 完整服务端详情
 * @param exporting 是否用于导出
 * @returns 已过滤原文与附带操作能力的详情
 */
export function projectActivityDetail(
  config: CompanyConfig,
  actor: string,
  detail: ActivityDetail,
  exporting = false,
): ActivityDetail {
  const source = detail.activity;
  if (!canReadActivity(config, actor, source))
    throw Object.assign(new Error('活动不存在或无访问权限'), { statusCode: 404 });
  const safe = structuredClone(detail);
  const current = projectFormData(config, actor, source, source.schema, source.payload, exporting);
  safe.activity.schema = current.schema;
  safe.activity.payload = current.payload;
  const readable = new Set<string>();
  const upload: string[] = [];
  let containsSensitive = false;
  const sensitiveExport = hasScopedDataPermission(config, actor, source, 'activity:sensitive:export');
  for (const node of source.nodes) {
    if (canReadNodeContent(config, actor, source, node)) readable.add(node.id);
    for (const task of source.tasks)
      if (task.nodeId === node.id && readable.has(node.id) && canHandleTask(config, actor, source, task)) {
        upload.push(node.id);
        break;
      }
  }
  for (const node of safe.activity.nodes) {
    delete node.access;
    delete node.downloadAccess;
  }
  for (const task of safe.activity.tasks) {
    const node = findById(source.nodes, task.nodeId);
    if (!readable.has(task.nodeId) || (exporting && node?.access?.mode !== 'shared' && !sensitiveExport))
      task.comment = '';
    else if (task.comment) containsSensitive = true;
  }
  safe.files = [];
  for (const file of detail.files) {
    if (!canReadFile(config, actor, source, file)) continue;
    if (
      exporting &&
      (((file.nodeId || file.access?.mode === 'restricted') && !sensitiveExport) ||
        !canDownloadFile(config, actor, source, file))
    )
      continue;
    const projected: FileRecord = {
      ...file,
      canDownload: canDownloadFile(config, actor, source, file),
      canPreview: ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mime),
    };
    projected.canManageAccess = file.uploaderId === actor || hasPermission(config, actor, 'config:manage');
    if (!projected.canManageAccess) {
      delete projected.access;
      delete projected.downloadAccess;
    }
    delete projected.uploaderId;
    safe.files.push(projected);
    if (file.nodeId || file.access?.mode === 'restricted') containsSensitive = true;
  }
  for (const snapshot of safe.activity.snapshots) {
    const projected = projectFormData(config, actor, source, snapshot.schema, snapshot.payload, exporting);
    snapshot.schema = projected.schema;
    snapshot.payload = projected.payload;
    for (const field of snapshot.schema.fields)
      if (!field.redacted && isSensitiveField(config, field) && snapshot.payload[field.key])
        containsSensitive = true;
    for (const node of snapshot.workflow) {
      delete node.condition;
      delete node.access;
      delete node.downloadAccess;
    }
  }
  for (const event of safe.activity.audit) {
    let permitted = hasScopedDataPermission(config, actor, source, 'activity:sensitive:read');
    if (event.nodeId) permitted = readable.has(event.nodeId);
    if (event.fileId) {
      const file = findById(detail.files, event.fileId);
      permitted = !!file && canReadFile(config, actor, source, file);
    }
    if (!permitted || (exporting && !sensitiveExport)) event.note = '';
  }
  const budget = source.schema.fields.find(
    /**
     * 实际支出沿用预算字段的阅读约束，防止从执行汇报旁路读取金额。
     * @param field 字段
     * @returns 是否为预算
     */
    function budgetField(field) {
      return field.key === 'budget';
    },
  );
  if (
    safe.activity.report &&
    budget &&
    (!canAccessField(config, actor, source, budget) ||
      (exporting &&
        isSensitiveField(config, budget) &&
        !hasScopedDataPermission(config, actor, source, 'activity:sensitive:export')))
  )
    safe.activity.report.spend = '';
  for (const field of source.schema.fields)
    if (
      isSensitiveField(config, field) &&
      canAccessField(config, actor, source, field) &&
      current.payload[field.key] &&
      !current.hidden.includes(field.key)
    )
      containsSensitive = true;
  safe.access = {
    readableNodeIds: [...readable],
    uploadNodeIds: [...new Set(upload)],
    hiddenFieldKeys: current.hidden,
    containsSensitive,
  };
  return safe;
}

/**
 * 为新建申请构造最小活动上下文，用同一规则过滤会话和模板中的默认表单。
 * @param config 当前组织
 * @param actor 当前申请人
 * @param form 发布表单
 * @returns 申请人有权填写的表单，隐藏默认值不下发
 */
export function applicantForm(config: CompanyConfig, actor: string, form: FormDefinition): FormDefinition {
  const values: Record<string, string> = {};
  for (const field of form.fields) values[field.key] = field.default;
  const activity: Activity = {
    id: '',
    code: '',
    applicant: actor,
    department: findById(config.users, actor)?.department || '',
    name: '',
    status: 'draft',
    version: 1,
    structureRevision: 1,
    revision: 0,
    configVersion: config.version,
    schema: form,
    payload: values,
    snapshots: [],
    nodes: [],
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
  const projected = projectFormData(config, actor, activity, form, values);
  for (const field of projected.schema.fields)
    field.default = field.redacted ? '' : projected.payload[field.key] || '';
  return projected.schema;
}

/**
 * 切换模板版本或重新提交时保留已有数据的字段约束，避免用新版宽权限表单重新包装旧敏感值。
 * @param previous 活动现有冻结表单
 * @param next 新模板表单
 * @returns 带历史约束交集的新表单
 */
export function preserveFormAccess(previous: FormDefinition, next: FormDefinition): FormDefinition {
  const result = structuredClone(next);
  for (const field of result.fields) {
    const original = previous.fields.find(
      /**
       * 通过稳定字段键定位需保留的原数据权限。
       * @param item 原字段
       * @returns 是否同键
       */
      function same(item) {
        return item.key === field.key;
      },
    );
    if (!original) continue;
    const rules = [
      ...(original.accessConstraints || []),
      ...(original.access ? [original.access] : []),
      ...(field.accessConstraints || []),
    ];
    const unique = new Map<string, NonNullable<FormField['access']>>();
    for (const rule of rules)
      if (rule.read.mode === 'restricted' || rule.write?.mode === 'restricted')
        unique.set(JSON.stringify(rule), rule);
    if (unique.size) field.accessConstraints = [...unique.values()];
  }
  return result;
}
