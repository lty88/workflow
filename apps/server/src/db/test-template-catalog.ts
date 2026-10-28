import { activeMember, defaultApprovalPolicy, hasPermission, topological } from '@workflow/domain';
import type {
  ActivityType,
  AssigneeRule,
  CompanyConfig,
  NodeDefinition,
  TemplateDefinition,
  TemplateLayout,
} from '@workflow/domain';
export interface TestTemplateCase {
  name: string;
  payload: Record<string, string>;
  checks: string[];
}
export interface TestTemplatePlan {
  code: string;
  definition: TemplateDefinition;
  purpose: string;
  cases: TestTemplateCase[];
}
/** 按依赖层级展开模板坐标，并行节点横向排列，长链保持固定可读间距。
 * @param nodes 模板业务节点
 * @returns 自上而下的画布位置
 */
function layoutFor(nodes: NodeDefinition[]): TemplateLayout {
  const checked = topological(nodes);
  if (checked.error) throw new Error(checked.error);
  const depths = new Map<string, number>();
  const layers = new Map<number, NodeDefinition[]>();
  for (const node of checked.order) {
    let depth = 0;
    for (const dep of node.deps) depth = Math.max(depth, (depths.get(dep) || 0) + 1);
    depths.set(node.id, depth);
    const layer = layers.get(depth) || [];
    layer.push(node);
    layers.set(depth, layer);
  }
  const positions: TemplateLayout['positions'] = {};
  for (const [depth, layer] of layers)
    for (let index = 0; index < layer.length; index++)
      positions[layer[index]!.id] = { x: (index - (layer.length - 1) / 2) * 440, y: depth * 180 + 160 };
  return { direction: 'TB', positions };
}
/** 使用既有真实部门和测试账号生成覆盖串行、并行、条件、任务、知会、会签与隐私的十套模板，不新增角色或人员。
 * @param config 当前组织、权限和表单
 * @param types 已维护的活动类型
 * @returns 可由标准模板服务创建及发布的测试目录
 */
export function buildTestTemplateCatalog(config: CompanyConfig, types: ActivityType[]): TestTemplatePlan[] {
  const typeIds: string[] = [];
  for (const type of types) if (type.active) typeIds.push(type.id);
  if (!typeIds.length) throw new Error('至少需要一个已启用的活动类型');
  const applicant = config.users.find(
    /** 定位测试手册的统一发起账号。
     * @param user 当前人员
     * @returns 是否为有效的测试发起人
     */ function match(user) {
      return (
        user.username === 'sichuan1' &&
        activeMember(config, user.id) &&
        hasPermission(config, user.id, 'activity:create')
      );
    },
  );
  if (!applicant) throw new Error('缺少可发起活动的sichuan1账号，请先检查组织测试账号');
  /** 创建指定部门负责人规则，防止节点名与真实受理部门不一致。
   * @param name 部门名称
   * @returns 有效部门负责人受理规则
   */
  function department(name: string): AssigneeRule {
    const matches = config.departments.filter(
      /** 匹配唯一启用部门。
       * @param item 当前部门
       * @returns 是否匹配
       */ function match(item) {
        return item.name === name && item.active;
      },
    );
    if (matches.length !== 1) throw new Error(`测试模板需要唯一启用的${name}`);
    const item = matches[0]!;
    if (!activeMember(config, item.manager) || !hasPermission(config, item.manager, 'approval:decide'))
      throw new Error(`${name}缺少有效负责人或审核权限`);
    return { type: 'department_manager', value: item.id };
  }
  /** 从已有编号员工中选出办理任务的账号。
   * @param username 已维护的测试账号
   * @returns 指定人员受理规则
   */
  function person(username: string): AssigneeRule {
    const member = config.users.find(
      /** 匹配具备任务权限的有效员工。
       * @param user 当前人员
       * @returns 是否匹配
       */ function match(user) {
        return (
          user.username === username &&
          activeMember(config, user.id) &&
          hasPermission(config, user.id, 'task:complete')
        );
      },
    );
    if (!member) throw new Error(`缺少可办理任务的账号：${username}`);
    return { type: 'user', value: member.id };
  }
  const own: AssigneeRule = { type: 'manager', value: '' };
  const leader: AssigneeRule = { type: 'role', value: 'director' };
  const coordinator: AssigneeRule = { type: 'role', value: 'coordinator' };
  const finance = department('财务部');
  const research = department('教研组');
  const marketing = department('营销中心');
  const quality = department('教学质量部');
  const design = person('sheji1');
  const printing = person('yinzhi1');
  const tech = person('jishuyanfa1');
  const marketingWorker = person('yingxiao1');
  /** 创建单个业务节点，前置关系为全部完成后激活。
   * @param id 模板内稳定节点键
   * @param label 节点名称
   * @param kind 业务节点类型
   * @param assignee 受理规则
   * @param deps 前置节点键
   * @returns 节点定义
   */
  function node(
    id: string,
    label: string,
    kind: NodeDefinition['kind'],
    assignee: AssigneeRule,
    deps: string[] = [],
  ): NodeDefinition {
    return { id, label, kind, assignee: { ...assignee }, deps };
  }
  const catalog: TestTemplatePlan[] = [];
  /** 添加一套已命名、按当前活动类型授权且不占默认推荐的测试模板。
   * @param code 唯一测试编码
   * @param name 显示名称
   * @param purpose 覆盖目标
   * @param nodes 依赖图
   * @param cases 输入变体与预期检查点
   */
  function add(
    code: string,
    name: string,
    purpose: string,
    nodes: NodeDefinition[],
    cases: TestTemplateCase[],
  ): void {
    catalog.push({
      code,
      purpose,
      cases,
      definition: {
        name,
        activityTypeIds: [...typeIds],
        defaultForTypeIds: [],
        departmentIds: [],
        roleIds: ['applicant'],
        nodes,
        layout: layoutFor(nodes),
      },
    });
  }
  add(
    'test-01-simple',
    '测试01｜极简单级审批',
    '快速验证申请、审批及后续执行闭环',
    [node('review', '申请人部门负责人审批', 'approval', own)],
    [
      {
        name: '正常通过',
        payload: {},
        checks: ['sichuan1提交后仅sichuan获得审批待办', '通过后进入待指派，由xingzhengrenshi指派执行人'],
      },
      {
        name: '撤回、退回与拒绝',
        payload: {},
        checks: [
          '分别新建三次活动测试撤回、退回补充和拒绝',
          '退回后补充重提会生成新一轮，旧轮任务失效',
          '拒绝后结束审批，不进入执行',
        ],
      },
    ],
  );
  add(
    'test-02-standard',
    '测试02｜常规跨部门串行',
    '部门、教研、财务、领导依次审批并知会协调人',
    [
      node('review', '申请人部门初审', 'approval', own),
      node('research', '教研方案审核', 'approval', research, ['review']),
      node('finance', '财务预算审核', 'approval', finance, ['research']),
      node('leader', '院领导终审', 'approval', leader, ['finance']),
      node('notice', '知会流程协调人', 'notice', coordinator, ['leader']),
    ],
    [
      {
        name: '完整串行',
        payload: {},
        checks: [
          'sichuan→jiaoyan→caiwu→yuanlingdao依次获得待办',
          '后续节点不可提前办理',
          '知会发送站内通知且不需要手动确认',
        ],
      },
    ],
  );
  add(
    'test-03-task-first',
    '测试03｜任务先行再审核',
    '首节点是任务，任务完成后产生审批并发送知会',
    [
      node('prepare', '技术准备资料', 'task', tech),
      node('quality', '教学质量审核', 'approval', quality, ['prepare']),
      node('notice', '知会营销负责人', 'notice', marketing, ['quality']),
    ],
    [
      {
        name: '任务和审批区分',
        payload: {},
        checks: [
          'jishuyanfa1办理首节点，操作为完成任务',
          '完成后jiaoxuezhiliang审核，操作为通过、退回或拒绝',
          'yingxiao仅收到知会，不出现需审批的待办',
        ],
      },
    ],
  );
  add(
    'test-04-parallel',
    '测试04｜双分支并行汇合',
    '初审后教研和财务同时审核，领导等待两者完成',
    [
      node('review', '申请人部门初审', 'approval', own),
      node('research', '教研方案并审', 'approval', research, ['review']),
      node('finance', '财务预算并审', 'approval', finance, ['review']),
      node('leader', '双分支完成后领导终审', 'approval', leader, ['research', 'finance']),
    ],
    [
      {
        name: '先教研后财务',
        payload: {},
        checks: [
          '初审后jiaoyan和caiwu同时有待办',
          '只通过教研时，领导节点仍等待财务',
          '两个分支均完成才产生领导待办',
        ],
      },
      { name: '反向办理', payload: {}, checks: ['重新发起，先财务后教研，结果一致'] },
      {
        name: '并行分支退回',
        payload: {},
        checks: ['任一分支退回，其他未完成待办取消', '申请补充后重提，新一轮重新产生待办'],
      },
    ],
  );
  const budget = node('finance', '预算达到10000元才财务审核', 'approval', finance, ['review']);
  budget.condition = { field: 'budget', operator: 'gte', value: '10000' };
  const training = node('training', '收费培训营销专项审核', 'approval', marketing, ['review']);
  training.condition = { field: 'service_type', operator: 'eq', value: '收费课题培训' };
  add(
    'test-05-conditions',
    '测试05｜金额与业务条件分支',
    '验证阈值边界、条件跳过和多条件汇合',
    [
      node('review', '申请人部门初审', 'approval', own),
      budget,
      training,
      node('leader', '生效分支完成后领导终审', 'approval', leader, ['review', 'finance', 'training']),
    ],
    [
      {
        name: '低预算免费',
        payload: { expert_fee: '9999', conference_fee: '0', travel_fee: '0', service_type: '免费课题服务' },
        checks: ['财务和培训专项均跳过', '部门审批后直接到领导'],
      },
      {
        name: '阈值10000元',
        payload: { expert_fee: '10000', conference_fee: '0', travel_fee: '0', service_type: '免费课题服务' },
        checks: ['财务必须生效', '培训专项跳过'],
      },
      {
        name: '低预算收费培训',
        payload: {
          expert_fee: '9999',
          conference_fee: '0',
          travel_fee: '0',
          service_type: '收费课题培训',
          training: '线上培训2小时，含案例研讨',
        },
        checks: ['财务跳过，营销专项必须生效'],
      },
      {
        name: '高预算收费培训',
        payload: {
          expert_fee: '12000',
          conference_fee: '0',
          travel_fee: '0',
          service_type: '收费课题培训',
          training: '线下培训半天，含分组研修',
        },
        checks: ['财务与营销专项并行，全部完成再到领导'],
      },
    ],
  );
  add(
    'test-06-cross',
    '测试06｜复杂交错协作',
    '多次拆分汇合，审批、任务与非阻断知会交错',
    [
      node('review', '申请人部门初审', 'approval', own),
      node('research', '教研方案审核', 'approval', research, ['review']),
      node('finance', '财务预算审核', 'approval', finance, ['review']),
      node('design', '制作活动视觉方案', 'task', design, ['research']),
      node('marketing', '营销与校方确认', 'approval', marketing, ['research']),
      node('tech', '技术方案联调', 'task', tech, ['research', 'finance']),
      node('printing', '印制活动材料', 'task', printing, ['design', 'finance']),
      node('quality', '教学质量复核', 'approval', quality, ['tech', 'marketing']),
      node('notice', '预算确认后知会协调人', 'notice', coordinator, ['finance']),
      node('leader', '质量与印制汇合终审', 'approval', leader, ['quality', 'printing']),
      node('arrange', '落实活动资源', 'task', marketingWorker, ['leader']),
      node('archive-notice', '准备归档知会', 'notice', { type: 'role', value: 'archivist' }, ['arrange']),
    ],
    [
      {
        name: '交错完成',
        payload: {},
        checks: [
          '教研完成且财务未完：设计和营销可先办理，技术与印制继续等待',
          '财务完成且设计未完：技术可启动，印制仍等待设计',
          '质量复核等待技术和营销，领导等待质量和印制',
          '财务知会不会卡住其他分支',
          '末尾资源任务完成后进入待指派',
        ],
      },
      {
        name: '中途插入或转交',
        payload: {},
        checks: [
          '在新建的测试活动中，用协调人测试前插、后插或并行加签',
          '转交后旧办理人不可继续处理原任务，新办理人收到待办',
          '可由原模板另发活动，核对模板版本未被实例调整修改',
        ],
      },
    ],
  );
  add(
    'test-07-notice-only',
    '测试07｜仅知会免审批',
    '无审批无任务，通知相关人员后直接待指派',
    [
      node('finance-notice', '财务知会', 'notice', finance),
      node('marketing-notice', '营销知会', 'notice', marketing),
      node('coordinator-notice', '协调人知会', 'notice', coordinator),
    ],
    [
      {
        name: '自动流转',
        payload: {},
        checks: [
          'caiwu、yingxiao、xingzhengrenshi收到站内通知',
          '不需要任何通过或完成任务操作',
          '提交后直接进入待指派，不等收件人阅读通知',
        ],
      },
    ],
  );
  add(
    'test-08-task-only',
    '测试08｜纯任务并行协作',
    '无审批，仅任务拆分与汇合',
    [
      node('design', '准备活动海报', 'task', design),
      node('tech', '准备线上环境', 'task', tech),
      node('resources', '合并材料并落实资源', 'task', marketingWorker, ['design', 'tech']),
    ],
    [
      {
        name: '双任务汇合',
        payload: {},
        checks: [
          'sheji1和jishuyanfa1同时收到任务',
          '两项任务均完成后，yingxiao1收到汇合任务',
          '全程只有完成任务，不出现同意或拒绝审批',
          '汇合任务完成后进入待指派',
        ],
      },
    ],
  );
  const secret = node('finance', '敏感财务资料审批', 'approval', finance, ['review']);
  secret.access = { mode: 'restricted', roleIds: ['director'], userIds: [], nodeAssignees: true };
  secret.downloadAccess = structuredClone(secret.access);
  const sharedReview = node('review', '公开方案初审', 'approval', own);
  sharedReview.access = { mode: 'shared', roleIds: [], userIds: [] };
  const sharedMarketing = node('marketing', '公开营销方案审核', 'approval', marketing, ['finance']);
  sharedMarketing.access = { mode: 'shared', roleIds: [], userIds: [] };
  add(
    'test-09-security',
    '测试09｜敏感财务资料隔离',
    '节点意见、节点附件和独立下载权限的跨部门隔离',
    [
      sharedReview,
      secret,
      sharedMarketing,
      node('leader', '领导查看财务资料并终审', 'approval', leader, ['marketing']),
    ],
    [
      {
        name: '跨部门可见性',
        payload: {},
        checks: [
          '财务节点办理时caiwu上传测试财务附件并填写内部说明',
          'sichuan1、sichuan、yingxiao可看流程进度和公共结论，但看不到财务内部说明和附件',
          'caiwu与yuanlingdao可按授权查看、下载财务附件',
          '用其他账号直接请求财务文件地址应拒绝',
          '上传时可再收紧下载权限，领导也需符合附件附加规则',
        ],
      },
    ],
  );
  add(
    'test-10-countersign',
    '测试10｜全体部门负责人会签',
    '单节点多受理人，全部同意才完成；用于进阶及压力场景',
    [
      node('countersign', '全体部门负责人全员会签', 'approval', { type: 'role', value: 'department' }),
      node('leader', '会签完成后院领导确认', 'approval', leader, ['countersign']),
    ],
    [
      {
        name: '全员通过',
        payload: {},
        checks: [
          '会签节点按提交时有效部门负责人角色展开，多人各生成独立待办',
          '任意一人通过不代表整个节点完成',
          '全部通过才到领导确认，当前组织预计30名会签人',
        ],
      },
      {
        name: '会签中途拒绝或退回',
        payload: {},
        checks: [
          '另起活动，先通过一人，再由另一人退回或拒绝',
          '其他未完成待办应取消，防止继续审批',
          '建议最后测试该模板，避免一开始产生过多待办',
        ],
      },
    ],
  );
  return catalog;
}

/** 使用历史测试目录生成四套最新模板配置测试方案，覆盖审批操作、评分、并行退回与资料权限。
 * @param config 当前组织、权限和表单
 * @param types 已维护的活动类型
 * @returns 两套简单流程与两套复杂流程组成的最新测试目录
 */
export function buildLatestTestTemplateCatalog(config: CompanyConfig, types: ActivityType[]): TestTemplatePlan[] {
  const source = buildTestTemplateCatalog(config, types);
  const basic = structuredClone(source[0]!);
  const serial = structuredClone(source[1]!);
  const parallel = structuredClone(source[3]!);
  const complex = structuredClone(source[5]!);

  basic.code = 'latest-test-01-basic';
  basic.definition.name = '最新测试01｜单级审批基础操作';
  basic.definition.ratingEnabled = false;
  basic.purpose = '验证单节点审批、退回发起人、终止申请和默认关闭评分';
  basic.definition.nodes[0]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    allowTerminate: true,
  };
  basic.cases = [
    {
      name: '通过、退回与终止',
      payload: {},
      checks: [
        '审批抽屉显示通过审批、退回修改和终止申请三个操作',
        '退回修改仅能退给发起人，补充后可重新提交',
        '终止申请必须填写原因，终止后不进入执行阶段',
        '模板评分总开关关闭，不显示上游评分项',
      ],
    },
  ];

  serial.code = 'latest-test-02-serial-rating';
  serial.definition.name = '最新测试02｜串行审批与逐级评分';
  serial.definition.ratingEnabled = true;
  serial.purpose = '验证串行审批、可选评分、必填评分和指定上游退回范围';
  for (const node of serial.definition.nodes)
    if (node.kind === 'approval') node.approvalPolicy = defaultApprovalPolicy();
  serial.definition.nodes[1]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    rating: 'optional',
  };
  serial.definition.nodes[2]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    returnScope: 'selected',
    returnNodeIds: ['review', 'research'],
    returnToApplicant: false,
    allowTerminate: true,
    rating: 'required',
  };
  serial.definition.nodes[3]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    rating: 'required',
  };
  serial.cases = [
    {
      name: '串行评分与指定退回',
      payload: {},
      checks: [
        '教研审批可选填评价部门初审分数，0分仍是有效评分',
        '财务审批必须评价教研成果，未评分不能通过',
        '财务可退回部门初审或教研审核，但不能直接退给发起人',
        '领导终审必须评价财务审核成果，办理进度展示评分人与分数',
        '审批全部完成后知会协调人，知会不产生办理按钮',
      ],
    },
  ];

  parallel.code = 'latest-test-03-parallel-return';
  parallel.definition.name = '最新测试03｜并行会审与分支重办';
  parallel.definition.ratingEnabled = true;
  parallel.purpose = '验证并行审批、汇合评分、指定分支退回和独立分支结果保留';
  for (const node of parallel.definition.nodes)
    if (node.kind === 'approval') node.approvalPolicy = defaultApprovalPolicy();
  parallel.definition.nodes[1]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    rating: 'optional',
  };
  parallel.definition.nodes[2]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    rating: 'optional',
  };
  parallel.definition.nodes[3]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    returnScope: 'selected',
    returnNodeIds: ['review', 'research', 'finance'],
    returnToApplicant: false,
    allowTerminate: true,
    rating: 'required',
  };
  parallel.cases = [
    {
      name: '并行通过与汇合评分',
      payload: {},
      checks: [
        '初审后教研和财务同时收到待办，任一分支完成都不会提前激活终审',
        '领导终审需要分别评价教研与财务两个直接前置审批成果',
        '两项评分均填写后才可通过，进度中分别展示评分结果',
      ],
    },
    {
      name: '退回单一并行分支',
      payload: {},
      checks: [
        '领导选择退回教研分支时，教研及领导进入新轮次',
        '已完成的财务独立分支保持有效，不重复生成财务待办',
        '教研重新通过后领导再次获得待办，旧评分显示为历史评分',
      ],
    },
  ];

  complex.code = 'latest-test-04-complex-security';
  complex.definition.name = '最新测试04｜复杂协作与敏感资料';
  complex.definition.ratingEnabled = true;
  complex.purpose = '验证审批、任务、知会、多次汇合、深层退回、评分与节点附件权限的组合行为';
  for (const node of complex.definition.nodes)
    if (node.kind === 'approval') node.approvalPolicy = defaultApprovalPolicy();
  complex.definition.nodes[1]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    rating: 'required',
  };
  complex.definition.nodes[2]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    rating: 'optional',
  };
  complex.definition.nodes[4]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    rating: 'required',
  };
  complex.definition.nodes[7]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    returnScope: 'selected',
    returnNodeIds: ['review', 'research', 'marketing', 'tech'],
    returnToApplicant: false,
    allowTerminate: true,
    rating: 'required',
  };
  complex.definition.nodes[9]!.approvalPolicy = {
    ...defaultApprovalPolicy(),
    returnScope: 'selected',
    returnNodeIds: ['review', 'research', 'finance', 'design', 'marketing', 'tech', 'printing', 'quality'],
    returnToApplicant: false,
    allowTerminate: true,
    rating: 'required',
  };
  complex.definition.nodes[2]!.access = {
    mode: 'restricted',
    roleIds: ['director'],
    userIds: [],
    nodeAssignees: true,
  };
  complex.definition.nodes[2]!.downloadAccess = structuredClone(complex.definition.nodes[2]!.access);
  complex.cases = [
    {
      name: '复杂路线完整通过',
      payload: {},
      checks: [
        '教研与财务并行后，设计、营销、技术、印制按依赖逐步激活',
        '审批节点按配置要求评价直接前置审批，任务和知会不显示评分',
        '财务节点新上传附件默认仅财务办理人与领导可查看和下载',
        '单文件改为活动内共享后，有活动查看权的人员可以查看，但下载仍校验下载权限',
        '知会自动发送站内通知，不阻塞后续节点',
      ],
    },
    {
      name: '深层退回与终止',
      payload: {},
      checks: [
        '质量复核可按白名单退回教研、营销或技术节点',
        '领导终审可退回任一已流经的上游审批或任务节点',
        '退回目标及其后续进入新轮次，未受影响的独立分支保持有效',
        '质量复核或领导终审可终止整个申请，原因必填且剩余待办取消',
      ],
    },
  ];

  return [basic, serial, parallel, complex];
}
