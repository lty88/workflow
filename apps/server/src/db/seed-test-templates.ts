import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  activeMember,
  defaultValues,
  findById,
  hasPermission,
  instantiateWorkflow,
  templateContext,
  templateDefinitionSchema,
  validateForm,
  validateTemplate,
} from '@workflow/domain';
import type { CompanyConfig, FormDefinition, NodeDefinition, WorkflowTemplate } from '@workflow/domain';
import { readEnv } from '../env';
import { createPool, loadConfig, query } from './repository';
import { loadActivityTypes, loadTemplates, loadTemplateRelease } from './template-repository';
import { createTemplate, publishTemplate, saveTemplate } from '../services/template-service';
import { buildTestTemplateCatalog } from './test-template-catalog';
import type { TestTemplatePlan } from './test-template-catalog';
import { digest } from '../services/auth';

interface SeedResult {
  code: string;
  id: string;
  name: string;
  version: number;
  active: boolean;
  status: 'created' | 'existing';
  nodes: number;
}
/** 为当前真实表单生成可试填的数据，保留费用联动和未来时间，不创建任何活动。
 * @param form 当前表单定义
 * @returns 包含自定义必填字段的示例输入
 */
function samplePayload(form: FormDefinition): Record<string, string> {
  const payload = defaultValues(form);
  for (const field of form.fields) {
    if (payload[field.key] || field.type === 'attachment') continue;
    if (field.type === 'number') payload[field.key] = '0';
    else if (field.type === 'select' || field.type === 'checkboxes')
      payload[field.key] = field.options[0] || '';
    else if (field.type === 'datetime')
      payload[field.key] = new Date(Date.now() + 7 * 86400000).toISOString();
    else if (field.required) payload[field.key] = `测试填写：${field.label}`;
  }
  const start = new Date(Date.now() + 30 * 60000);
  start.setSeconds(0, 0);
  Object.assign(payload, {
    activity_name: '流程测试活动',
    delivery_mode: '线下',
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 3 * 3600000).toISOString(),
    location: '测试会议室',
    meeting_url: 'https://example.com/meeting/test',
    background: '验证公司内部活动协作流程',
    agenda: '09:00签到；09:30案例交流；11:00总结',
    people: '30',
    contact: '测试联系人',
    contact_info: '13800000001',
    arranger: '测试安排人',
    arranger_info: '13800000002',
    receiver: '测试接收人',
    receiver_info: '13800000003',
    expert_fee: '1000',
    conference_fee: '500',
    travel_fee: '300',
    budget: '1800',
    testfiled: '测试流程模板填写数据',
  });
  return payload;
}
/** 取得当前办理规则实际对应的账号，生成可直接按账号切换的测试说明。
 * @param config 当前组织和权限
 * @param plan 模板方案
 * @param applicant 统一发起人ID
 * @param payload 路线输入
 * @returns 每个节点的条件命中、依赖和受理账号
 */
function routeFor(
  config: CompanyConfig,
  plan: TestTemplatePlan,
  applicant: string,
  payload: Record<string, string>,
) {
  const checked = validateForm(config.form, payload);
  const route = instantiateWorkflow(
    templateContext(config, plan.definition, config.form),
    checked.payload,
    applicant,
    { requireApproval: false },
  );
  if (route.errors.length) throw new Error(`${plan.definition.name}路线无效：${route.errors.join('；')}`);
  const nodes = [];
  for (const definition of plan.definition.nodes) {
    const instance = route.nodes.find(
      /** 按稳定节点键定位路线结果。
       * @param node 运行时节点
       * @returns 是否对应当前定义
       */ function same(node) {
        return node.key === definition.id;
      },
    );
    if (!instance) throw new Error('路线未返回完整节点');
    const accounts: string[] = [];
    for (const id of instance.assignees) accounts.push(findById(config.users, id)?.username || id);
    nodes.push({
      key: definition.id,
      label: definition.label,
      kind: definition.kind,
      deps: definition.deps,
      condition: definition.condition,
      skipped: instance.status === 'skipped',
      accounts,
    });
  }
  return { payload: checked.payload, formErrors: checked.errors, nodes };
}
/** 将测试步骤、真实受理账号和输入矩阵整理成项目内可复用测试手册。
 * @param config 当前组织权限
 * @param plans 完整模板方案
 * @param results 数据库创建或保留结果
 * @param applicant 统一测试发起人ID
 * @param sample 示例表单输入
 * @returns 中文Markdown测试手册
 */
function manualFor(
  config: CompanyConfig,
  plans: TestTemplatePlan[],
  results: SeedResult[],
  applicant: string,
  sample: Record<string, string>,
): string {
  const lines = [
    '# 审批流程测试模板与操作手册',
    '',
    '本批次只建立并发布测试模板，不自动创建活动、不代替任何账号审批。测试模板不设默认推荐，全部适用于现有启用活动类型，授权拥有“活动发起人”角色的账号使用。',
    '',
    '## 先从这里开始',
    '',
    '1. 刷新流程模板列表，可看到“测试01”至“测试10”，均为启用、已发布版本。',
    '2. 用 **sichuan1** 登录发起活动，选择“教研交流”，再选测试模板。admin用于配置管理；本批次不修改任何账号角色、密码或权限。',
    '3. 填写下方样例；日期使用实际当前时间之后，结束时间晚于开始时间。自定义必填字段也要填写。',
    '4. 点击下一步会校验当前步骤；检查并提交时先计算实际路线，再提交申请。',
    '5. 按每套模板的账号表切换登录，从“我的待办”办理；可使用不同浏览器隔离账号，或逐个退出登录。',
    '6. 简单模板优先。会签模板会产生较多待办，建议最后测试。',
    '',
    '## 通用表单数据',
    '',
    '预算总额由专家费、会务费、差旅费自动合计，不单独修改预算总额。收费培训需填写培训内容；线上或混合活动按表单要求填写会议链接。',
    '',
    '| 字段 | 示例 |',
    '| --- | --- |',
  ];
  for (const field of config.form.fields) {
    const value = sample[field.key];
    if (field.type === 'attachment') {
      lines.push(
        `| ${field.label} | ${field.required ? '必填：上传符合该字段限制的测试文件' : '可选：按需上传测试文件'} |`,
      );
      continue;
    }
    if (value)
      lines.push(
        `| ${field.label} | ${(field.type === 'datetime' ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) : value).replaceAll('|', '／').replaceAll('\n', '；')} |`,
      );
  }
  lines.push(
    '',
    '机器可读输入见同目录“模板与测试数据.json”。ISO日期在页面会按本地时间显示；手工测试时直接在日期控件选择未来日期。',
    '',
    '## 各模板流程与账号',
    '',
  );
  for (const plan of plans) {
    const result = results.find(
      /** 定位本模板的实际发布结果。
       * @param item 数据库结果
       * @returns 是否对应当前编码
       */ function same(item) {
        return item.code === plan.code;
      },
    )!;
    const route = routeFor(config, plan, applicant, sample);
    lines.push(
      '',
      `### ${plan.definition.name}`,
      '',
      `${plan.purpose}。编码：\`${plan.code}\`；版本：V${result.version}。`,
      '',
      '| 节点 | 类型 | 前置（全部完成） | 实际账号 |',
      '| --- | --- | --- | --- |',
    );
    for (const node of route.nodes) {
      const parents: string[] = [];
      for (const dep of node.deps)
        parents.push(
          plan.definition.nodes.find(
            /** 将依赖键转换成节点名便于手工阅读。
             * @param item 模板节点
             * @returns 是否当前前置
             */ function same(item) {
              return item.id === dep;
            },
          )!.label,
        );
      lines.push(
        `| ${node.label} | ${{ approval: '审批', task: '任务', notice: '知会' }[node.kind]} | ${parents.join('＋') || '提交后进入'} | ${node.accounts.join('、') || '当前样例未命中条件；见下方变体'} |`,
      );
    }
    for (const testCase of plan.cases) {
      lines.push('', `**${testCase.name}**`, '');
      if (Object.keys(testCase.payload).length)
        lines.push(`覆盖输入：\`${JSON.stringify(testCase.payload)}\`。`, '');
      for (const check of testCase.checks) lines.push(`- ${check}`);
    }
  }
  lines.push(
    '',
    '## 每套模板都可追加的异常测试',
    '',
    '| 场景 | 操作 | 预期 |',
    '| --- | --- | --- |',
    '| 无权办理 | 使用非受理人的普通员工查看或调用办理接口 | 无可办理操作，接口拒绝 |',
    '| 重复提交或双击 | 网络慢时重复提交同一操作 | 沿用幂等处理，不重复创建任务 |',
    '| 并发办理 | 同一任务在两个窗口打开，分别提交 | 后提交使用旧版本时提示冲突 |',
    '| 退回重提 | 审批节点退回，申请人补充后重提 | 新轮次生效，旧待办取消且保留历史 |',
    '| 拒绝 | 任一审批人拒绝 | 当前审批结束，未办任务取消 |',
    '| 撤回 | 申请人在可撤回状态撤回后重新提交 | 原轮失效，新轮重新生成 |',
    '| 条件被跳过 | 使用测试05的四组数据 | 只办理生效分支，跳过分支不造成死锁 |',
    '| 加签/转交 | 协调人或具备资格的办理人操作，填写原因 | 实例依赖和待办正确更新，模板版本不变 |',
    '| 附件 | 使用已含附件字段的表单版本，上传、移除及重进页面 | 必填、类型、数量、大小和字段权限均生效 |',
    '',
    '任务、知会节点没有“退回/拒绝”的审批含义。仅知会模板没有审批轮待办，但仍需后续指派和执行，不能把“待指派”当成“活动已完成”。',
    '',
    '## 审批后的执行、归档和评价',
    '',
    '1. 所有生效审批/任务完成后，由 **xingzhengrenshi** 在待指派活动中指定 **sichuan2** 执行。',
    '计划开始时间到达后才能开始执行。样例时间为导入时刻之后约30分钟；后续新建活动时请重新选择未来时间。',
    '3. **sichuan2** 开始执行，完成后填写实际人数和执行汇报，提交真实用于测试的执行资料。',
    '4. **sichuan1** 补齐归档资料并提交，归档审核选择 **xingzhengrenshi**。',
    '5. **xingzhengrenshi** 检查后归档，领导 **yuanlingdao** 查看领导看板数据。',
    '6. 归档后按活动评价入口生成二维码或链接，使用未登录窗口提交评价，查看评分汇总。',
    '',
    '## 敏感内容与通知',
    '',
    '- 测试09：财务上传的是财务节点附件，内部说明受节点权限限制；公共结论及节点进度可按系统规则展示。单独附件可继续收紧查看与下载。',
    '- 知会自动产生站内通知，收件人在系统通知入口查看。语音提醒依赖当前浏览器已启用播报；未读状态和通知阅读不影响流程继续。',
    '- 如果当前表单尚无附件上传字段，本批模板不会擅自添加全局字段。先配置附件字段，再发布需要使用它的模板新版本。',
    '',
    '## 重复执行和维护',
    '',
    '`pnpm db:seed-test-templates -- --dry-run` 可先校验；`pnpm db:seed-test-templates` 可补齐缺少的模板。已存在的同编码已发布模板会保留，不覆盖人工修改；存在未发布同编码草稿时明确停止，避免覆盖。',
    '新增模板均调用既有创建、保存、发布服务，保留修订、发布快照和审计记录；不改默认模板，不改角色与组织，不创建活动。',
  );
  return lines.join('\n') + '\n';
}
/** 校验所有测试方案及输入后，通过既有模板服务创建并发布，写出实际账号路线和操作手册。
 */
async function seedTestTemplates(): Promise<void> {
  const env = readEnv();
  if (env.NODE_ENV === 'production') throw new Error('测试模板导入仅用于开发或测试环境');
  const pool = createPool(env);
  const dryRun = process.argv.includes('--dry-run');
  try {
    const config = (await loadConfig(pool)).published;
    const types = await loadActivityTypes(pool);
    const plans = buildTestTemplateCatalog(config, types);
    const existing = await loadTemplates(pool);
    const actor = config.users.find(
      /** 选择具备配置管理权限的有效管理员作为导入审计人。
       * @param user 当前人员
       * @returns 是否有模板管理资格
       */ function administrator(user) {
        return activeMember(config, user.id) && hasPermission(config, user.id, 'config:manage');
      },
    );
    const applicant = config.users.find(
      /** 取得测试手册统一发起账号。
       * @param user 当前成员
       * @returns 是否为默认测试发起人
       */ function match(user) {
        return user.username === 'sichuan1';
      },
    )!;
    if (!actor) throw new Error('没有有效的模板管理员');
    const sample = samplePayload(config.form);
    const errors: string[] = [];
    for (const plan of plans) {
      templateDefinitionSchema.parse(plan.definition);
      for (const error of validateTemplate(config, plan.definition, types))
        errors.push(`${plan.definition.name}：${error}`);
      for (const testCase of plan.cases)
        routeFor(config, plan, applicant.id, { ...sample, ...testCase.payload });
      const old = existing.find(
        /** 检查编码是否由管理员已维护过。
         * @param item 现有模板
         * @returns 是否同编码
         */ function same(item) {
          return item.code === plan.code;
        },
      );
      if (old && !old.currentVersion) errors.push(`${plan.code}已有未发布草稿，请先处理该草稿，导入不会覆盖`);
    }
    if (errors.length) throw new Error([...new Set(errors)].join('\n'));
    const warnings = validateForm(config.form, sample).errors;
    console.info(
      JSON.stringify({
        mode: dryRun ? 'dry-run' : 'import',
        plans: plans.length,
        applicant: applicant.username,
        formWarnings: warnings,
        plannedNodes: plans.map(planCount),
      }),
    );
    if (dryRun) return;
    const output = fileURLToPath(new URL('../../../../docs/测试审批模板-20261023/', import.meta.url));
    await mkdir(output, { recursive: true });
    const results: SeedResult[] = [];
    for (const plan of plans) {
      let template: WorkflowTemplate | undefined = existing.find(
        /** 已存在的同编码发布版本保持原样。
         * @param item 现有模板
         * @returns 是否同编码
         */ function same(item) {
          return item.code === plan.code;
        },
      );
      const status = template ? 'existing' : 'created';
      if (!template) {
        const created = await createTemplate(pool, actor.id, {
          code: plan.code,
          idempotencyKey: `test-catalog-v1:${plan.code}:create`,
        });
        const saved = await saveTemplate(pool, actor.id, created.id, {
          definition: plan.definition,
          expectedDraftRevision: created.draftRevision,
          idempotencyKey: `test-catalog-v1:${plan.code}:save:${digest(JSON.stringify(plan.definition)).slice(0, 12)}`,
        });
        template = await publishTemplate(pool, actor.id, created.id, {
          expectedDraftRevision: saved.draftRevision,
          idempotencyKey: `test-catalog-v1:${plan.code}:publish:${saved.draftRevision}`,
        });
      }
      const release = await loadTemplateRelease(pool, template.id, template.currentVersion);
      if (!release) throw new Error(`${plan.code}发布快照缺失`);
      results.push({
        code: template.code,
        id: template.id,
        name: template.published!.name,
        version: template.currentVersion,
        active: template.active,
        status,
        nodes: release.definition.nodes.length,
      });
      await writeFile(
        output + '/实际导入结果.json',
        JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n',
      );
    }
    const variants = [];
    for (const plan of plans)
      for (const testCase of plan.cases)
        variants.push({
          code: plan.code,
          name: testCase.name,
          checks: testCase.checks,
          ...routeFor(config, plan, applicant.id, { ...sample, ...testCase.payload }),
        });
    const counts = await query(
      pool,
      'SELECT (SELECT COUNT(*) FROM activities) AS activities,(SELECT COUNT(*) FROM roles) AS roles,(SELECT COUNT(*) FROM departments) AS departments,(SELECT COUNT(*) FROM members) AS members',
    );
    await writeFile(
      output + '/模板与测试数据.json',
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          applicant: { username: applicant.username, id: applicant.id },
          samplePayload: sample,
          formWarnings: warnings,
          plans,
          variants,
          results,
          counts,
        },
        null,
        2,
      ) + '\n',
    );
    await writeFile(output + '/测试步骤.md', manualFor(config, plans, results, applicant.id, sample));
    console.info(
      JSON.stringify({
        created: results.filter(isCreated).length,
        existing: results.length - results.filter(isCreated).length,
        results,
        counts,
        manual: output + '/测试步骤.md',
      }),
    );
  } finally {
    await pool.end();
  }
}
/** 汇总计划中的节点规模。
 * @param plan 测试模板
 * @returns 编码和节点数量
 */
function planCount(plan: TestTemplatePlan) {
  return { code: plan.code, nodes: plan.definition.nodes.length };
}
/** 判断是否为本次新创建的模板。
 * @param result 模板导入结果
 * @returns 是否新增
 */
function isCreated(result: SeedResult): boolean {
  return result.status === 'created';
}
await seedTestTemplates();
