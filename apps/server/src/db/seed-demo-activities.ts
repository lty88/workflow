import { readEnv } from '../env';
import { createPool, query } from './repository';
import { loadTemplates } from './template-repository';
import { createDraft, submitActivity } from '../services/activity-service';

/**
 * 示例活动计划的数据结构。
 */
interface DemoPlan {
  /** 模板编码 */
  code: string;
  /** 活动类型标识 */
  activityTypeId: string;
  /** 发起人账号 */
  applicant: string;
  /** 表单填写内容 */
  payload: Record<string, string>;
}

/** 统一的活动结束时间，对应北京时间 2026-11-30 18:00 */
const END_AT = '2026-11-30T10:00:00.000Z';

/**
 * 把北京时间的日期与时刻转换为UTC时间串，与前端日期控件存储格式一致。
 * @param date 北京时间日期，格式 YYYY-MM-DD
 * @param hour 北京时间小时
 * @param minute 北京时间分钟
 * @returns 对应的UTC ISO时间串
 */
function beijing(date: string, hour: number, minute = 0): string {
  return new Date(Date.parse(`${date}T00:00:00+08:00`) + hour * 3600000 + minute * 60000).toISOString();
}

/**
 * 查询未删除活动的名称，用于重复执行时跳过已有数据。
 * @param pool 连接池
 * @returns 已存在的活动名称集合
 */
async function existingNames(pool: ReturnType<typeof createPool>): Promise<Set<string>> {
  const rows = await query<{ name: string }>(
    pool,
    "SELECT JSON_UNQUOTE(JSON_EXTRACT(data,'$.name')) AS name FROM activities WHERE deleted_at IS NULL",
  );
  return new Set(rows.map((row) => row.name || ''));
}

/**
 * 一次性种子：按10套测试模板各创建一场业务示例活动并直接提交进入审批。
 * 内容覆盖教研、阅读推广、智慧云校培训、物料制作与财务复核场景，结束时间统一为2026-11-30 18:00（北京时间）。
 */
async function seed(): Promise<void> {
  const pool = createPool(readEnv());
  try {
    const templates = await loadTemplates(pool);
    const names = await existingNames(pool);
    let index = 0;
    for (const plan of demoPlans()) {
      index += 1;
      if (names.has(plan.payload.activity_name)) {
        console.info(`跳过已存在活动：${plan.payload.activity_name}`);
        continue;
      }
      const template = templates.find((item) => item.code === plan.code);
      if (!template || !template.active || !template.currentVersion)
        throw new Error(`模板 ${plan.code} 未发布或已停用，无法创建示例活动`);
      const version = template.currentVersion;
      const actor = plan.applicant;
      const draft = await createDraft(
        pool,
        actor,
        {
          payload: plan.payload,
          activityTypeId: plan.activityTypeId,
          templateId: template.id,
          expectedTemplateVersion: version,
        },
        `seed-demo-draft-${index}-${plan.code}`,
      );
      const submitted = await submitActivity(
        pool,
        actor,
        draft.id,
        draft.version,
        `seed-demo-submit-${index}-${plan.code}`,
        version,
      );
      console.info(
        `已创建：${plan.code} → ${plan.payload.activity_name} | id=${draft.id} v${submitted.version} 发起人=${actor}`,
      );
    }
  } finally {
    await pool.end();
  }
}

/**
 * 构造10场示例活动的表单数据，预算按专家费、会务费与差旅费合计填写。
 * @returns 示例活动计划
 */
function demoPlans(): DemoPlan[] {
  return [
    {
      code: 'test-01-simple',
      activityTypeId: 'teaching',
      applicant: 'u-org-jiaoyan1',
      payload: {
        activity_name: '重庆巴蜀中学“整本书阅读”课例研磨教研交流活动',
        delivery_mode: '线下',
        start_at: beijing('2026-11-27', 8, 30),
        end_at: END_AT,
        location: '重庆市巴蜀中学校（渝中区黄花园双钢路3号）',
        nature: '整本书项目',
        service_type: '免费课题服务',
        background:
          '巴蜀中学本学期承担市级课题“整本书阅读学习任务群设计与实施”，语文教研组已完成首轮课例设计，需在正式送教前完成校内研磨，邀请教研员与课题专家现场诊断，重点解决任务群分层与评价量表落地问题。',
        agenda:
          '11月27日 08:30-09:00 签到与课例说明；09:00-09:40 整本书导读课观摩；09:50-10:30 推进课观摩；10:40-12:00 执教教师说课与教研组议课。11月28日 09:00-11:30 专家专题讲座《整本书阅读任务群的评价设计》；14:00-17:00 分组研磨与二次备课。11月29日至30日 09:00-17:30 课例再上、课堂观察与复盘总结。',
        content_forms: '课例示范、课例研磨、专题讲座',
        forum: '否',
        people: '260',
        composition: '教研员、一线教师、学校管理人员',
        personnel: '需整本书阅读方向课题指导专家2名、课堂观察员3名，其中含市级教研员1名。',
        contact: '张明',
        contact_info: '13812345678',
        arranger: '李文静',
        arranger_info: 'liwenjing@shurenedu.cn',
        receiver: '王强',
        receiver_info: '15912345678',
        expert_fee: '12000',
        conference_fee: '8600',
        travel_fee: '5400',
        budget: '26000',
        testfiled: '示例数据',
      },
    },
    {
      code: 'test-02-standard',
      activityTypeId: 'reading',
      applicant: 'u-org-zhengbenshu1',
      payload: {
        activity_name: '成都实验小学“校园立体阅读”秋季阅读推广系列活动',
        delivery_mode: '线下',
        start_at: beijing('2026-11-02', 9),
        end_at: END_AT,
        location: '成都市实验小学（青羊区人民中路一段22号）',
        nature: '校园立体阅读课程项目',
        service_type: '免费课题服务',
        background:
          '学校已入选研究院“校园立体阅读”第二批项目校，本学期需在1-6年级同步推进主题阅读与亲子共读。目前图书室藏书结构与教师导读能力尚不匹配，拟通过一个月的系列活动完成教师培训、班级读书会建设与成果展评。',
        agenda:
          '11月2日 教师导读工作坊（整本书导读设计）；11月9日 班级读书会观摩与研讨；11月16日 亲子共读开放日；11月23日 阅读成果展评与“读书之星”评选；11月24日至30日 资料汇总、案例打磨与项目小结。',
        content_forms: '专题讲座、课例示范、其他',
        forum: '是',
        people: '1180',
        composition: '学校管理人员、一线教师、其他',
        personnel: '儿童阅读推广专家1名、项目校指导教师3名、家长志愿者6名。',
        contact: '陈静',
        contact_info: '13698765432',
        arranger: '周涛',
        arranger_info: 'zhoutao@shurenedu.cn',
        receiver: '刘芳',
        receiver_info: '02886612345',
        expert_fee: '8000',
        conference_fee: '15000',
        travel_fee: '6200',
        budget: '29200',
        testfiled: '示例数据',
      },
    },
    {
      code: 'test-03-task-first',
      activityTypeId: 'training',
      applicant: 'u-org-zhihuiyunxiao1',
      payload: {
        activity_name: '智慧云校平台第六期“校长数字化领导力”收费课题培训',
        delivery_mode: '混合',
        start_at: beijing('2026-11-09', 9),
        end_at: END_AT,
        location: '树人教育研究院三楼多功能厅（重庆市渝北区星光大道）',
        meeting_url: 'https://live.shurenedu.com/yunxiao/2026-liudaohui',
        nature: '实验区',
        service_type: '收费课题培训',
        training:
          '培训共4个模块、合计16学时：模块一“区域教育数字化规划编制”4学时；模块二“数据驱动的教学质量监测”4学时；模块三“智慧云校平台实操与校本资源建设”6学时；模块四“结业答辩与方案路演”2学时。采用线下集中面授2天加线上异步研修2周的混研模式，结业须提交本校数字化推进方案一份，考核通过后颁发结业证书。',
        background:
          '应四川、贵州两省共12个实验区教育局委托，面向中小学书记校长及分管教学副校长开展第六期校长数字化领导力培训，帮助实验区完成年度数字化转型任务分解与平台常态化应用。',
        agenda:
          '11月9日至10日 线下集中面授（规划编制与质量监测）；11月11日至24日 线上异步研修与校本方案打磨；11月25日至30日 线上答辩路演、专家点评与结业评定。',
        content_forms: '专题讲座、其他',
        forum: '否',
        people: '96',
        composition: '教育局领导、学校管理人员、教研员',
        personnel: '教育数字化方向主讲专家3名、带教导师6名、平台技术支持2名。',
        contact: '王波',
        contact_info: '13983654321',
        arranger: '代健',
        arranger_info: 'daijian@shurenedu.cn',
        receiver: '杨丽',
        receiver_info: '13712349876',
        expert_fee: '48000',
        conference_fee: '36000',
        travel_fee: '18000',
        budget: '102000',
        testfiled: '示例数据',
      },
    },
    {
      code: 'test-04-parallel',
      activityTypeId: 'online',
      applicant: 'u-org-jiaoxuezhiliang1',
      payload: {
        activity_name: '甘黔渝三地初中语文“群文阅读”线上联合教研',
        delivery_mode: '线上',
        start_at: beijing('2026-11-12', 19),
        end_at: END_AT,
        meeting_url: 'https://meet.shurenedu.com/dm/2026-qunwen-yuwen',
        nature: '实验校',
        service_type: '免费课题服务',
        background:
          '甘肃、贵州、重庆三地12所项目校共同承担“群文阅读教学策略”课题，因地域分散难以集中，改为每周一次线上联合教研，围绕议题确定、文本组元与课堂追问三个专题滚动推进。',
        agenda:
          '11月12日 19:00-21:00 专题一“议题从哪里来”；11月19日 19:00-21:00 专题二“文本组元的四种结构”；11月26日 19:00-21:00 专题三“课堂追问的设计”；11月27日至30日 课例视频上传、互评并形成联合教研纪要。',
        content_forms: '专题讲座、课例研磨、课题指导',
        forum: '否',
        people: '340',
        composition: '教研员、一线教师、教科研领导',
        personnel: '语文学科专家2名、三地教研员各1名、技术支持1名。',
        contact: '代健',
        contact_info: '13912345678',
        arranger: '孙悦',
        arranger_info: 'sunyue@shurenedu.cn',
        receiver: '李海',
        receiver_info: '15098761234',
        expert_fee: '9000',
        conference_fee: '3000',
        travel_fee: '1200',
        budget: '13200',
        testfiled: '示例数据',
      },
    },
    {
      code: 'test-05-conditions',
      activityTypeId: 'reading',
      applicant: 'u-org-guizhou1',
      payload: {
        activity_name: '毕节市实验区“书香校园”整本书阅读项目推进会暨种子教师培训',
        delivery_mode: '线下',
        start_at: beijing('2026-11-16', 9),
        end_at: END_AT,
        location: '毕节市实验学校（七星关区碧阳大道）',
        nature: '实验区',
        service_type: '免费课题服务',
        background:
          '毕节市教育局拟于2026年秋季学期面向全市8个县区共46所项目校推进“书香校园”建设，需统一解读项目实施方案、完成首批种子教师培训，并同步启动图书配置与阅读课程资源采购。',
        agenda:
          '11月16日 09:00-12:00 项目实施方案解读与县区任务分解；14:00-17:30 整本书阅读课程资源建设专题讲座。11月17日至20日 种子教师分班培训（导读课设计、班级读书会组织）。11月21日至25日 项目校入校视导与课例研磨。11月26日至30日 阶段成果汇总与问题反馈会。',
        content_forms: '专题讲座、课例示范、教学视导、课题指导',
        forum: '是',
        people: '1500',
        composition: '教育局领导、教科研领导、学校管理人员、教研员、一线教师',
        personnel: '整本书阅读、儿童文学与评价设计方向项目专家5名、视导员8名、会务执行6名。',
        contact: '周涛',
        contact_info: '13898761234',
        arranger: '刘芳',
        arranger_info: 'liufang@shurenedu.cn',
        receiver: '陈静',
        receiver_info: '02388661234',
        expert_fee: '68000',
        conference_fee: '54000',
        travel_fee: '32000',
        budget: '154000',
        testfiled: '示例数据',
      },
    },
    {
      code: 'test-06-cross',
      activityTypeId: 'teaching',
      applicant: 'u-org-sichuan1',
      payload: {
        activity_name: '四川片区“学习中心课堂”教学改革跨区域教研协作项目',
        delivery_mode: '线下',
        start_at: beijing('2026-11-04', 9),
        end_at: END_AT,
        location: '四川师范大学附属实验学校（成都市锦江区）',
        nature: '实验校',
        service_type: '免费课题服务',
        background:
          '四川片区9所项目校进入“学习中心课堂”改革第二轮，本轮重点是任务设计与小组合作机制的校本化落地。项目涉及课例开发、专家指导、物料印制与平台归档等环节，需要教研、财务、设计印制与云校技术多方协同推进。',
        agenda:
          '11月4日 09:00-12:00 第二轮改革方案研讨；11月5日至10日 9所项目校课例开发与校内研磨；11月11日至14日 专家入校指导与课例示范；11月17日至21日 教学设计集印制与发放；11月24日至28日 平台数据归档与成果梳理；11月30日 项目阶段总结会。',
        content_forms: '专题讲座、课例示范、课例研磨、教学视导、课题指导',
        forum: '否',
        people: '620',
        composition: '教科研领导、学校管理人员、教研员、一线教师',
        personnel: '学科专家4名、教研员6名、印制对接1名、平台技术支持1名、会务执行4名。',
        contact: '李文静',
        contact_info: '13812349876',
        arranger: '张明',
        arranger_info: 'zhangming@shurenedu.cn',
        receiver: '王强',
        receiver_info: '02866778899',
        expert_fee: '36000',
        conference_fee: '28000',
        travel_fee: '16000',
        budget: '80000',
        testfiled: '示例数据',
      },
    },
    {
      code: 'test-07-notice-only',
      activityTypeId: 'internal',
      applicant: 'u-org-meiti1',
      payload: {
        activity_name: '树人教育研究院11月内部读书分享会',
        delivery_mode: '线下',
        start_at: beijing('2026-11-20', 14),
        end_at: END_AT,
        location: '树人教育研究院五楼多功能会议室',
        nature: '其他',
        service_type: '其他',
        background:
          '研究院内部学习机制要求各部门每月组织一次读书分享，11月主题为“课堂观察与课例研究”，由媒体组牵头，面向全院同事开放，同步知会财务中心与营销中心。',
        agenda:
          '11月20日 14:00-14:10 主题说明；14:10-15:30 三本书目领读交流；15:30-16:30 小组研讨与心得分享；16:30-17:00 下月主题征集与小结。11月21日至30日 分享纪要整理与内网发布。',
        content_forms: '其他',
        forum: '否',
        people: '80',
        composition: '一线教师、其他',
        personnel: '主持人1名、领读人3名、纪要整理1名。',
        contact: '孙悦',
        contact_info: '13798761234',
        arranger: '周涛',
        arranger_info: 'zhoutao@shurenedu.cn',
        receiver: '杨丽',
        receiver_info: '02388776655',
        expert_fee: '0',
        conference_fee: '1800',
        travel_fee: '0',
        budget: '1800',
        testfiled: '示例数据',
      },
    },
    {
      code: 'test-08-task-only',
      activityTypeId: 'internal',
      applicant: 'u-org-yinzhi1',
      payload: {
        activity_name: '2026年秋季学期教研活动物料设计与印制',
        delivery_mode: '线下',
        start_at: beijing('2026-11-05', 9),
        end_at: END_AT,
        location: '设计印制中心（重庆市渝北区星光大道）',
        nature: '其他',
        service_type: '其他',
        background:
          '12月将集中开展重庆、四川、贵州三地教研活动，需提前一个月完成教学设计集、学习单、结业证书与易拉宝等物料的设计、打样与印制，并按各活动地点分装发运。',
        agenda:
          '11月5日至8日 需求确认与版式设计；11月9日至13日 内文排版与三轮校对；11月16日至18日 打样确认；11月19日至25日 印制与质量抽检；11月26日至30日 分装贴标并发运至各活动地点。',
        content_forms: '其他',
        forum: '否',
        people: '30',
        composition: '其他',
        personnel: '设计3名、排版2名、校对2名、印制跟单1名、储运对接1名。',
        contact: '刘芳',
        contact_info: '13988776655',
        arranger: '陈静',
        arranger_info: 'chenjing@shurenedu.cn',
        receiver: '李海',
        receiver_info: '02388990011',
        expert_fee: '0',
        conference_fee: '42000',
        travel_fee: '3000',
        budget: '45000',
        testfiled: '示例数据',
      },
    },
    {
      code: 'test-09-security',
      activityTypeId: 'internal',
      applicant: 'u-org-xingzhengrenshi1',
      payload: {
        activity_name: '2026年11月教研专项经费财务复核与票据归集',
        delivery_mode: '线下',
        start_at: beijing('2026-11-23', 9),
        end_at: END_AT,
        location: '树人教育研究院财务中心会议室',
        nature: '其他',
        service_type: '其他',
        background:
          '按季度经费管理规定，需对11月开展的教研、培训与物料制作类活动的预算执行、报销票据与合同要件进行集中复核。复核涉及敏感财务资料，明细仅财务中心与分管院领导可见。',
        agenda:
          '11月23日 09:00-12:00 预算执行情况核对；11月24日至26日 票据合规性与合同要件复核；11月27日 异常项反馈与整改；11月30日 复核结论汇总与归档。',
        content_forms: '其他',
        forum: '否',
        people: '15',
        composition: '其他',
        personnel: '财务复核3名、分管院领导1名、档案管理员1名。',
        contact: '杨丽',
        contact_info: '13612349988',
        arranger: '李文静',
        arranger_info: 'liwenjing@shurenedu.cn',
        receiver: '周涛',
        receiver_info: '02388991122',
        expert_fee: '0',
        conference_fee: '6000',
        travel_fee: '0',
        budget: '6000',
        testfiled: '示例数据',
      },
    },
    {
      code: 'test-10-countersign',
      activityTypeId: 'teaching',
      applicant: 'u-org-yuwenqikan1',
      payload: {
        activity_name: '树人教育研究院2026年度教研成果总结暨跨部门协同推进会',
        delivery_mode: '线下',
        start_at: beijing('2026-11-18', 9),
        end_at: END_AT,
        location: '树人教育研究院一楼报告厅',
        nature: '其他',
        service_type: '免费课题服务',
        background:
          '年度收官阶段需汇总各中心全年教研成果、经费执行与项目校反馈，并形成下一年度推进方案。因涉及全院各中心职责分工，需全体部门负责人会签确认。',
        agenda:
          '11月18日 09:00-12:00 各中心年度成果汇报；11月19日至21日 分组研讨下年度重点任务；11月24日至27日 方案整合与指标确认；11月30日 会签确认与纪要发布。',
        content_forms: '专题讲座、其他',
        forum: '是',
        people: '480',
        composition: '教育局领导、教科研领导、学校管理人员、教研员、一线教师、其他',
        personnel: '各中心负责人12名、会务执行6名、纪要整理1名。',
        contact: '张明',
        contact_info: '13812345678',
        arranger: '王强',
        arranger_info: 'wangqiang@shurenedu.cn',
        receiver: '陈静',
        receiver_info: '02388661234',
        expert_fee: '24000',
        conference_fee: '20000',
        travel_fee: '9000',
        budget: '53000',
        testfiled: '示例数据',
      },
    },
  ];
}

await seed();
