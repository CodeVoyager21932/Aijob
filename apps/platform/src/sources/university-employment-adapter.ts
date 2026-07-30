import { inflateSync } from "node:zlib";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";
import { htmlToDeterministicLines } from "./nankai-tal-2027-adapter.js";
import {
  known,
  type NormalizedOfficialJob,
  semanticRevisionValue,
  unknown,
} from "./normalized-official-job.js";
import { isCompanyDomainEmail } from "./official-account-manual-adapter.js";

export const UNIVERSITY_EMPLOYMENT_ADAPTER_VERSION = "0.1.0";
export const UNIVERSITY_EMPLOYMENT_NORMALIZER_VERSION = "0.1.0";

/**
 * 高校就业网详情页共享适配器（审批包 02，2026-07-26 契约冻结）。
 *
 * 岗位正文取自高校公开详情页（每页一岗、单请求、无会话依赖，均以服务端无 Cookie
 * curl 复现验证）；投递方式按 ADR-0017：company_email 必须是企业官方域名邮箱且
 * 原句在页面出现，official_url 必须与页面原文明示的投递网址完全一致。
 *
 * 四种载体页面格式在核验时人工冻结：
 * - nankai-correcruit：career.nankai.edu.cn 实习信息栏目详情页（meta keywords 含
 *   "实习信息" 为官方实习标记；字段为 div.zpxx 标签值对）。
 * - cuhk-jobview：career.cuhk.edu.cn 招聘详情页（"工作性质：实习" 为官方标记；
 *   中文版路径为契约页，英文版仅作发现证据）。
 * - zju-jyxt：www.career.zju.edu.cn 岗位详情页（工作性质 span 含 "实习" 为官方
 *   标记；与 "全职" 并存时仍导入但写 SOURCE_KIND_CONFLICT 复核项）。
 * - gdut-campus：career.gdut.edu.cn 招聘简章详情页；正文以页面自带的 zlib +
 *   Base64 静态载荷发布，一张简章可包含多条带独立职责和要求的实习岗位。
 */
export type UniversityEmploymentPageFormat =
  | "nankai-correcruit"
  | "nankai-correcruit-dtl"
  | "cuhk-jobview"
  | "zju-jyxt"
  | "gdut-campus";

export interface UniversityEmploymentSource {
  sourceKey: string;
  companyLegalName: string;
  companyDisplayName: string;
  officialDomain: string;
  pageFormat: UniversityEmploymentPageFormat;
  /** 冻结的详情页列表（每页一岗），按主证据页优先、官方列表顺序排列。 */
  pageUrls: string[];
  application:
    | {
        type: "official_url";
        url: string;
        verification?: "page_exact" | "browser_verified_official_ats";
      }
    | { type: "company_email" };
}

const universityEmploymentSourceList: UniversityEmploymentSource[] = [
  {
    sourceKey: "supvan-info-internships",
    // supvan.com.cn 页脚以营业执照标注该主体；投递网址 supvan.com 属关联主体
    // 硕方科技（北京）有限公司，但为南开页面原文明示的官方投递入口（Moka 先例）。
    companyLegalName: "北京硕方信息技术有限公司",
    companyDisplayName: "硕方信息",
    officialDomain: "supvan.com.cn",
    pageFormat: "nankai-correcruit",
    pageUrls: [
      "https://career.nankai.edu.cn/correcruit/content/id/116240.html",
      "https://career.nankai.edu.cn/correcruit/content/id/116239.html",
      "https://career.nankai.edu.cn/correcruit/content/id/116238.html",
      "https://career.nankai.edu.cn/correcruit/content/id/116237.html",
      "https://career.nankai.edu.cn/correcruit/content/id/116236.html",
      "https://career.nankai.edu.cn/correcruit/content/id/116235.html",
    ],
    // 页面邮箱域 jtsupvan.com 无法核验主体归属，按白名单拒绝，只保留官方投递网址。
    application: { type: "official_url", url: "https://www.supvan.com/joinUs" },
  },
  {
    sourceKey: "jcquant-internships",
    companyLegalName: "深圳市鲸驰寰宇科技有限公司",
    companyDisplayName: "鲸驰寰宇",
    // 港中深页面原文明示 Official website：https://www.jcquant.vip，与投递邮箱同域。
    officialDomain: "jcquant.vip",
    pageFormat: "cuhk-jobview",
    pageUrls: ["https://career.cuhk.edu.cn/job/view/id/466931"],
    application: { type: "company_email" },
  },
  {
    sourceKey: "shengumedia-internships",
    companyLegalName: "北京神谷文化传播有限公司",
    companyDisplayName: "神谷文化",
    // 无可达官网；工商登记信息记录的企业邮箱与投递邮箱同域（shengumedia.com）。
    officialDomain: "shengumedia.com",
    pageFormat: "cuhk-jobview",
    pageUrls: ["https://career.cuhk.edu.cn/job/view/id/467659"],
    application: { type: "company_email" },
  },
  {
    sourceKey: "hr-soft-internships",
    companyLegalName: "广州红海云计算股份有限公司",
    companyDisplayName: "红海云",
    // hr-soft.cn 页脚版权与 ICP 备案主体与岗位发布主体完全一致。
    officialDomain: "hr-soft.cn",
    pageFormat: "zju-jyxt",
    pageUrls: [
      "https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4DE5B03172671701E0653A68DD0E9B18",
    ],
    application: { type: "company_email" },
  },
  {
    sourceKey: "allwinner-gdut-internships",
    companyLegalName: "珠海全志科技股份有限公司",
    companyDisplayName: "全志科技",
    officialDomain: "allwinnertech.com",
    pageFormat: "gdut-campus",
    pageUrls: ["https://career.gdut.edu.cn/campus/view/id/1020713"],
    application: {
      type: "official_url",
      url: "https://campus.allwinnertech.com/campus-recruitment/allwinnertech/43436/#/jobs?zhineng%5B0%5D=240584",
      verification: "browser_verified_official_ats",
    },
  },
  {
    sourceKey: "citics-shanghai-summer-internship",
    companyLegalName: "中信证券股份有限公司上海分公司",
    companyDisplayName: "中信证券上海分公司",
    officialDomain: "citics.com",
    pageFormat: "cuhk-jobview",
    pageUrls: ["https://career.cuhk.edu.cn/job/view/id/468515"],
    application: {
      type: "official_url",
      url: "https://careers.citics.com/mobile/position/detail?resumeType=3&recruitType=08&practice=1&deptype=Branch&pagetype=xz&positionNo=5468&deptNo=637&status=&full=0",
      verification: "browser_verified_official_ats",
    },
  },
  {
    sourceKey: "kunlunxin-internships",
    companyLegalName: "昆仑芯（北京）科技股份有限公司",
    companyDisplayName: "昆仑芯",
    officialDomain: "kunlunxin.com",
    pageFormat: "zju-jyxt",
    pageUrls: [
      "https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=53F7344A6F204A94E0653A68DD0E9B18",
    ],
    application: { type: "company_email" },
  },
  {
    sourceKey: "dingwei-consulting-internships",
    companyLegalName: "北京鼎帷管理顾问有限公司",
    companyDisplayName: "北京鼎帷",
    officialDomain: "dwmcts.com",
    pageFormat: "zju-jyxt",
    pageUrls: [
      "https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4F7B3CC147F24EB6E0653A68DD0E9B18",
    ],
    application: { type: "company_email" },
  },
  {
    sourceKey: "sharecapital-internships",
    companyLegalName: "深圳市分享成长投资管理有限公司",
    companyDisplayName: "分享投资",
    officialDomain: "sharecapital.cn",
    pageFormat: "cuhk-jobview",
    pageUrls: ["https://career.cuhk.edu.cn/job/view/id/467309"],
    application: { type: "company_email" },
  },
  {
    sourceKey: "dtl-quant-internships",
    companyLegalName: "北京道泰量合私募基金管理有限公司",
    companyDisplayName: "DTL量化",
    officialDomain: "dytechlab.com",
    pageFormat: "nankai-correcruit-dtl",
    pageUrls: ["https://career.nankai.edu.cn/correcruit/content/id/116147.html"],
    application: {
      type: "official_url",
      url: "https://www.dytechlab.com/careers",
    },
  },
];

export function resolveUniversityEmploymentSource(sourceKey: string): UniversityEmploymentSource {
  const source = universityEmploymentSourceList.find((entry) => entry.sourceKey === sourceKey);
  if (!source) throw new Error("UNIVERSITY_EMPLOYMENT_SOURCE_NOT_CONFIGURED");
  return source;
}

export function listUniversityEmploymentSources(): readonly UniversityEmploymentSource[] {
  return universityEmploymentSourceList;
}

export interface UniversityEmploymentJob {
  sourceJobId: string;
  pageUrl: string;
  companyName: string;
  title: string;
  category: string | undefined;
  locationText: string | undefined;
  /** 官方工作性质原文；nankai 栏目式页面固定为“实习”。 */
  employmentTypeText: string;
  educationText: string | undefined;
  headcountText: string | undefined;
  publishedAt: string | undefined;
  deadline: string | undefined;
  responsibilities: string;
  requirements: string;
  /** 页面正文/联系区内出现的全部去重邮箱及其原句。 */
  emails: Array<{ email: string; sourceText: string }>;
  applicationUrlOnPage: string | undefined;
  /** 正文含“工作城市：”等多城市补充说明时为 true，进复核项。 */
  hasMultiCitySupplement: boolean;
}

const datePattern = /\d{4}-\d{2}-\d{2}/;
const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function decodeTitleEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .trim();
}

function labelValue(lines: string[], label: string): string | undefined {
  const line = lines.find((entry) => entry.startsWith(label));
  const value = line?.slice(label.length).trim();
  return value ? value : undefined;
}

function collectEmails(lines: string[]): Array<{ email: string; sourceText: string }> {
  const found = new Map<string, string>();
  for (const line of lines) {
    for (const match of line.matchAll(emailPattern)) {
      const email = match[0].toLowerCase();
      if (!found.has(email)) found.set(email, line);
    }
  }
  return [...found.entries()].map(([email, sourceText]) => ({ email, sourceText }));
}

function pageIdentity(format: UniversityEmploymentPageFormat, pageUrl: string): string {
  const patterns: Record<UniversityEmploymentPageFormat, RegExp> = {
    "nankai-correcruit": /\/correcruit\/content\/id\/(\d+)\.html$/,
    "nankai-correcruit-dtl": /\/correcruit\/content\/id\/(\d+)\.html$/,
    "cuhk-jobview": /\/job\/view\/id\/(\d+)$/,
    "zju-jyxt": /[?&]zpxxbh=([0-9A-F]+)$/i,
    "gdut-campus": /\/campus\/view\/id\/(\d+)$/,
  };
  const match = pageUrl.match(patterns[format]);
  if (!match?.[1]) throw new Error("UNIVERSITY_EMPLOYMENT_PAGE_URL_UNRECOGNIZED");
  const prefix =
    format === "nankai-correcruit" || format === "nankai-correcruit-dtl"
      ? "nankai"
      : format === "cuhk-jobview"
        ? "cuhk"
        : format === "zju-jyxt"
          ? "zju"
          : "gdut";
  return `${prefix}-${match[1]}`;
}

function sectionBetween(lines: string[], startIndex: number, stops: string[]): string[] {
  const rest = lines.slice(startIndex + 1);
  const stopOffset = rest.findIndex((line) => stops.some((stop) => line === stop));
  return stopOffset < 0 ? rest : rest.slice(0, stopOffset);
}

function splitRequirements(bodyLines: string[]): {
  responsibilities: string;
  requirements: string;
} {
  const markerIndex = bodyLines.findIndex((line) =>
    /^(?:[【[]?\s*(?:任职要求|职位要求)|\d+[.、]\s*要求)/.test(line.normalize("NFKC")),
  );
  if (markerIndex < 0) throw new Error("UNIVERSITY_EMPLOYMENT_REQUIREMENTS_SECTION_MISSING");
  const requirementLines = bodyLines.slice(markerIndex);
  const stopIndex = requirementLines.findIndex(
    (line, index) =>
      index > 0 && /^(?:关于我们|申请方式|企业简介|其他信息)$/u.test(line.normalize("NFKC")),
  );
  return {
    responsibilities: bodyLines.slice(0, markerIndex).join("\n"),
    requirements: (stopIndex < 0 ? requirementLines : requirementLines.slice(0, stopIndex)).join(
      "\n",
    ),
  };
}

// 官方地区原文形如“北京市”“广东省 - 深圳市”“浙江省杭州市滨江区”；取市级并去“市”后缀。
export function normalizeUniversityLocation(value: string): string | undefined {
  const segments = value
    .normalize("NFKC")
    .split(/[-·]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const last = segments.at(-1) ?? "";
  const cityMatch = last.match(/^(?:.*?省)?(.+?市)/);
  const city = cityMatch?.[1] ?? (last || undefined);
  if (!city) return undefined;
  return city.length > 2 && city.endsWith("市") ? city.slice(0, -1) : city.replace(/市$/, "");
}

export function parseNankaiCorrecruitPage(html: string, pageUrl: string): UniversityEmploymentJob {
  // 南开实习信息栏目页在 meta keywords 中携带栏目标记；缺失即视为脱离实习栏目。
  if (!/<meta\s+name="keywords"\s+content="[^"]*实习信息/.test(html)) {
    throw new Error("UNIVERSITY_EMPLOYMENT_NOT_INTERNSHIP_SECTION");
  }
  const titleTag = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const decodedTitle = titleTag ? decodeTitleEntities(titleTag) : "";
  const separatorIndex = decodedTitle.lastIndexOf("-");
  if (separatorIndex <= 0 || separatorIndex >= decodedTitle.length - 1) {
    throw new Error("UNIVERSITY_EMPLOYMENT_TITLE_MISSING");
  }
  const title = decodedTitle.slice(0, separatorIndex).trim();
  const companyName = decodedTitle.slice(separatorIndex + 1).trim();

  const lines = htmlToDeterministicLines(html);
  const requirementStart = lines.findIndex((line) => /^\*\s*专业要求/.test(line));
  const descriptionStart = lines.findIndex((line) => /^\*\s*职位描述/.test(line));
  if (requirementStart < 0 || descriptionStart < 0 || descriptionStart <= requirementStart) {
    throw new Error("UNIVERSITY_EMPLOYMENT_REQUIREMENTS_SECTION_MISSING");
  }
  const requirementLines = lines.slice(requirementStart + 1, descriptionStart);
  const responsibilityLines = sectionBetween(lines, descriptionStart, ["实习信息", "友情链接"]);

  const educationText = labelValue(lines, "学历要求：");
  const headcountText = labelValue(lines, "招聘人数：");
  const publishedLine = lines.find((line) => line.startsWith("发布时间："));
  const publishedAt = publishedLine?.match(datePattern)?.[0];

  return {
    sourceJobId: pageIdentity("nankai-correcruit", pageUrl),
    pageUrl,
    companyName,
    title,
    category: labelValue(lines, "职位类别："),
    locationText: labelValue(lines, "工作地域："),
    employmentTypeText: "实习",
    educationText,
    headcountText,
    publishedAt,
    deadline: undefined,
    responsibilities: responsibilityLines.join("\n"),
    requirements: [
      ...(educationText ? [`学历要求：${educationText}`] : []),
      ...(headcountText ? [`招聘人数：${headcountText}`] : []),
      ...requirementLines,
    ].join("\n"),
    emails: collectEmails([labelValue(lines, "职位投递邮箱：") ?? ""]),
    applicationUrlOnPage: labelValue(lines, "职位投递网址链接："),
    hasMultiCitySupplement: false,
  };
}

export function parseCuhkJobViewPage(html: string, pageUrl: string): UniversityEmploymentJob {
  const title = html.match(/class="titles[^"]*">\s*([^<]+)/)?.[1]?.trim();
  if (!title) throw new Error("UNIVERSITY_EMPLOYMENT_TITLE_MISSING");

  const lines = htmlToDeterministicLines(html);
  const companyName = labelValue(lines, "公司名称：");
  if (!companyName) throw new Error("UNIVERSITY_EMPLOYMENT_COMPANY_MISSING");
  const employmentTypeText = labelValue(lines, "工作性质：");
  if (!employmentTypeText?.normalize("NFKC").includes("实习")) {
    throw new Error("UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP");
  }

  // 发布/结束时间位于相邻 span，可能被源码换行拆开，直接对原始 HTML 提取。
  const publishedAt = html.match(/发布时间：(\d{4}-\d{2}-\d{2})/)?.[1];
  const deadline = html.match(/结束时间：(\d{4}-\d{2}-\d{2})/)?.[1];

  const bodyStart = lines.findIndex((line) => line === "工作内容描述");
  if (bodyStart < 0) throw new Error("UNIVERSITY_EMPLOYMENT_BODY_SECTION_MISSING");
  const bodyLines = sectionBetween(lines, bodyStart, ["其他信息"]);
  const { responsibilities, requirements } = splitRequirements(bodyLines);

  return {
    sourceJobId: pageIdentity("cuhk-jobview", pageUrl),
    pageUrl,
    companyName,
    title,
    category: labelValue(lines, "职能类别："),
    locationText: labelValue(lines, "工作地点："),
    employmentTypeText,
    educationText: undefined,
    headcountText: labelValue(lines, "招聘人数："),
    publishedAt,
    deadline,
    responsibilities,
    requirements,
    emails: collectEmails(bodyLines),
    applicationUrlOnPage: undefined,
    hasMultiCitySupplement: bodyLines.some((line) => line.includes("工作城市：")),
  };
}

export function parseZjuJyxtPage(html: string, pageUrl: string): UniversityEmploymentJob {
  const companyName = html
    .match(/<div class="zp-dept">[\s\S]{0,300}?<h3>([^<]+)<\/h3>/)?.[1]
    ?.trim();
  if (!companyName) throw new Error("UNIVERSITY_EMPLOYMENT_COMPANY_MISSING");
  const title = html.match(/<div class="zp-info-left">\s*<h4>([^<]+)<\/h4>/)?.[1]?.trim();
  if (!title) throw new Error("UNIVERSITY_EMPLOYMENT_TITLE_MISSING");

  const lines = htmlToDeterministicLines(html);
  // 冻结的六段结构（span 之间存在源码换行，直接对原始 HTML 提取）：
  // 薪资 地区 工作性质 学历 人数 截止日期。
  const detailBlock = html.match(/<p class="zp-info-left-detail">([\s\S]*?)<\/p>/)?.[1] ?? "";
  const tokens = [...detailBlock.matchAll(/<span>([^<]*)<\/span>/g)]
    .map((match) => (match[1] ?? "").trim())
    .filter(Boolean);
  if (tokens.length !== 6 || !datePattern.test(tokens[5] ?? "") || !/人$/.test(tokens[4] ?? "")) {
    throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
  }
  const employmentTypeText = tokens[2] ?? "";
  if (!employmentTypeText.normalize("NFKC").includes("实习")) {
    throw new Error("UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP");
  }

  const publishedLine = lines.find((line) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(line));
  const bodyStart = lines.findIndex((line) => line === "职位描述");
  if (bodyStart < 0) throw new Error("UNIVERSITY_EMPLOYMENT_BODY_SECTION_MISSING");
  const rawBody = sectionBetween(lines, bodyStart, ["单位简介", "联系方式"]);
  const bodyLines = rawBody.filter((line, index) => !(index === 0 && line === "职位描述"));
  const { responsibilities, requirements } = splitRequirements(bodyLines);

  const applicationEmailLines = bodyLines.filter(
    (line) => line.includes("投递") && /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(line),
  );
  const contactStart = lines.findIndex((line) => line === "联系方式");
  const contactLines = contactStart >= 0 ? lines.slice(contactStart + 1) : [];
  const contactEmailLines = contactLines.filter((line) => line.startsWith("电子邮箱："));

  const educationText = tokens[3];
  return {
    sourceJobId: pageIdentity("zju-jyxt", pageUrl),
    pageUrl,
    companyName,
    title,
    category: labelValue(lines, "职位类别:") ?? labelValue(lines, "职位类别："),
    locationText: tokens[1],
    employmentTypeText,
    educationText,
    headcountText: tokens[4],
    publishedAt: publishedLine?.match(datePattern)?.[0],
    deadline: tokens[5],
    responsibilities,
    requirements: [...(educationText ? [`学历要求：${educationText}`] : []), requirements].join(
      "\n",
    ),
    emails: collectEmails(
      applicationEmailLines.length > 0 ? applicationEmailLines : contactEmailLines,
    ),
    applicationUrlOnPage: undefined,
    hasMultiCitySupplement: bodyLines.some((line) => line.includes("工作城市：")),
  };
}

const allwinnerRoles = [
  { code: "2701", title: "数字设计工程师", locationText: "珠海/西安/上海" },
  { code: "2702", title: "算法设计工程师", locationText: "珠海/西安" },
  { code: "2703", title: "算法测试工程师", locationText: "珠海/西安" },
  { code: "2704", title: "ATE测试系统设计工程师", locationText: "珠海" },
  { code: "2705", title: "嵌入式软件设计工程师", locationText: "珠海" },
  { code: "2706", title: "射频系统设计工程师", locationText: "珠海" },
  { code: "2707", title: "硬件工程师", locationText: "珠海" },
] as const;

function decodeGdutStaticContent(html: string): string {
  const blob = html.match(/unzip\(\s*"([A-Za-z0-9+/=]+)"\s*,?\s*\)/)?.[1];
  if (!blob) throw new Error("UNIVERSITY_EMPLOYMENT_GDUT_STATIC_PAYLOAD_MISSING");
  let inflated: string;
  try {
    inflated = inflateSync(Buffer.from(blob, "base64")).toString("utf8");
  } catch {
    throw new Error("UNIVERSITY_EMPLOYMENT_GDUT_STATIC_PAYLOAD_INVALID");
  }
  if (!inflated.startsWith("view2d") || inflated.length <= 56) {
    throw new Error("UNIVERSITY_EMPLOYMENT_GDUT_STATIC_PAYLOAD_INVALID");
  }
  const decoded = Buffer.from(inflated.slice(56), "base64").toString("utf8");
  if (!decoded.startsWith("view1d") || decoded.length <= 22) {
    throw new Error("UNIVERSITY_EMPLOYMENT_GDUT_STATIC_PAYLOAD_INVALID");
  }
  return decoded.slice(22);
}

function splitAllwinnerRoleText(lines: string[]): {
  responsibilities: string;
  requirements: string;
} {
  const responsibilities: string[] = [];
  const requirements: string[] = [];
  let section: "responsibilities" | "requirements" | undefined;
  for (const line of lines) {
    const normalized = line.normalize("NFKC").replace(/\s+/g, "");
    if (normalized === "一、任职资格") {
      section = "requirements";
      continue;
    }
    if (normalized === "二、职位描述") {
      section = "responsibilities";
      continue;
    }
    if (normalized === "三、职位方向" || normalized.startsWith("注:")) {
      section = undefined;
      continue;
    }
    if (section === "responsibilities") responsibilities.push(line);
    if (section === "requirements") requirements.push(line);
  }
  if (responsibilities.length === 0) {
    throw new Error("UNIVERSITY_EMPLOYMENT_BODY_SECTION_MISSING");
  }
  if (requirements.length === 0) {
    throw new Error("UNIVERSITY_EMPLOYMENT_REQUIREMENTS_SECTION_MISSING");
  }
  return {
    responsibilities: responsibilities.join("\n"),
    requirements: requirements.join("\n"),
  };
}

export function parseGdutCampusPage(html: string, pageUrl: string): UniversityEmploymentJob[] {
  const pageId = pageIdentity("gdut-campus", pageUrl);
  const companyName = html
    .match(/<div class="title-message">[\s\S]{0,300}?<h5>([^<]+)<\/h5>/)?.[1]
    ?.trim();
  if (!companyName) throw new Error("UNIVERSITY_EMPLOYMENT_COMPANY_MISSING");
  const deadline = html.match(/过期时间：\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const publishedAt = html.match(/发布时间：\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const content = decodeGdutStaticContent(html);
  const compactContent = content.replace(/\s+/g, "");
  if (!compactContent.includes("2027届实习生招聘")) {
    throw new Error("UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP");
  }
  const applicationUrlOnPage =
    content.match(/https:\/\/campus\.allwinnertech\.com(?:\/)?/)?.[0] ??
    content.match(/target=https%3A%2F%2Fcampus\.allwinnertech\.com%2F/i)?.[0];
  if (!applicationUrlOnPage) {
    throw new Error("UNIVERSITY_EMPLOYMENT_APPLICATION_METHOD_MISSING");
  }

  return allwinnerRoles.map((role, index) => {
    const start = content.search(new RegExp(`<strong>${role.code}(?:\\s|<)`));
    const nextCode = allwinnerRoles[index + 1]?.code;
    const end = nextCode
      ? content.search(new RegExp(`<strong>${nextCode}(?:\\s|<)`))
      : content.length;
    if (start < 0 || end <= start) {
      throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
    }
    const { responsibilities, requirements } = splitAllwinnerRoleText(
      htmlToDeterministicLines(content.slice(start, end)),
    );
    return {
      sourceJobId: `${pageId}-${role.code}`,
      pageUrl,
      companyName,
      title: role.title,
      category: "电子信息技术",
      locationText: role.locationText,
      employmentTypeText: "实习",
      educationText: undefined,
      headcountText: undefined,
      publishedAt,
      deadline,
      responsibilities,
      requirements,
      emails: [],
      applicationUrlOnPage: "https://campus.allwinnertech.com",
      hasMultiCitySupplement: role.locationText.includes("/"),
    };
  });
}

const dtlRoles = [
  "量化研究员",
  "量化研究员-机器学习",
  "基本面量化研究员",
  "交易算法研究员",
  "交易分析师",
  "软件工程师（系统、数据与基础设施）",
  "GPU工程师",
  "人力资源专员",
] as const;

export function parseDtlNankaiPage(html: string, pageUrl: string): UniversityEmploymentJob[] {
  const base = parseNankaiCorrecruitPage(html, pageUrl);
  const lines = htmlToDeterministicLines(html);
  if (!lines.some((line) => line.includes("Internship（纯实习）"))) {
    throw new Error("UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP");
  }

  return dtlRoles.map((title, index) => {
    const numberedTitle = `${index + 1}.${title}`;
    const start = lines.findIndex(
      (line) =>
        line.normalize("NFKC").replace(/\s+/g, "") ===
        numberedTitle.normalize("NFKC").replace(/\s+/g, ""),
    );
    const nextTitle = dtlRoles[index + 1];
    const end =
      nextTitle === undefined
        ? lines.findIndex((line, lineIndex) => lineIndex > start && line === "友情链接")
        : lines.findIndex(
            (line, lineIndex) =>
              lineIndex > start &&
              line.normalize("NFKC").replace(/\s+/g, "") ===
                `${index + 2}.${nextTitle}`.normalize("NFKC").replace(/\s+/g, ""),
          );
    if (start < 0 || end <= start) {
      throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
    }
    const roleLines = lines.slice(start + 1, end);
    const descriptionStart = roleLines.findIndex((line) => line === "职位描述");
    const requirementStart = roleLines.findIndex((line) => line === "任职要求");
    if (descriptionStart < 0 || requirementStart < 0 || requirementStart <= descriptionStart) {
      throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
    }
    const responsibilities = roleLines
      .slice(descriptionStart + 1, requirementStart)
      .filter((line) => line !== "主要职责")
      .join("\n");
    const requirements = roleLines
      .slice(requirementStart + 1)
      .filter((line) => line !== "加分项")
      .join("\n");
    if (!responsibilities || !requirements) {
      throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
    }
    return {
      ...base,
      sourceJobId: `${pageIdentity("nankai-correcruit", pageUrl)}-dtl-${String(index + 1).padStart(2, "0")}`,
      title,
      responsibilities,
      requirements,
      emails: [],
    };
  });
}

export function parseUniversityEmploymentJobs(input: {
  format: UniversityEmploymentPageFormat;
  html: string;
  pageUrl: string;
}): UniversityEmploymentJob[] {
  if (input.format === "gdut-campus") {
    return parseGdutCampusPage(input.html, input.pageUrl);
  }
  if (input.format === "nankai-correcruit-dtl") {
    return parseDtlNankaiPage(input.html, input.pageUrl);
  }
  return [parseUniversityEmploymentPage(input)];
}

export function parseUniversityEmploymentPage(input: {
  format: UniversityEmploymentPageFormat;
  html: string;
  pageUrl: string;
}): UniversityEmploymentJob {
  switch (input.format) {
    case "nankai-correcruit":
      return parseNankaiCorrecruitPage(input.html, input.pageUrl);
    case "nankai-correcruit-dtl": {
      const [job] = parseDtlNankaiPage(input.html, input.pageUrl);
      if (!job) throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
      return job;
    }
    case "cuhk-jobview":
      return parseCuhkJobViewPage(input.html, input.pageUrl);
    case "zju-jyxt":
      return parseZjuJyxtPage(input.html, input.pageUrl);
    case "gdut-campus": {
      const [job] = parseGdutCampusPage(input.html, input.pageUrl);
      if (!job) throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
      return job;
    }
  }
}

function captureMinimum(value: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

function graduationYears(value: string): number[] {
  return [
    ...new Set(
      [...value.matchAll(/(20\d{2})\s*届/gu)]
        .map((match) => Number(match[1]))
        .filter(Number.isInteger),
    ),
  ];
}

export function normalizeUniversityEmploymentJob(input: {
  source: UniversityEmploymentSource;
  job: UniversityEmploymentJob;
  pageEvidenceRef: string;
}): NormalizedOfficialJob {
  const { source, job, pageEvidenceRef } = input;
  if (job.companyName.normalize("NFKC").trim() !== source.companyLegalName) {
    throw new Error("UNIVERSITY_EMPLOYMENT_COMPANY_MISMATCH");
  }
  if (!job.employmentTypeText.normalize("NFKC").includes("实习")) {
    throw new Error("UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP");
  }

  const qualityFlags: NormalizedOfficialJob["qualityFlags"] = [];
  const reviewReasons: NormalizedOfficialJob["reviewReasons"] = [
    { code: "SOURCE_POLICY_PENDING", details: { source: source.sourceKey } },
  ];

  let applyUrl: string | null = null;
  let applicationEmail: string | undefined;
  let applicationEmailSourceText: string | undefined;
  if (source.application.type === "official_url") {
    const onPage = job.applicationUrlOnPage?.normalize("NFKC").trim();
    if (
      (source.application.verification ?? "page_exact") === "page_exact" &&
      onPage !== source.application.url
    ) {
      throw new Error("UNIVERSITY_EMPLOYMENT_APPLY_URL_MISMATCH");
    }
    applyUrl = source.application.url;
    // 页面同时给出的邮箱若不属于企业官方域名，按白名单拒绝并留痕。
    const rejectedEmail = job.emails.find(
      (entry) => !isCompanyDomainEmail(entry.email, source.officialDomain),
    );
    if (rejectedEmail) {
      qualityFlags.push({
        code: "COMPANY_EMAIL_DOMAIN_UNVERIFIED",
        detail: rejectedEmail.email.split("@")[1] ?? rejectedEmail.email,
      });
    }
  } else {
    if (job.emails.length !== 1) {
      throw new Error("UNIVERSITY_EMPLOYMENT_APPLICATION_EMAIL_AMBIGUOUS");
    }
    const candidate = job.emails[0];
    if (!candidate) throw new Error("UNIVERSITY_EMPLOYMENT_APPLICATION_EMAIL_AMBIGUOUS");
    const email = candidate.email.toLowerCase();
    if (
      !isCompanyDomainEmail(email, source.officialDomain) ||
      !candidate.sourceText.toLowerCase().includes(email)
    ) {
      throw new Error("UNIVERSITY_EMPLOYMENT_COMPANY_EMAIL_UNVERIFIED");
    }
    applicationEmail = email;
    applicationEmailSourceText = candidate.sourceText;
  }

  const family = classifyOfficialJobFamily({
    title: job.title,
    sourceLabels: job.category ? [job.category] : [],
    sourceEvidenceRef: pageEvidenceRef,
    titleEvidenceRef: pageEvidenceRef,
  });
  if (family.requiresManualReview) {
    qualityFlags.push({ code: "JOB_FAMILY_REVIEW_REQUIRED", detail: job.title });
    reviewReasons.push({ code: "JOB_FAMILY_REVIEW_REQUIRED", details: { title: job.title } });
  }

  const employmentType = job.employmentTypeText.normalize("NFKC").trim();
  if (employmentType !== "实习") {
    // 官方工作性质与纯实习标记矛盾（如“全职,实习”）：仍导入但留复核项。
    qualityFlags.push({ code: "SOURCE_KIND_CONFLICT", detail: employmentType });
    reviewReasons.push({
      code: "SOURCE_KIND_CONFLICT",
      details: { title: job.title, employmentType },
    });
  }
  if (job.hasMultiCitySupplement) {
    qualityFlags.push({ code: "MULTI_CITY_SUPPLEMENT", detail: job.title });
    reviewReasons.push({ code: "MULTI_CITY_SUPPLEMENT", details: { title: job.title } });
  }
  if (!job.responsibilities.trim()) {
    qualityFlags.push({ code: "SOURCE_FIELD_EMPTY", detail: "responsibilities" });
  }
  if (!job.requirements.trim()) {
    throw new Error("UNIVERSITY_EMPLOYMENT_REQUIREMENTS_SECTION_MISSING");
  }

  const cities = job.locationText
    ? [
        ...new Set(
          job.locationText
            .split(/[/、，,]/u)
            .map(normalizeUniversityLocation)
            .filter((city): city is string => Boolean(city)),
        ),
      ]
    : [];
  const combinedText = `${job.responsibilities}\n${job.requirements}`;
  const durationMonths = captureMinimum(combinedText, [
    /(?:至少|不少于|为期|连续实习)\s*(\d+)\s*个?月/u,
    /(\d+)\s*个?月(?:以上|及以上)/u,
  ]);
  const weeklyAttendanceDays = captureMinimum(combinedText, [
    /每周(?:至少|不少于|可实习|到岗|出勤)?\s*(\d+)\s*天/u,
    /一周(?:至少|不少于|可实习|到岗)?\s*(\d+)\s*天/u,
  ]);
  const years = graduationYears(combinedText);

  const normalizedWithoutHash = {
    sourceJobId: job.sourceJobId,
    companyName: source.companyDisplayName,
    title: job.title,
    jobFamily: family.value,
    locations: cities.length > 0 ? known(cities, [pageEvidenceRef]) : unknown<string[]>(),
    businessGroups: [],
    entryScope: "实习生",
    sourceProjectName: null,
    recruitLabelName: "实习",
    recruitmentType: known("实习", [pageEvidenceRef]),
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    structuredFields: {
      arrivalTime: unknown<string>(),
      weeklyAttendanceDays:
        weeklyAttendanceDays === undefined
          ? unknown<number>()
          : known(weeklyAttendanceDays, [pageEvidenceRef]),
      durationMonths:
        durationMonths === undefined ? unknown<number>() : known(durationMonths, [pageEvidenceRef]),
      graduationYears: years.length === 0 ? unknown<number[]>() : known(years, [pageEvidenceRef]),
      recruitmentBatch: known("实习", [pageEvidenceRef]),
      publishedAt:
        job.publishedAt === undefined
          ? unknown<string>()
          : known(job.publishedAt, [pageEvidenceRef]),
      deadline:
        job.deadline === undefined ? unknown<string>() : known(job.deadline, [pageEvidenceRef]),
      ...(applicationEmail && applicationEmailSourceText
        ? { applicationEmail, applicationEmailSourceText }
        : {}),
    },
    ingestionState: "validated" as const,
    publicationState: "review" as const,
    activityState: "active" as const,
    sourceUrl: job.pageUrl,
    applyUrl,
    qualityFlags,
    reviewReasons,
  };

  const applicationValue = applyUrl ?? applicationEmail ?? "";
  const evidenceFields: Array<["list" | "detail", string, string, string]> = [
    ["list", "title", "/page/title", sha256(job.title)],
    ["list", "recruitmentType", "/page/employmentType", sha256(job.employmentTypeText)],
    ["detail", "locations", "/page/location", sha256(job.locationText ?? "")],
    ["detail", "responsibilities", "/page/responsibilities", sha256(job.responsibilities)],
    ["detail", "requirements", "/page/requirements", sha256(job.requirements)],
    ["detail", "application", "/page/application", sha256(applicationValue)],
    ["detail", "publishedAt", "/page/publishedAt", sha256(job.publishedAt ?? "")],
    ["detail", "deadline", "/page/deadline", sha256(job.deadline ?? "")],
  ];

  return {
    ...normalizedWithoutHash,
    revisionContentHash: hashCanonicalJson({
      normalized: semanticRevisionValue(normalizedWithoutHash),
      adapterVersion: UNIVERSITY_EMPLOYMENT_ADAPTER_VERSION,
      normalizerVersion: UNIVERSITY_EMPLOYMENT_NORMALIZER_VERSION,
    }),
    evidence: evidenceFields.map(([role, fieldName, jsonPointer, rawValueHash]) => ({
      role,
      fieldName,
      jsonPointer,
      rawValueHash,
    })),
  };
}
