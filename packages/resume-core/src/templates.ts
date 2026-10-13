import type { NativeResumeDocument } from "./index.js";

export const nativeTemplateCatalog = [
  {
    id: "studio-clear-cn",
    name: "清晰单栏",
    description: "完整正文、清楚层级和自然续页，适合作为第一套模板。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "studio-compact-cn",
    name: "紧凑单栏",
    description: "紧凑的信息行与较短模块间距，优先减少冗余留白。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "studio-main-cn",
    name: "正文优先双栏",
    description: "宽正文栏保留完整经历，窄栏呈现技能与辅助信息。",
    base: "gengar",
    columns: 2,
  },
  {
    id: "studio-research-cn",
    name: "科研多页",
    description: "衬线正文、明确作者信息和连续多页，适合论文与长经历。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "jp-designer-cn",
    name: "珊瑚刊物 · 卡片履历",
    description: "杂志式页首、珊瑚分隔带与独立经历卡片。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "jp-ribbon-cn",
    name: "红色缎带 · 模块标签",
    description: "通栏缎带页首、折角分节标签与经历侧线。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "jp-minimal-cn",
    name: "现代清简 · 时间轴卡片",
    description: "浅灰纸边、白色内页、日期时间轴与项目卡片。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "rendercv-classic-cn",
    name: "专业履历 · 学位分栏",
    description: "居中蓝色页首、延伸细线与学历专业独立列。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "rendercv-engineering-cn",
    name: "工程履历 · 衬线正文",
    description: "衬线居中姓名、通栏分节线与企业优先条目。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "jp-scientist-cn",
    name: "科研文稿 · 编号分节",
    description: "居中论文式页首、编号模块和细线层级，适合科研长材料。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "jp-berlin-cn",
    name: "几何构成 · 对比页首",
    description: "黑色名片页首、几何标记与留白正文，版式参考JobPilot Berlin。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "jp-blocks-cn",
    name: "轻量笔记 · 层次模块",
    description: "联系标签、三角分节和内收正文，版式参考JobPilot Blocks。",
    base: "meowth",
    columns: 1,
  },

  {
    id: "jp-classic-cn",
    name: "经典履历 · 居中名片",
    description: "居中照片与姓名组合、独立联系行及职位优先的紧凑条目。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "jp-ats-cn",
    name: "素雅履历 · 黑线分区",
    description: "黑色细线组织模块，照片出现时页首自然转为并排联系信息。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "jp-academic-cn",
    name: "学术履历 · 学位优先",
    description: "学位与专业先行、学校独立成行，衬线字体与长材料自然续页。",
    base: "meowth",
    columns: 1,
  },

  {
    id: "magic-formal-cn",
    name: "中文正式 · 对称页首",
    description: "居中身份信息、对称矩形照片与双层条目，适合正式校招材料。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "magic-product-cn",
    name: "产品运营 · 信息网格",
    description: "标签化两列联系信息、右侧照片与贡献经历，参考Magic Product Ops。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "magic-clean-cn",
    name: "简洁模块 · 项目网格",
    description: "居中联系信息，项目与辅助信息采用模块内网格，参考Magic Clean Minimal。",
    base: "meowth",
    columns: 1,
  },

  {
    id: "magic-compact-cn",
    name: "中文紧凑 · 三列履历",
    description: "居中姓名与右侧长照片，企业、角色、日期形成三列；参考Magic Compact CN Photo。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "magic-executive-cn",
    name: "职业时间线 · 浅色页首",
    description: "内收浅色名片页首，经历与教育用独立时间轴连接；参考Magic Executive Band。",
    base: "onyx",
    columns: 1,
  },
  {
    id: "euro-cn",
    name: "索引履历 · 联系信息表",
    description: "逐行联系信息与右侧照片，模块索引及竖线组织完整经历；参考 JobPilot Euro。",
    base: "bronzor",
    columns: 1,
  },
  {
    id: "modern-cn",
    name: "现代履历 · 横幅与短线",
    description: "照片与姓名联系方式并列成完整横幅，短线模块标记与纵向经历；参考 JobPilot Modern。",
    base: "onyx",
    columns: 1,
  },
  {
    id: "visiky-single-cn",
    name: "中文履历 · 横线单栏",
    description:
      "姓名与两列联系信息、右侧可选照片，模块标题尾随细线；参考 visiky 中文简历 Template2。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "visiky-cn",
    name: "中文履历 · 主辅分区",
    description: "左侧完整资料与教育、右侧浅底经历区及色带分节；参考 visiky 中文简历。",
    base: "gengar",
    columns: 2,
  },
  {
    id: "swiss-cn",
    name: "瑞士网格 · 日期索引",
    description:
      "左侧日期与右侧经历形成稳定网格，红色分节标记、独立联系方式；参考 JobPilot Swiss。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "engineer-cn",
    name: "工程项目 · 深色页首",
    description: "姓名、照片与联系信息分区，蓝色细线组织项目和技术经历；参考 JobPilot Engineer。",
    base: "onyx",
    columns: 1,
  },
  {
    id: "meowth-cn",
    name: "左对齐清晰履历",
    description: "左对齐姓名与独立联系行、右侧可选照片，条目标题与日期紧凑排列。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "deedy-cn",
    name: "Deedy · 中文学术双栏",
    description: "通栏居中页首，教育与技能置于窄栏，项目与研究在主栏连续呈现。",
    base: "azurill",
    columns: 2,
  },
  {
    id: "lapis-cn",
    name: "LapisCV · 中文单栏",
    description: "居中姓名与联系行，细线分区，适合校招与实习。",
    base: "meowth",
    columns: 1,
  },
  {
    id: "gengar-cn",
    name: "清晰双栏",
    description: "侧栏呈现技能与联系信息，主栏保留完整经历。",
    base: "gengar",
    columns: 2,
  },
  {
    id: "rhyhorn-cn",
    name: "科研与长材料",
    description: "横向联系信息和清楚的条目层级，内容自然续页。",
    base: "rhyhorn",
    columns: 1,
  },
  {
    id: "billryan-cn",
    name: "中文专业 · 双层条目",
    description: "居中姓名、学校企业与日期同排，角色独立成行；参考 billryan。",
    base: "onyx",
    columns: 1,
  },
  {
    id: "onyx-cn",
    name: "清楚横眉",
    description: "左对齐姓名、页首横线与紧凑联系行，模块保持自然段层级。",
    base: "onyx",
    columns: 1,
  },
  {
    id: "lapras-cn",
    name: "商务分区",
    description: "通栏信息页首与线框分节，适合信息清楚的校招材料。",
    base: "lapras",
    columns: 1,
  },
  {
    id: "scizor-cn",
    name: "细线专业",
    description: "轻量细线分区、左侧姓名与日期信息，保留长经历正文。",
    base: "scizor",
    columns: 1,
  },
  {
    id: "azurill-cn",
    name: "双栏留白",
    description: "全宽页首、独立短信息侧栏和宽阔经历主栏。",
    base: "azurill",
    columns: 2,
  },
  {
    id: "bronzor-cn",
    name: "栏目索引",
    description: "窄列模块名与宽列正文形成索引式阅读，不切碎项目。",
    base: "bronzor",
    columns: 1,
  },
  {
    id: "chikorita-cn",
    name: "简洁侧栏",
    description: "主经历与辅助信息分栏，轻量标题标记组织中文内容。",
    base: "chikorita",
    columns: 2,
  },
  {
    id: "kakuna-cn",
    name: "居中分节",
    description: "居中姓名与模块标题、连续单栏正文，适合清晰的校招材料。",
    base: "kakuna",
    columns: 1,
  },
  {
    id: "ditto-cn",
    name: "横带双栏",
    description: "通栏姓名横带、独立联系行与左右内容区域，照片可选。",
    base: "ditto",
    columns: 2,
  },
  {
    id: "glalie-cn",
    name: "侧栏名片",
    description: "浅色辅助栏容纳个人名片和工具，主栏连续呈现经历。",
    base: "glalie",
    columns: 2,
  },
  {
    id: "ditgar-cn",
    name: "分区履历",
    description: "侧栏姓名与资料、主栏引言及强调条目头部，适合项目表达。",
    base: "ditgar",
    columns: 2,
  },
  {
    id: "leafish-cn",
    name: "简介横眉",
    description: "个人简介融入页首、独立联系横条，下面按主辅栏展开经历。",
    base: "leafish",
    columns: 2,
  },
  {
    id: "pikachu-cn",
    name: "主栏名片",
    description: "姓名与联系信息位于宽主栏，窄侧栏独立呈现技能和语言。",
    base: "pikachu",
    columns: 2,
  },
] as const;
export type NativeTemplateId = (typeof nativeTemplateCatalog)[number]["id"];
export const recommendedNativeTemplateIds = [
  "studio-clear-cn",
  "studio-compact-cn",
  "studio-main-cn",
  "studio-research-cn",
] as const satisfies readonly NativeTemplateId[];

/** Applying a design replaces layout defaults once; never changes content or visibility. */
export function applyNativeTemplate(
  document: NativeResumeDocument,
  id: NativeTemplateId,
): NativeResumeDocument {
  const template = nativeTemplateCatalog.find((item) => item.id === id);
  if (!template) throw new Error("NATIVE_TEMPLATE_NOT_FOUND");
  const next = structuredClone(document),
    m = next.data.metadata;
  next.presentation = { id, version: 1 };
  m.template = template.base;
  delete m.stylesheet;
  m.styleRules = [];
  for (const section of [
    next.data.summary,
    ...Object.values(next.data.sections),
    ...next.data.customSections,
  ]) {
    section.startOnNewPage = false;
    section.keepTogether = false;
  }
  m.page = {
    ...m.page,
    format: "a4",
    locale: "zh-CN",
    marginX: id === "billryan-cn" ? 57.6 : id === "lapis-cn" ? 42 : 36,
    marginY: id === "billryan-cn" ? 44 : id === "lapis-cn" ? 34 : 30,
    gapX: 10,
    gapY: 7,
    hideIcons: true,
    hideSectionIcons: true,
    keepHeadingsWithContent: true,
    respectSectionPlacement: true,
    labelSupplementalFields: true,
  };
  // Template spacing is independent of the paper margin. LapisCV's 2.4 mm
  // section top margin is about 6.8 pt; the heading handles its own inner gap.
  // Historical saved layouts without sectionGap retain the reader's fallback.
  m.page.sectionGap = id === "lapis-cn" ? 6.8 : id === "billryan-cn" ? 12 : 10;
  m.typography.body = {
    fontFamily: "Noto Sans SC",
    fontWeights: ["400", "700"],
    fontSize: id === "billryan-cn" ? 11 : 10,
    lineHeight: id === "lapis-cn" ? 1.8 : id === "billryan-cn" ? 1.4 : 1.5,
  };
  m.typography.heading = {
    fontFamily: "Noto Sans SC",
    fontWeights: ["400", "700"],
    fontSize: id === "bronzor-cn" ? 15 : id === "scizor-cn" ? 11 : 12,
    lineHeight: 1.2,
  };
  m.design.colors = {
    ...m.design.colors,
    primary: id === "lapis-cn" ? "rgba(72, 112, 173, 1)" : "rgba(38, 62, 73, 1)",
    text: "rgba(38, 42, 48, 1)",
    background: "rgba(255, 255, 255, 1)",
  };
  if (id === "deedy-cn") {
    m.page.marginX = 35.43;
    m.page.marginY = 21.26;
    m.page.sectionGap = 8;
    m.page.gapX = 20;
    m.typography.body.fontFamily = "Noto Serif SC";
    m.typography.body.lineHeight = 1.35;
    m.typography.heading.fontFamily = "Noto Serif SC";
    m.typography.heading.fontSize = 16;
    m.design.colors.primary = "rgba(106, 106, 106, 1)";
    m.design.colors.text = "rgba(43, 43, 43, 1)";
  }
  if (id === "engineer-cn") {
    m.page.marginX = 24;
    m.page.marginY = 28;
    m.page.sectionGap = 14;
    m.typography.body.fontSize = 10.5;
    m.typography.body.lineHeight = 1.45;
    m.design.colors.primary = "rgba(2, 132, 199, 1)";
    m.design.colors.text = "rgba(51, 65, 85, 1)";
  }
  if (id === "swiss-cn") {
    m.page.marginX = 36;
    m.page.marginY = 30;
    m.page.sectionGap = 14;
    m.typography.body.lineHeight = 1.45;
    m.design.colors.primary = "rgba(220, 38, 38, 1)";
    m.design.colors.text = "rgba(24, 24, 27, 1)";
  }
  if (id === "visiky-single-cn") {
    m.page.marginX = 18;
    m.page.marginY = 24;
    m.page.sectionGap = 9;
    m.typography.body.fontSize = 10.5;
    m.typography.body.lineHeight = 1.45;
    m.design.colors.primary = "rgba(44, 107, 139, 1)";
  }
  if (id === "modern-cn") {
    m.page.marginX = 24;
    m.page.marginY = 24;
    m.page.sectionGap = 18;
    m.typography.body.fontSize = 10.5;
    m.typography.body.lineHeight = 1.5;
    m.design.colors.primary = "rgba(233, 69, 96, 1)";
  }
  if (id === "euro-cn") {
    m.page.marginX = 30;
    m.page.marginY = 30;
    m.page.sectionGap = 15;
    m.typography.body.fontSize = 10.5;
    m.typography.body.lineHeight = 1.45;
    m.design.colors.primary = "rgba(30, 64, 175, 1)";
  }
  if (id === "magic-compact-cn") {
    m.page.marginX = 21;
    m.page.marginY = 21;
    m.page.sectionGap = 8;
    m.page.gapY = 6;
    m.typography.body.fontSize = 10;
    m.typography.body.lineHeight = 1.35;
    m.typography.heading.fontSize = 13.5;
    m.design.colors.primary = "rgba(0, 0, 0, 1)";
    m.design.colors.text = "rgba(0, 0, 0, 1)";
  }
  if (id === "magic-executive-cn") {
    m.page.marginX = 30;
    m.page.marginY = 30;
    m.page.sectionGap = 13.5;
    m.typography.body.fontSize = 10.5;
    m.typography.body.lineHeight = 1.55;
    m.typography.heading.fontSize = 12.75;
    m.design.colors.primary = "rgba(30, 64, 175, 1)";
    m.design.colors.text = "rgba(15, 23, 42, 1)";
  }
  if (["magic-formal-cn", "magic-product-cn", "magic-clean-cn"].includes(id)) {
    const formal = id === "magic-formal-cn",
      product = id === "magic-product-cn";
    m.page.marginX = formal ? 22.5 : product ? 18 : 18;
    m.page.marginY = formal ? 22.5 : 24;
    m.page.sectionGap = formal ? 9 : product ? 15 : 18;
    m.typography.body.fontSize = formal ? 9.75 : 10;
    m.typography.body.lineHeight = formal ? 1.45 : product ? 1.6 : 1.5;
    m.typography.heading.fontSize = formal ? 11.25 : 12;
    m.design.colors.primary = formal
      ? "rgba(29, 78, 216, 1)"
      : product
        ? "rgba(15, 118, 110, 1)"
        : "rgba(0, 0, 0, 1)";
  }
  if (["jp-classic-cn", "jp-ats-cn", "jp-academic-cn"].includes(id)) {
    m.page.marginX = 30;
    m.page.marginY = 30;
    m.page.sectionGap = id === "jp-classic-cn" ? 15 : 12;
    m.typography.body.fontSize = 10.5;
    m.typography.body.lineHeight = 1.5;
    m.typography.heading.fontSize =
      id === "jp-academic-cn" ? 10 : id === "jp-classic-cn" ? 10.5 : 12;
    m.design.colors.primary = "rgba(39, 39, 42, 1)";
    if (id === "jp-academic-cn") {
      m.typography.body.fontFamily = "Noto Serif SC";
      m.typography.heading.fontFamily = "Noto Serif SC";
    }
  }
  if (["jp-scientist-cn", "jp-berlin-cn", "jp-blocks-cn"].includes(id)) {
    m.page.marginX = id === "jp-berlin-cn" ? 24 : 30;
    m.page.marginY = id === "jp-berlin-cn" ? 24 : 30;
    m.page.sectionGap = id === "jp-blocks-cn" ? 15 : 18;
    m.typography.body.fontSize = 10.5;
    m.typography.body.lineHeight = 1.5;
    m.typography.heading.fontSize = 10.5;
    m.design.colors.primary =
      id === "jp-scientist-cn"
        ? "rgba(8, 145, 178, 1)"
        : id === "jp-berlin-cn"
          ? "rgba(37, 99, 235, 1)"
          : "rgba(35, 131, 226, 1)";
    if (id === "jp-scientist-cn") {
      m.typography.body.fontFamily = "Noto Serif SC";
      m.typography.heading.fontFamily = "Noto Serif SC";
    }
  }
  if (id === "jp-designer-cn") {
    m.page.marginX = 24;
    m.page.marginY = 24;
    m.page.sectionGap = 18;
    m.typography.body.fontSize = 10.5;
    m.typography.body.lineHeight = 1.5;
    m.typography.heading.fontSize = 12;
    m.design.colors.primary = "rgba(255, 107, 107, 1)";
  }
  if (id === "jp-ribbon-cn") {
    m.page.marginX = 24;
    m.page.marginY = 24;
    m.page.sectionGap = 15;
    m.typography.body.fontSize = 10.5;
    m.typography.body.lineHeight = 1.5;
    m.typography.heading.fontSize = 12;
    m.design.colors.primary = "rgba(220, 38, 38, 1)";
  }
  if (id === "jp-minimal-cn") {
    m.page.marginX = 36;
    m.page.marginY = 36;
    m.page.sectionGap = 16;
    m.typography.body.fontSize = 10.5;
    m.typography.body.lineHeight = 1.5;
    m.typography.heading.fontSize = 12;
    m.design.colors.primary = "rgba(37, 99, 235, 1)";
  }
  if (id === "rendercv-classic-cn") {
    m.page.marginX = 40;
    m.page.marginY = 40;
    m.page.sectionGap = 14.2;
    m.typography.body.fontSize = 10;
    m.typography.body.lineHeight = 1.6;
    m.typography.heading.fontSize = 12;
    m.design.colors.primary = "rgba(0, 79, 144, 1)";
  }
  if (id === "rendercv-engineering-cn") {
    m.page.marginX = 40;
    m.page.marginY = 40;
    m.page.sectionGap = 14.2;
    m.typography.body.fontSize = 10;
    m.typography.body.lineHeight = 1.6;
    m.typography.heading.fontSize = 12;
    m.design.colors.primary = "rgba(0, 0, 0, 1)";
    m.typography.body.fontFamily = "Noto Serif SC";
    m.typography.heading.fontFamily = "Noto Serif SC";
  }
  const order = [...new Set(m.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]))];
  if (id.startsWith("studio-")) {
    const compact = id === "studio-compact-cn",
      research = id === "studio-research-cn";
    m.page.marginX = compact ? 34 : 40;
    m.page.marginY = compact ? 30 : 38;
    m.page.sectionGap = compact ? 9 : 14;
    m.page.gapY = compact ? 5 : 8;
    m.page.gapX = 22;
    m.typography.body.fontSize = compact ? 10 : 10.5;
    m.typography.body.lineHeight = compact ? 1.38 : 1.5;
    m.typography.heading.fontSize = 12;
    m.typography.body.fontFamily = research ? "Noto Serif SC" : "Noto Sans SC";
    m.typography.heading.fontFamily = m.typography.body.fontFamily;
    m.design.colors.primary = research ? "rgba(35, 44, 48, 1)" : "rgba(36, 66, 79, 1)";
  }
  const side = new Set(["skills", "languages", "certifications", "profiles"]);
  if (id === "deedy-cn") side.add("education");
  if (id === "visiky-cn") {
    for (const key of ["education", "summary", "awards", "interests"]) side.add(key);
    m.page.marginX = 18;
    m.page.marginY = 18;
    m.page.sectionGap = 14;
    m.design.colors.primary = "rgba(44, 107, 139, 1)";
    m.typography.body.lineHeight = 1.45;
  }
  m.layout = {
    sidebarWidth: id === "deedy-cn" ? 25 : id === "visiky-cn" ? 40 : 30,
    pages: [
      {
        fullWidth: template.columns === 1,
        main: order.filter((key) => template.columns === 1 || !side.has(key)),
        sidebar: template.columns === 2 ? order.filter((key) => side.has(key)) : [],
      },
    ],
  };
  return next;
}
