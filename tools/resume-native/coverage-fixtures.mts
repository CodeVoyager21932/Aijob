import {
  createNativeResumeDocument,
  type EditableNativeSection,
  ensureNativeResearchSection,
  type NativeResumeData,
  type NativeResumeDocument,
  newNativeItem,
} from "../../packages/resume-core/src/index.js";

export interface ResumeCoverageFixture {
  id:
    | "education-sparse"
    | "business-medium"
    | "engineering-dense"
    | "creative-medium"
    | "research-master"
    | "research-doctor";
  label: string;
  major: string;
  density: "short" | "medium" | "dense";
  coverage: string[];
  document: NativeResumeDocument;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paragraph = (text: string) => `<p>${escapeHtml(text)}</p>`;
const bullets = (...lines: string[]) =>
  `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;

function item<K extends EditableNativeSection>(
  kind: K,
  id: string,
  values: Partial<NativeResumeData["sections"][K]["items"][number]>,
): NativeResumeData["sections"][K]["items"][number] {
  return Object.assign(newNativeItem(kind, id), values);
}

function student(name: string, headline: string, email: string, city: string, photoSlot = false) {
  const document = createNativeResumeDocument();
  Object.assign(document.data.basics, {
    name: `${name}（示例）`,
    headline,
    email: `${email}@example.com`,
    phone: "138 0000 0000",
    location: city,
  });
  // The harness may embed the repository's fictional sample portrait in these two slots.
  // No file, URL fetch, real portrait or personal document is read by this module.
  document.data.picture.hidden = !photoSlot;
  document.data.picture.url = "";
  return document;
}

function sections(document: NativeResumeDocument, order: string[]) {
  document.data.metadata.layout.pages = [{ fullWidth: true, main: order, sidebar: [] }];
  return document;
}

function educationSparse(): ResumeCoverageFixture {
  const document = student("周书宁", "小学教育 · 教研与阅读活动助理", "shuning.zhou", "南京");
  const { data } = document;
  data.summary.content = paragraph(
    "小学教育专业大二在校生，关注儿童阅读与课堂活动设计。希望从教研资料整理、阅读活动支持等工作积累实践经验。",
  );
  data.sections.education.items = [
    item("education", "education-sparse-school", {
      school: "江南人文与基础教育师范学院（示例）",
      degree: "本科",
      area: "小学教育",
      period: "2025.09—2029.06（预计）",
      location: "南京",
      description: paragraph("已修教育学、儿童发展心理学、现代汉语；完成课堂观察与教案写作练习。"),
    }),
  ];
  data.sections.projects.title = "课程实践";
  data.sections.projects.items = [
    item("projects", "education-sparse-reading", {
      name: "低年级绘本阅读活动设计",
      role: "教案与活动材料整理",
      unit: "启明阅读课程小组（示例）",
      period: "2026年03月—2026年05月",
      description: bullets(
        "为两本绘本设计导读问题与角色卡，完成 3 份活动教案。",
        "参加同伴试讲，记录提问顺序和时间分配问题，依据反馈修改活动说明。",
      ),
    }),
  ];
  data.sections.volunteer.title = "志愿服务";
  data.sections.volunteer.items = [
    item("volunteer", "education-sparse-volunteer", {
      organization: "青芽社区阅读站（示例）",
      location: "南京",
      period: "2026.04—至今",
      description: paragraph(
        "参与 4 次周末阅读活动，协助借阅登记、材料分发和活动后整理，累计服务 20 小时。",
      ),
    }),
  ];
  data.sections.skills.items = [
    item("skills", "education-sparse-office", {
      name: "材料制作",
      proficiency: "使用 Word 整理教案，使用 PowerPoint 制作图文课件",
    }),
    item("skills", "education-sparse-expression", {
      name: "阅读与表达",
      proficiency: "完成绘本导读试讲，能整理课堂观察记录与活动反馈",
    }),
  ];
  data.sections.certifications.items = [
    item("certifications", "education-sparse-certificate", {
      title: "普通话水平测试二级甲等",
      issuer: "江南语言文字测试站（示例）",
      date: "2026.06",
    }),
  ];
  return {
    id: "education-sparse",
    label: "文教本科 · 经历较少",
    major: "小学教育",
    density: "short",
    coverage: [
      "本科",
      "少量经历",
      "无实习",
      "无照片",
      "长中文校名",
      "年月混合日期",
      "证书独立字段",
    ],
    document: sections(document, [
      "summary",
      "education",
      "projects",
      "volunteer",
      "skills",
      "certifications",
    ]),
  };
}

function businessMedium(): ResumeCoverageFixture {
  const document = student("许清禾", "工商管理 · 市场与客户运营实习", "qinghe.xu", "杭州", true);
  const { data } = document;
  data.summary.content = paragraph(
    "工商管理专业大三在校生，具备活动执行与基础数据整理经验。能够将访谈、报名记录和用户反馈整理为可复核的工作材料。",
  );
  data.sections.education.items = [
    item("education", "business-medium-school", {
      school: "钱江工商与公共管理大学（示例）",
      degree: "本科",
      area: "工商管理",
      grade: "3.6 / 4.0",
      period: "2024.09—2028.06（预计）",
      location: "杭州",
      description: paragraph("主修市场营销、管理统计与消费者行为；完成企业案例分析课程。"),
    }),
  ];
  data.sections.experience.title = "实习经历";
  data.sections.experience.items = [
    item("experience", "business-medium-intern", {
      company: "和益商业咨询有限公司（示例）",
      position: "客户运营实习生",
      location: "杭州",
      period: "2026年07月—2026年09月",
      description: bullets(
        "核对 160 份活动报名资料，标记重复记录与缺失字段，整理供执行同事使用的确认清单。",
        "汇总两场客户交流活动的签到与问卷数据，使用 Excel 制作到场情况和反馈主题图表。",
        "维护活动通知与回访任务表，跟进材料提交进度，将常见咨询整理为 8 项回复指引。",
      ),
    }),
  ];
  data.sections.projects.items = [
    item("projects", "business-medium-survey", {
      name: "校园二手交易服务体验调研",
      role: "问卷分析与小组协调",
      unit: "四人课程项目组（示例）",
      method: "问卷与半结构化访谈",
      period: "2026.03—2026.05",
      description: bullets(
        "回收 92 份有效问卷并完成 6 次访谈，归纳信息真实性、沟通和交付环节的主要问题。",
        "绘制交易流程图，提出信息核验提示与反馈入口建议，完成课程报告与展示。",
      ),
    }),
  ];
  data.sections.volunteer.title = "校园经历";
  data.sections.volunteer.items = [
    item("volunteer", "business-medium-campus", {
      organization: "钱江大学生职业发展协会（示例）",
      period: "2025.09—2026.06",
      location: "杭州",
      description: paragraph(
        "参与 3 次行业分享活动的报名与现场协调，整理嘉宾材料、参与者问题和活动复盘。",
      ),
    }),
  ];
  data.sections.skills.items = [
    item("skills", "business-medium-analysis", {
      name: "办公与分析",
      proficiency: "Excel 透视表、查找函数与图表；PowerPoint 汇报；问卷编码",
    }),
    item("skills", "business-medium-operations", {
      name: "运营协作",
      proficiency: "活动排期、客户问题分类、会议纪要与任务跟进",
    }),
  ];
  data.sections.languages.items = [
    item("languages", "business-medium-language", {
      language: "英语",
      fluency: "CET-6 532 分，可阅读商业案例与整理英文邮件",
    }),
  ];
  return {
    id: "business-medium",
    label: "商科本科 · 一段实习",
    major: "工商管理",
    density: "medium",
    coverage: ["本科", "中等经历量", "实习", "可选照片位", "成绩", "考试分数格式", "中英文工具名"],
    document: sections(document, [
      "summary",
      "education",
      "experience",
      "projects",
      "volunteer",
      "skills",
      "languages",
    ]),
  };
}

function engineeringDense(): ResumeCoverageFixture {
  const document = student(
    "陈砚舟",
    "机械设计制造及其自动化 · 结构与工艺实习",
    "yanzhou.chen",
    "武汉",
  );
  const { data } = document;
  data.summary.content = paragraph(
    "机械类本科在校生，完成结构设计、试制记录与测试分析课程项目，关注设计方案到装配验证的衔接。 ",
  );
  data.sections.education.items = [
    item("education", "engineering-dense-school", {
      school: "汉川先进制造与工程技术大学（示例）",
      degree: "本科",
      area: "机械设计制造及其自动化",
      period: "2023.09—2027.06（预计）",
      location: "武汉",
      description: paragraph(
        "主修机械设计、工程材料、制造技术与公差测量；专业课程平均分 86 / 100。",
      ),
    }),
  ];
  data.sections.experience.title = "生产实习";
  data.sections.experience.items = [
    item("experience", "engineering-dense-intern", {
      company: "云衡精密装备有限公司（示例）",
      position: "工艺助理实习生",
      location: "武汉",
      period: "2026.07—2026.08",
      description: bullets(
        "在工程师指导下核对 12 份加工工序卡，整理尺寸检测记录和图纸版本差异。",
        "参与夹具装配观察，记录定位与紧固步骤，将常见返工原因汇总至周报。",
      ),
    }),
  ];
  data.sections.projects.items = [
    item("projects", "engineering-dense-fixture", {
      name: "薄壁零件定位夹具的设计与装配验证",
      role: "结构设计与图纸整理",
      unit: "机械创新课程组（示例）",
      period: "2026.03—2026.06",
      description: bullets(
        "使用 SolidWorks 建立夹具与零件装配模型，比较两种定位方案并完成工程图。",
        "整理 15 次重复装夹测量结果，检查定位偏差与干涉位置，修订定位销间距。",
      ),
    }),
    item("projects", "engineering-dense-cart", {
      name: "室内物料转运小车底盘课程设计",
      role: "传动选型与装配检查",
      unit: "机电综合实践小组（示例）",
      period: "2025.10—2026.01",
      description: bullets(
        "根据载荷与速度要求完成电机、减速机构选型，绘制底盘布置与零件清单。",
        "参加样机装配和直线行驶测试，记录连接松动问题，补充维护与检查步骤。",
      ),
    }),
    item("projects", "engineering-dense-test", {
      name: "铝合金试样拉伸与断口观察",
      role: "实验记录与结果分析",
      period: "2025年06月",
      description: paragraph(
        "整理 3 组试样的应力—应变曲线，比较屈服与延伸表现，说明测量误差及实验限制。",
      ),
    }),
  ];
  data.sections.skills.items = [
    item("skills", "engineering-dense-cad", {
      name: "设计与分析",
      proficiency: "SolidWorks 零件及装配；AutoCAD 工程图；MATLAB 基础曲线处理",
    }),
    item("skills", "engineering-dense-measure", {
      name: "工艺与测量",
      proficiency: "按指导使用游标卡尺、千分尺；核对 BOM、工序卡与测试记录",
    }),
  ];
  data.sections.languages.items = [
    item("languages", "engineering-dense-language", {
      language: "英语",
      fluency: "CET-4，可借助术语表阅读设备说明与零部件资料",
    }),
  ];
  return {
    id: "engineering-dense",
    label: "机械本科 · 多个项目",
    major: "机械设计制造及其自动化",
    density: "dense",
    coverage: [
      "本科",
      "较密经历量",
      "三项目",
      "无照片",
      "长专业名",
      "中英文技术名",
      "测量数字与单位",
    ],
    document: sections(document, [
      "summary",
      "education",
      "experience",
      "projects",
      "skills",
      "languages",
    ]),
  };
}

function creativeMedium(): ResumeCoverageFixture {
  const document = student(
    "沈映岚",
    "视觉传达设计 · 品牌与信息设计实习",
    "yinglan.shen",
    "成都",
    true,
  );
  const { data } = document;
  data.basics.website = {
    label: "Portfolio · 作品集（示例）",
    url: "https://example.com/yinglan/portfolio",
  };
  data.basics.customFields = [
    {
      id: "creative-medium-pdf",
      icon: "",
      text: "作品 PDF 与过程记录（示例）",
      link: "https://example.com/yinglan/portfolio/process-and-final-deliverables.pdf",
    },
  ];
  data.summary.content = paragraph(
    "视觉传达设计专业在校生，关注公共信息的可读性与品牌表达。作品包含访谈、信息梳理、版式推演及实际物料验证过程。 ",
  );
  data.sections.education.items = [
    item("education", "creative-medium-school", {
      school: "西川传媒与视觉艺术学院（示例）",
      degree: "本科",
      area: "视觉传达设计",
      period: "2023.09—2027.06（预计）",
      location: "成都",
      description: paragraph("课程涵盖字体设计、信息可视化与品牌系统；参与跨专业服务设计工作坊。"),
    }),
  ];
  data.sections.experience.title = "实习经历";
  data.sections.experience.items = [
    item("experience", "creative-medium-intern", {
      company: "叙白品牌设计工作室（示例）",
      position: "视觉设计实习生",
      period: "2026.07—2026.09",
      location: "成都",
      description: bullets(
        "按品牌规范完成 6 组活动海报与社交媒体版式，整理图像授权信息和输出尺寸。",
        "协助校对印刷打样，记录色彩、出血与文字层级问题，归档修改版本。",
      ),
    }),
  ];
  data.sections.projects.items = [
    item("projects", "creative-medium-wayfinding", {
      name: "面向老年使用者的社区公共服务导视与办事信息可视化设计",
      role: "信息架构与视觉设计",
      unit: "社区服务设计课程组（示例）",
      period: "2026.03—2026.06",
      website: {
        url: "https://example.com/portfolio/2026/community-service-information-accessibility/case-study",
        label:
          "https://example.com/portfolio/2026/community-service-information-accessibility/case-study",
        inlineLink: false,
      },
      description: bullets(
        "结合现场观察与 5 次访谈，重组窗口业务分类、楼层路径和办事材料清单。",
        "制作导视与信息折页样稿，通过纸面任务试用修订图标说明和字体层级。",
      ),
    }),
    item("projects", "creative-medium-brand", {
      name: "Reading Together｜校园阅读节视觉系统",
      role: "主视觉与延展物料",
      period: "2025.10—2025.12",
      description:
        '<p>完成主海报、书签与活动日历，统一网格、字体和色彩；<a href="https://example.com/reading-together/process">设计过程页（示例）</a>保留方案比较与调整说明。</p>',
    }),
  ];
  data.sections.skills.items = [
    item("skills", "creative-medium-design", {
      name: "视觉制作",
      proficiency: "Illustrator 矢量与版式；Photoshop 图像处理；Figma 交互原型",
    }),
    item("skills", "creative-medium-production", {
      name: "交付与协作",
      proficiency: "印前文件检查、网格排版、素材归档、设计说明与反馈记录",
    }),
  ];
  return {
    id: "creative-medium",
    label: "传媒设计本科 · 作品链接",
    major: "视觉传达设计",
    density: "medium",
    coverage: [
      "本科",
      "可选照片位",
      "长中文项目名",
      "中英文标题",
      "长可见网址",
      "页首作品链接",
      "自定义联系字段",
      "正文超链接",
    ],
    document: sections(document, ["summary", "education", "experience", "projects", "skills"]),
  };
}

function researchMaster(): ResumeCoverageFixture {
  const document = student("林知衡", "材料科学与工程硕士 · 材料研发实习", "zhiheng.lin", "合肥");
  const { data } = document;
  data.summary.content = paragraph(
    "材料科学与工程硕士在读，研究聚合物薄膜的制备与性能表征，能够维护实验记录、整理数据并参与中英文研究汇报。 ",
  );
  data.sections.education.items = [
    item("education", "research-master-graduate", {
      school: "皖江先进材料与工程大学（示例）",
      degree: "硕士研究生",
      area: "材料科学与工程",
      period: "2024.09—2027.06（预计）",
      location: "合肥",
      description: paragraph("研究方向：聚合物功能薄膜；已修材料表征、统计实验设计与科研规范。"),
    }),
    item("education", "research-master-undergraduate", {
      school: "清源理工学院（示例）",
      degree: "本科",
      area: "高分子材料与工程",
      period: "2020.09—2024.06",
      location: "芜湖",
    }),
  ];
  const research = ensureNativeResearchSection(data, "research-master-section");
  research.items = [
    item("projects", "research-master-film", {
      name: "水性聚合物复合薄膜的制备与耐水性研究",
      role: "实验实施与数据整理",
      unit: "功能高分子材料课题组（示例）",
      method: "对照实验、接触角与拉伸测试",
      period: "2025.01—至今",
      description: bullets(
        "按统一流程制备 4 组配方，记录固含量、干燥条件与试样编号，维护可追溯实验台账。",
        "整理接触角、吸水率与力学测试数据，绘制重复实验的均值与误差图，排查异常试样。",
        "参与讨论性能差异及实验限制，完成阶段汇报和论文图表初稿。",
      ),
    }),
  ];
  data.sections.projects.title = "课程项目";
  data.sections.projects.items = [
    item("projects", "research-master-characterization", {
      name: "材料表征方法综合训练",
      role: "谱图整理与方法比较",
      period: "2024.10—2024.12",
      description: paragraph(
        "在指导下完成 FTIR 与 DSC 测试，比较处理条件对谱图的影响，形成方法适用范围与误差来源说明。",
      ),
    }),
  ];
  data.sections.publications.items = [
    item("publications", "research-master-publication", {
      title: "Water Resistance of Aqueous Polymer Composite Films（示例论文）",
      publisher: "示例材料研究期刊",
      authors: "林知衡（示例）、王导师（示例）",
      authorPosition: "第一作者",
      status: "已录用",
      date: "2026.08",
      website: {
        url: "https://example.com/research/polymer-films/accepted-manuscript",
        label: "论文记录（示例）",
        inlineLink: false,
      },
    }),
  ];
  data.sections.skills.items = [
    item("skills", "research-master-lab", {
      name: "实验与记录",
      proficiency: "薄膜制备、试样编号、实验台账；在指导下使用 FTIR、DSC",
    }),
    item("skills", "research-master-analysis", {
      name: "分析与写作",
      proficiency: "Origin 作图、Excel 数据核对、Zotero 文献管理与图表说明",
    }),
  ];
  data.sections.languages.items = [
    item("languages", "research-master-language", {
      language: "英语",
      fluency: "CET-6，可阅读材料文献并撰写实验方法初稿",
    }),
  ];
  return {
    id: "research-master",
    label: "材料硕士 · 科研与论文",
    major: "材料科学与工程",
    density: "dense",
    coverage: [
      "硕士",
      "两段教育",
      "自定义科研模块",
      "科研方法字段",
      "英文论文标题",
      "作者顺序",
      "录用状态",
      "论文链接",
      "无照片",
    ],
    document: sections(document, [
      "summary",
      "education",
      research.id,
      "projects",
      "publications",
      "skills",
      "languages",
    ]),
  };
}

function researchDoctor(): ResumeCoverageFixture {
  const document = student("顾言澄", "法学博士研究生 · 政策研究与法律实务", "yancheng.gu", "北京");
  const { data } = document;
  data.summary.content = paragraph(
    "法学博士在读，关注公共服务中的行政程序与个人信息保护。具有案例整理、访谈编码和教学辅助经验，重视研究材料的出处与论证边界。 ",
  );
  data.sections.education.items = [
    item("education", "research-doctor-doctorate", {
      school: "京华社会科学与公共治理大学（示例）",
      degree: "博士研究生",
      area: "法学 · 宪法学与行政法学",
      period: "2023.09—2027.06（预计）",
      location: "北京",
    }),
    item("education", "research-doctor-master", {
      school: "东川政法学院（示例）",
      degree: "硕士研究生",
      area: "法学",
      period: "2020.09—2023.06",
      location: "上海",
    }),
    item("education", "research-doctor-bachelor", {
      school: "南泽文理学院（示例）",
      degree: "本科",
      area: "法学",
      period: "2016.09—2020.06",
      location: "南京",
    }),
  ];
  const research = ensureNativeResearchSection(data, "research-doctor-section");
  research.items = [
    item("projects", "research-doctor-procedure", {
      name: "公共服务数字化中的程序告知研究",
      role: "研究助理",
      unit: "数字治理研究中心（示例）",
      method: "规范分析与案例编码",
      period: "2024.06—至今",
      description: bullets(
        "整理 36 份公开政策与办事指引，按告知内容、救济入口和材料要求建立比较表。",
        "参与访谈提纲设计和匿名材料编码，形成阶段报告，区分规范判断与受访者感受。",
      ),
    }),
    item("projects", "research-doctor-data", {
      name: "公共机构数据共享的责任边界",
      role: "文献与案例整理",
      unit: "行政法专题研讨组（示例）",
      period: "2023.11—2024.05",
      description: paragraph(
        "梳理中英文文献与相关案例，比较目的限制、信息告知和异议处理规则，完成专题研讨材料。",
      ),
    }),
  ];
  data.sections.experience.title = "教学辅助";
  data.sections.experience.items = [
    item("experience", "research-doctor-teaching", {
      company: "京华大学法学院（示例）",
      position: "行政法课程教学助理",
      period: "2025.09—2026.06",
      location: "北京",
      description: paragraph(
        "协助准备 8 次案例讨论材料，整理课堂问题和作业反馈；按教师要求维护评分记录。",
      ),
    }),
  ];
  data.sections.publications.title = "代表性成果";
  data.sections.publications.items = [
    item("publications", "research-doctor-article", {
      title: "数字公共服务中的程序说明义务（示例论文）",
      publisher: "示例公共治理研究",
      authors: "顾言澄（示例）",
      authorPosition: "独立作者",
      status: "已发表",
      date: "2026.04",
      website: {
        url: "https://example.com/legal-research/procedural-explanation",
        label: "成果记录（示例）",
        inlineLink: false,
      },
    }),
    item("publications", "research-doctor-conference", {
      title: "Notice and Review in Digital Public Services（示例报告）",
      publisher: "示例数字治理青年论坛",
      authors: "顾言澄（示例）、韩研究员（示例）",
      authorPosition: "第一报告人",
      status: "会议报告",
      date: "2025.11",
    }),
  ];
  data.sections.skills.items = [
    item("skills", "research-doctor-methods", {
      name: "研究方法",
      proficiency: "规范分析、案例编码、访谈纪要；NVivo 编码与 Zotero 管理",
    }),
  ];
  data.sections.languages.items = [
    item("languages", "research-doctor-language", {
      language: "英语",
      fluency: "可阅读法学文献，完成英文摘要及学术汇报材料",
    }),
  ];
  return {
    id: "research-doctor",
    label: "法学博士 · 科研与助教",
    major: "法学",
    density: "dense",
    coverage: [
      "博士",
      "三段教育",
      "科研与教学",
      "自定义科研模块",
      "少量代表性发表",
      "中英文成果名",
      "独立作者与会议角色",
      "无照片",
    ],
    document: sections(document, [
      "summary",
      "education",
      research.id,
      "experience",
      "publications",
      "skills",
      "languages",
    ]),
  };
}

/** Fresh fictional documents for the same six-template matrix; no personal data or I/O. */
export function coverageFixtures(): ResumeCoverageFixture[] {
  return [
    educationSparse(),
    businessMedium(),
    engineeringDense(),
    creativeMedium(),
    researchMaster(),
    researchDoctor(),
  ];
}
