import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, PERMISSIONS } from './constants';
import type { Permission } from './types';

const id = z.string().min(1).max(80);
const condition = z
  .object({
    field: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    operator: z.enum(['eq', 'neq', 'gte']),
    value: z.string().max(300),
  })
  .strict();
const assignee = z
  .object({ type: z.enum(['manager', 'department_manager', 'role', 'user']), value: z.string().max(80) })
  .strict();
const permission = z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]]);
export const dataAccessRuleSchema = z
  .object({
    mode: z.enum(['shared', 'restricted']),
    roleIds: z.array(id).max(100),
    userIds: z.array(id).max(1000),
    applicant: z.boolean().optional(),
    executor: z.boolean().optional(),
    departmentManager: z.boolean().optional(),
    nodeAssignees: z.boolean().optional(),
  })
  .strict();
export const fileAccessInputSchema = z
  .object({
    contextId: z.uuid().optional(),
    actionKey: z.string().min(1).max(40).optional(),
    fieldKey: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,39}$/)
      .optional(),
    nodeId: id.optional(),
    access: dataAccessRuleSchema.optional(),
    downloadAccess: dataAccessRuleSchema.optional(),
  })
  .strict();
export const nodeApprovalPolicySchema = z
  .object({
    returnEnabled: z.boolean(),
    returnScope: z.enum(['previous', 'selected']),
    returnNodeIds: z.array(id).max(80),
    returnToApplicant: z.boolean(),
    allowTerminate: z.boolean(),
    rating: z.enum(['off', 'optional', 'required']),
  })
  .strict();
export const lifecycleSchema = z.object({
  businessType: z.enum(['activity', 'general']),
  afterApproval: z.enum(['complete', 'activity_standard']),
  version: z.literal(1),
}).strict();
export const configSchema = z
  .object({
    version: z.number().int().positive(),
    departments: z
      .array(
        z
          .object({
            id,
            name: z.string().trim().min(1).max(60),
            parent: z.string().max(80),
            manager: z.string().max(80),
            active: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    users: z
      .array(
        z
          .object({
            id,
            name: z.string().trim().min(1).max(50),
            username: z.string().regex(/^[a-zA-Z0-9_.-]{3,50}$/),
            department: id,
            roles: z.array(id).max(30),
            active: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    roles: z
      .array(
        z
          .object({
            id,
            name: z.string().trim().min(1).max(50),
            permissions: z.array(permission).max(30),
            scope: z.enum(['self', 'department', 'department_tree', 'tasks', 'all']),
            pages: z.array(id).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    groups: z
      .array(z.object({ id, name: z.string().trim().min(1).max(50), active: z.boolean() }).strict())
      .min(1)
      .max(30),
    pages: z
      .array(
        z
          .object({
            id,
            name: z.string().trim().min(1).max(50),
            group: id,
            component: z.enum([
              'summary',
              'activity_list',
              'activity_form',
              'task_list',
              'archive_list',
              'config_overview',
              'leadership_dashboard',
            ]),
            formId: z.string().max(80).optional(),
            active: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    form: z
      .object({
        id,
        businessType: z.enum(['activity', 'general']).optional(),
        name: z.string().trim().min(1).max(80),
        fields: z
          .array(
            z
              .object({
                id,
                key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
                label: z.string().min(1).max(80),
                type: z.enum([
                  'text',
                  'textarea',
                  'number',
                  'select',
                  'datetime',
                  'checkboxes',
                  'attachment',
                ]),
                upload: z
                  .object({
                    maxCount: z.number().int().min(1).max(10),
                    maxSizeMB: z.number().int().min(1).max(20),
                    extensions: z
                      .array(z.enum(['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx']))
                      .min(1)
                      .max(6),
                  })
                  .strict()
                  .optional(),
                required: z.boolean(),
                default: z.string().max(3000),
                options: z.array(z.string().min(1).max(100)).max(100),
                visible: condition.optional(),
                system: z.boolean().optional(),
                access: z
                  .object({
                    read: dataAccessRuleSchema,
                    write: dataAccessRuleSchema.optional(),
                    mask: z.enum(['hidden', 'partial']),
                  })
                  .strict()
                  .optional(),
              })
              .strict(),
          )
          .min(1)
          .max(80),
      })
      .strict(),
    workflow: z
      .object({
        name: z.string().trim().min(1).max(80),
        ratingEnabled: z.boolean().optional(),
        lifecycle: lifecycleSchema.optional(),
        nodes: z
          .array(
            z
              .object({
                id,
                label: z.string().trim().min(1).max(80),
                kind: z.enum(['approval', 'task', 'notice']),
                deps: z.array(id).max(100),
                assignee,
                approvalPolicy: nodeApprovalPolicySchema.optional(),
                condition: condition.optional(),
                protected: z.boolean().optional(),
                access: dataAccessRuleSchema.optional(),
                downloadAccess: dataAccessRuleSchema.optional(),
              })
              .strict(),
          )
          .min(1)
          .max(80),
      })
      .strict(),
  })
  .strict();

export const payloadSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), z.string());
export const loginSchema = z
  .object({ username: z.string().min(3).max(50), password: z.string().min(1).max(200) })
  .strict();
export const versionSchema = z
  .object({ expectedVersion: z.number().int().positive(), idempotencyKey: z.string().min(16).max(100) })
  .strict();
export const fileAccessWriteSchema = versionSchema
  .extend({ access: dataAccessRuleSchema.optional(), downloadAccess: dataAccessRuleSchema.optional() })
  .strict();
export const draftSchema = z
  .object({
    payload: payloadSchema,
    expectedVersion: z.number().int().positive().optional(),
    activityTypeId: id.optional(),
    templateId: id.optional(),
    expectedTemplateVersion: z.number().int().positive().optional(),
  })
  .strict();
export const submitSchema = versionSchema.extend({
  expectedTemplateVersion: z.number().int().positive().optional(),
});
export const decisionSchema = z
  .object({
    attachmentContextId: z.uuid().optional(),
    decision: z.enum(['approve', 'return', 'reject']),
    returnTargetId: id.optional(),
    expectedTargetGeneration: z.number().int().positive().optional(),
    ratings: z
      .array(
        z
          .object({
            nodeId: id,
            generation: z.number().int().positive(),
            score: z.number().int().min(0).max(100),
          })
          .strict(),
      )
      .max(80)
      .optional(),
    comment: z.string().trim().default(''),
    publicComment: z.string().trim().optional(),
    expectedTaskVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(16).max(100),
  })
  .strict();
export type DecisionCommand = Omit<z.infer<typeof decisionSchema>, 'idempotencyKey'>;
export const transferSchema = z
  .object({
    attachmentContextId: z.uuid().optional(),
    assignee: id,
    reason: z.string().trim().min(1, '请填写原因'),
    expectedTaskVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(16).max(100),
  })
  .strict();
export type TransferCommand = Omit<z.infer<typeof transferSchema>, 'idempotencyKey'>;
export const adjustmentSchema = z
  .object({
    attachmentContextId: z.uuid().optional(),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['approval', 'task', 'notice']),
    assignee,
    anchor: id,
    position: z.enum(['before', 'after', 'parallel']),
    reason: z.string().trim().min(1, '请填写原因'),
    expectedStructureRevision: z.number().int().positive(),
    idempotencyKey: z.string().min(16).max(100),
  })
  .strict();
export const reportSchema = z
  .object({
    title: z.string().trim().optional(),
    start: z.string().trim().min(1, '请选择实际开始时间'),
    end: z.string().trim().min(1, '请选择实际结束时间'),
    people: z.number().int().min(0).max(100000),
    summary: z.string().trim().min(1, '请填写执行情况与成果'),
    spend: z.string().max(30).default(''),
    exception: z.string().trim().default(''),
  })
  .strict();
export const actionSchema = z
  .object({
    attachmentContextId: z.uuid().optional(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(16).max(100),
    action: z.enum([
      'withdraw',
      'assign',
      'start',
      'report',
      'execution-complete',
      'archive-submit',
      'archive-approve',
      'archive-return',
      'cancel-request',
      'cancel-approve',
      'cancel-reject',
      'cancel-withdraw',
    ]),
    comment: z.string().trim().default(''),
    executor: z.string().max(80).optional(),
    report: reportSchema.optional(),
    url: z.string().max(1000).optional(),
    checks: z.array(z.boolean()).max(3).optional(),
    disposal: z.string().trim().optional(),
  })
  .strict();
export type ActionCommand = Omit<z.infer<typeof actionSchema>, 'idempotencyKey'>;
export const passwordSchema = z.object({ password: z.string().min(PASSWORD_MIN_LENGTH).max(200) }).strict();
export const listQuerySchema = z.object({
  businessType: z.enum(['activity', 'general']).optional(),
  q: z.string().max(100).default(''),
  status: z.string().max(40).default(''),
  scope: z.enum(['all', 'mine', 'tasks', 'archives']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
