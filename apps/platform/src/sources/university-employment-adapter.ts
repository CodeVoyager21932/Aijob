import { inflateSync } from "node:zlib";
import { z } from "zod";
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

export const UNIVERSITY_EMPLOYMENT_ADAPTER_VERSION = "0.1.4";
export const UNIVERSITY_EMPLOYMENT_NORMALIZER_VERSION = "0.1.0";
export const SUSTECH_BYSJY_ADAPTER_VERSION = "0.1.0";
export const SUSTECH_BYSJY_NORMALIZER_VERSION = "0.1.0";

/**
 * 高校就业网详情页共享适配器（审批包 02，2026-07-26 契约冻结）。
 *
 * 岗位正文取自高校公开详情页（每页一岗、单请求、无会话依赖，均以服务端无 Cookie
 * curl 复现验证）；投递方式按 ADR-0017：company_email 必须是企业官方域名邮箱且
 * 原句在页面出现，official_url 必须与页面原文明示的投递网址完全一致。
 *
 * 五种载体页面格式在核验时人工冻结：
 * - nankai-correcruit：career.nankai.edu.cn 实习信息栏目详情页（meta keywords 含
 *   "实习信息" 为官方实习标记；字段为 div.zpxx 标签值对）。
 * - cuhk-jobview：career.cuhk.edu.cn 招聘详情页（"工作性质：实习" 为官方标记；
 *   中文版路径为契约页，英文版仅作发现证据）。
 * - zju-jyxt：www.career.zju.edu.cn 岗位详情页（工作性质 span 含 "实习" 为官方
 *   标记；与 "全职" 并存时仍导入但写 SOURCE_KIND_CONFLICT 复核项）。
 * - gdut-campus：career.gdut.edu.cn 招聘简章详情页；正文以页面自带的 zlib +
 *   Base64 静态载荷发布，一张简章可包含多条带独立职责和要求的实习岗位。
 * - hust-jobinfo：job.hust.edu.cn 高校就业详情页；一张页面可包含多条带独立职责、
 *   任职要求和岗位级企业邮箱的实习岗位，缺少职责时 fail-closed。
 */
export type UniversityEmploymentPageFormat =
  | "nankai-correcruit"
  | "nankai-correcruit-dtl"
  | "cuhk-jobview"
  | "zju-jyxt"
  | "gdut-campus"
  | "hust-jobinfo"
  | "sustech-bysjy";

const universityApplicationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("official_url"),
      url: z.string().url(),
      verification: z
        .enum(["page_exact", "browser_verified_official_ats"])
        .default("page_exact"),
    })
    .strict(),
  z.object({ type: z.literal("company_email") }).strict(),
]);

const configuredUniversityEmploymentOptionsSchema = z
  .object({
    pageFormat: z.enum([
      "nankai-correcruit",
      "nankai-correcruit-dtl",
      "cuhk-jobview",
      "zju-jyxt",
      "gdut-campus",
      "hust-jobinfo",
      "sustech-bysjy",
    ]),
    companyDisplayName: z.string().trim().min(1),
    companyPageAliases: z.array(z.string().trim().min(1)).default([]),
    application: universityApplicationSchema,
  })
  .strict();

export const UniversityEmploymentAdapterOptionsSchema = z.union([
  z.object({}).strict(),
  configuredUniversityEmploymentOptionsSchema,
]);

interface ConfiguredUniversityEmploymentSource {
  sourceKey: string;
  organization: {
    name: string;
    officialDomain: string;
  };
  policy: {
    adapterOptions: Record<string, unknown>;
    entrypoints: string[];
  };
}

export interface UniversityEmploymentSource {
  sourceKey: string;
  companyLegalName: string;
  companyDisplayName: string;
  /** Evidence-backed page names accepted in addition to the exact legal name. */
  companyPageAliases?: string[];
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
    sourceKey: "galasports-internships",
    companyLegalName: "深圳市望尘科技有限公司",
    companyDisplayName: "望尘科技",
    companyPageAliases: ["望尘科技"],
    officialDomain: "galasports.com",
    pageFormat: "cuhk-jobview",
    pageUrls: ["https://career.cuhk.edu.cn/job/view/id/468689"],
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
    sourceKey: "hanxu-tech-internships",
    companyLegalName: "寒序科技（北京）有限公司",
    companyDisplayName: "寒序科技",
    officialDomain: "icy.tech",
    pageFormat: "zju-jyxt",
    pageUrls: [
      "https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4CCE42B8467C9601E0653A68DD0E9B18",
      "https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4CCEE37BBB2DB309E0653A68DD0E9B18",
    ],
    application: {
      type: "official_url",
      url: "https://app.mokahr.com/campus-recruitment/hanxu/144645?locale=zh-CN#/",
    },
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
  {
    sourceKey: "unity-drive-internships",
    companyLegalName: "深圳一清创新科技有限公司",
    companyDisplayName: "一清创新",
    officialDomain: "unity-drive.com",
    pageFormat: "nankai-correcruit",
    pageUrls: [
      "https://career.nankai.edu.cn/correcruit/content/id/115887.html",
      "https://career.nankai.edu.cn/correcruit/content/id/115886.html",
      "https://career.nankai.edu.cn/correcruit/content/id/115885.html",
    ],
    application: { type: "company_email" },
  },
  {
    sourceKey: "triple-stone-internships",
    companyLegalName: "广东三石园科技有限公司",
    companyDisplayName: "三石园科技",
    officialDomain: "triple-stone.com",
    pageFormat: "nankai-correcruit",
    pageUrls: ["https://career.nankai.edu.cn/correcruit/content/id/116046.html"],
    application: { type: "company_email" },
  },
  {
    sourceKey: "anxin-fund-internships",
    companyLegalName: "安信基金管理有限责任公司",
    companyDisplayName: "安信基金",
    officialDomain: "essencefund.com",
    pageFormat: "sustech-bysjy",
    pageUrls: ["https://career.sustech.edu.cn/detail/online?id=3529493"],
    application: { type: "company_email" },
  },
];

export function resolveUniversityEmploymentSource(
  input: string | ConfiguredUniversityEmploymentSource,
): UniversityEmploymentSource {
  const sourceKey = typeof input === "string" ? input : input.sourceKey;
  if (typeof input !== "string") {
    const options = UniversityEmploymentAdapterOptionsSchema.parse(input.policy.adapterOptions);
    if ("pageFormat" in options) {
      return {
        sourceKey,
        companyLegalName: input.organization.name,
        companyDisplayName: options.companyDisplayName,
        ...(options.companyPageAliases.length === 0
          ? {}
          : { companyPageAliases: options.companyPageAliases }),
        officialDomain: input.organization.officialDomain,
        pageFormat: options.pageFormat,
        pageUrls: input.policy.entrypoints,
        application: options.application,
      };
    }
  }
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
    "hust-jobinfo": /\/zpinfo\d+\/(\d+)\.htm$/,
    "sustech-bysjy": /\/detail\/online\?id=(\d+)/,
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
          : format === "gdut-campus"
            ? "gdut"
            : format === "hust-jobinfo"
              ? "hust"
              : "sustech";
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
    /^(?:(?:[（(][一二三四五六七八九十]+[）)]|[【[])?\s*(?:任职要求|职位要求)|\d+[.、]\s*要求)/u.test(
      line.normalize("NFKC"),
    ),
  );
  if (markerIndex < 0) throw new Error("UNIVERSITY_EMPLOYMENT_REQUIREMENTS_SECTION_MISSING");
  const requirementLines = bodyLines.slice(markerIndex);
  const stopIndex = requirementLines.findIndex(
    (line, index) =>
      index > 0 &&
      /^(?:(?:关于我们|申请方式|企业简介|其他信息)$|(?:职位类别|专业要求|招聘链接)[：:])/u.test(
        line.normalize("NFKC"),
      ),
  );
  return {
    responsibilities: bodyLines.slice(0, markerIndex).join("\n"),
    requirements: (stopIndex < 0 ? requirementLines : requirementLines.slice(0, stopIndex)).join(
      "\n",
    ),
  };
}

function splitNankaiDescription(descriptionLines: string[]): {
  responsibilities: string[];
  requirements: string[];
} {
  const responsibilityMarkerIndex = descriptionLines.findIndex((line) =>
    /^(?:主要工作内容|岗位职责|实习职责|职位职责|工作职责)(?:[：:]|[（(])/u.test(
      line.normalize("NFKC"),
    ),
  );
  const jobLines =
    responsibilityMarkerIndex < 0
      ? descriptionLines
      : descriptionLines.slice(responsibilityMarkerIndex + 1);
  const requirementMarkerIndex = jobLines.findIndex((line) =>
    /^(?:任职要求|职位要求|针对对象|专业要求)(?:[：:]|$)/u.test(line.normalize("NFKC")),
  );
  if (requirementMarkerIndex < 0) {
    return { responsibilities: jobLines, requirements: [] };
  }
  const requirementLines = jobLines.slice(requirementMarkerIndex);
  const contactIndex = requirementLines.findIndex(
    (line, index) =>
      index > 0 &&
      /^(?:联系方式|联系电话|投递邮箱|公司官网)(?:[：:]|$)/u.test(line.normalize("NFKC")),
  );
  return {
    responsibilities: jobLines.slice(0, requirementMarkerIndex),
    requirements: contactIndex < 0 ? requirementLines : requirementLines.slice(0, contactIndex),
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
  // 这不是供给范围过滤，而是**页面身份**校验：本解析器写死了南开「实习信息」栏目的字段布局，
  // 栏目标记缺失说明拿到的不是该栏目的页面，继续按这套布局解析只会得出错的字段。原先记的
  // `UNIVERSITY_EMPLOYMENT_NOT_INTERNSHIP_SECTION` 属「软拒绝」，也就是页面换了还照样自动
  // 接受；改为结构变更后它是硬冲突，需要人工看一眼。
  if (!/<meta\s+name="keywords"\s+content="[^"]*实习信息/.test(html)) {
    throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
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
  const descriptionLines = sectionBetween(lines, descriptionStart, ["实习信息", "友情链接"]);
  const descriptionSections = splitNankaiDescription(descriptionLines);

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
    responsibilities: descriptionSections.responsibilities.join("\n"),
    requirements: [
      ...(educationText ? [`学历要求：${educationText}`] : []),
      ...(headcountText ? [`招聘人数：${headcountText}`] : []),
      ...requirementLines,
      ...descriptionSections.requirements,
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
  // ADR-0035 第一条：原先这里要求「工作性质」含「实习」，否则整条丢弃；校招岗位因此被取回
  // 后扔掉。现在只要求该字段**存在**（缺失说明页面布局变了），取值原样带走交给资格层判定。
  const employmentTypeText = labelValue(lines, "工作性质：");
  if (employmentTypeText === undefined) {
    throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
  }

  // 发布/结束时间位于相邻 span，可能被源码换行拆开，直接对原始 HTML 提取。
  const publishedAt = html.match(/发布时间：(\d{4}-\d{2}-\d{2})/)?.[1];
  const deadline = html.match(/结束时间：(\d{4}-\d{2}-\d{2})/)?.[1];

  const bodyStart = lines.findIndex((line) => line === "工作内容描述");
  if (bodyStart < 0) throw new Error("UNIVERSITY_EMPLOYMENT_BODY_SECTION_MISSING");
  const bodyLines = sectionBetween(lines, bodyStart, [
    "其他信息",
    "招生网",
    "香港中文大学（深圳）© 版权所有",
  ]);
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
  // ADR-0035 第一条：取值不再决定去留。六段结构已在上面校验过，`tokens[2]` 必然存在。
  const employmentTypeText = tokens[2] ?? "";

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
  const applicationUrlOnPage = html
    .match(/<a\b[^>]*\bhref="(https:\/\/[^"]+)"[^>]*>\s*招聘链接\s*:/i)?.[1]
    ?.replace(/&amp;/gi, "&");
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
    applicationUrlOnPage,
    hasMultiCitySupplement: bodyLines.some((line) => line.includes("工作城市：")),
  };
}

function hustRoleHeading(line: string): string | undefined {
  const bracketMatch = line.match(/^【(.+?实习生.*?)】$/u);
  if (bracketMatch?.[1]) return bracketMatch[1].trim();
  const numberedMatch = line.match(
    /^(?:[一二三四五六七八九十]+、|\d+[、.])\s*(.+?实习生)(?:\s+JD.*)?$/u,
  );
  return numberedMatch?.[1]?.trim();
}

function hustCompanyName(lines: string[], titleIndex: number, firstRoleIndex: number): string {
  const introEnd = firstRoleIndex > titleIndex ? firstRoleIndex : titleIndex + 40;
  for (const line of lines.slice(titleIndex + 1, introEnd)) {
    const match = line.match(
      /([\u4e00-\u9fffA-Za-z0-9（）()·]+(?:有限公司|股份有限公司|集团有限公司|分公司))/u,
    );
    if (match?.[1]) return match[1];
  }
  const title = lines[titleIndex] ?? "";
  const prefix = title.match(/^(.+?)(?=20\d{2}|招聘|招募|计划|专项)/u)?.[1]?.trim();
  if (prefix) return prefix;
  throw new Error("UNIVERSITY_EMPLOYMENT_COMPANY_MISSING");
}

function hustMarker(line: string, kind: "requirements" | "application"): boolean {
  const normalized = line.normalize("NFKC").replace(/\s+/g, "");
  if (kind === "requirements") {
    return /^(?:[一二三四五六七八九十\d]+[、.]?)?(?:岗位要求|任职要求)[:：]?$/u.test(
      normalized,
    );
  }
  return /^(?:[一二三四五六七八九十\d]+[、.]?)?(?:投递方式|招聘流程及方式)[:：]?$/u.test(
    normalized,
  );
}

function hustBenefitMarker(line: string): boolean {
  return /^(?:你将获得|福利待遇|招聘流程|投递方式|招聘流程及方式)[:：]?$/u.test(line);
}

function hustCleanLines(lines: string[]): string[] {
  return lines
    .map((line) => line.replace(/[\t\u3000 ]+/g, " ").trim())
    .filter(Boolean);
}

function parseHustAggregateJobInfoPage(
  lines: string[],
  pageUrl: string,
): UniversityEmploymentJob[] {
  const titleIndex = lines.findIndex(
    (line) => /实习生.*招聘|招聘.*实习生/u.test(line) && line !== "实习生信息",
  );
  if (titleIndex < 0) throw new Error("UNIVERSITY_EMPLOYMENT_TITLE_MISSING");

  const roleSectionIndex = lines.findIndex(
    (line, index) => index > titleIndex && /^一、.*实习生职位/u.test(line),
  );
  const requirementSectionIndex = lines.findIndex(
    (line, index) => index > roleSectionIndex && /^二、/u.test(line),
  );
  if (roleSectionIndex < 0 || requirementSectionIndex < 0) {
    throw new Error("UNIVERSITY_EMPLOYMENT_BODY_SECTION_MISSING");
  }

  const benefitSectionIndex = lines.findIndex(
    (line, index) => index > requirementSectionIndex && /^三、/u.test(line),
  );
  const contentEnd = benefitSectionIndex >= 0 ? benefitSectionIndex : lines.length;
  const footerIndex = lines.findIndex(
    (line, index) => index > titleIndex && line === "就业指导与服务中心",
  );
  const pageBodyEnd = footerIndex >= 0 ? footerIndex : lines.length;
  const responsibilities = lines
    .slice(roleSectionIndex + 1, requirementSectionIndex)
    .join("\n")
    .trim();
  const commonRequirements = lines
    .slice(requirementSectionIndex + 1, contentEnd)
    .join("\n")
    .trim();
  if (!responsibilities || !commonRequirements) {
    throw new Error("UNIVERSITY_EMPLOYMENT_BODY_SECTION_MISSING");
  }

  const companyName = lines
    .slice(contentEnd)
    .map((line) => line.match(/^(.+?(?:股份有限公司|有限公司))/u)?.[1]?.trim())
    .find((value): value is string => Boolean(value));
  if (!companyName) throw new Error("UNIVERSITY_EMPLOYMENT_COMPANY_MISSING");

  const locationLine = lines.find((line) => /^地点\s*[|｜:：]/u.test(line));
  const locationText = locationLine
    ?.replace(/^地点\s*[|｜:：]\s*/u, "")
    .split(/\s+/u)
    .filter(Boolean)
    .join("/");
  const publishedAt = lines
    .find((line) => line.startsWith("发布时间："))
    ?.match(datePattern)?.[0];

  const tableHeaderIndex = lines.findIndex((line) => line === "需求岗位");
  const tableEndIndex = lines.findIndex(
    (line, index) =>
      index > tableHeaderIndex &&
      /^(?:就业指导与服务中心|华中科技大学|版权所有|技术支持)/u.test(line),
  );
  const tableLines =
    tableHeaderIndex >= 0
      ? lines.slice(tableHeaderIndex, tableEndIndex >= 0 ? tableEndIndex : pageBodyEnd)
      : [];
  const tableTitle = tableLines.slice(1).find((line) => /实习/u.test(line));
  const title = tableTitle ?? "AI实习生";
  const titleLineIndex = lines.findIndex((line, index) => index > tableHeaderIndex && line === title);
  const rowWindowStart = Math.max(titleLineIndex + 1, tableHeaderIndex + 1);
  const headcountText = lines
    .slice(rowWindowStart, rowWindowStart + 4)
    .find((line) => /^\d+$/u.test(line));
  const educationText = lines
    .slice(rowWindowStart, rowWindowStart + 5)
    .find((line) => /^(本科|硕士|博士)/u.test(line));
  const tableEvidence = tableLines.join("\n").trim();

  const applicationSectionIndex = lines.findIndex(
    (line, index) => index > requirementSectionIndex && /^五、投递方式/u.test(line),
  );
  const applicationLines =
    applicationSectionIndex >= 0
      ? lines.slice(applicationSectionIndex, pageBodyEnd)
      : [];
  const applicationLine = applicationLines.find((line) => /(?:https?:\/\/)?we\.dji\.com\b/i.test(line));
  const applicationMatch = applicationLine?.match(/(?:https?:\/\/)?we\.dji\.com[^\s，。；]*/i)?.[0];
  const applicationUrlOnPage = applicationMatch
    ? applicationMatch.startsWith("http")
      ? applicationMatch
      : `https://${applicationMatch}`
    : undefined;

  return [
    {
      sourceJobId: `${pageIdentity("hust-jobinfo", pageUrl)}-aggregate-01`,
      pageUrl,
      companyName,
      title,
      category: undefined,
      locationText,
      employmentTypeText: "实习",
      educationText,
      headcountText,
      publishedAt,
      deadline: undefined,
      responsibilities,
      requirements: [
        ...(educationText ? [`学历要求：${educationText}`] : []),
        ...(headcountText ? [`招聘人数：${headcountText}`] : []),
        tableEvidence,
        commonRequirements,
      ]
        .filter(Boolean)
        .join("\n"),
      emails: collectEmails(applicationLines),
      applicationUrlOnPage,
      hasMultiCitySupplement: Boolean(locationText?.includes("/")),
    },
  ];
}

export function parseHustJobInfoPage(html: string, pageUrl: string): UniversityEmploymentJob[] {
  const lines = hustCleanLines(htmlToDeterministicLines(html));
  // 这是**解析能力**边界而不是供给范围过滤：下面的标题定位与岗位小标题识别都以「实习生」为
  // 锚点（`/实习生.*(?:招聘|招募|计划|开启)/`、`hustRoleHeading`），没有这个锚点无法切分公告。
  // 把华科公告线扩到校园招聘需要先观察到一份真实的校招公告页再改锚点语法——按 ADR-0035，
  // 契约未被观察就不写适配器。因此这里保留守卫，但改为结构变更（硬冲突），让它显式暴露成
  // 「需要人工扩适配器」，而不是像原先那样静默跳过。
  if (!lines.some((line) => line.includes("实习生"))) {
    throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
  }
  const titleIndex = lines.findIndex(
    (line) => line !== "实习生信息" && /实习生.*(?:招聘|招募|计划|开启)/u.test(line),
  );
  if (titleIndex < 0) throw new Error("UNIVERSITY_EMPLOYMENT_TITLE_MISSING");

  const footerIndex = lines.findIndex(
    (line, index) => index > titleIndex && line === "就业指导与服务中心",
  );
  const contentEnd = footerIndex >= 0 ? footerIndex : lines.length;
  const applicationMarkerIndex = lines.findIndex(
    (line, index) => index > titleIndex && hustMarker(line, "application"),
  );
  const roleScanEnd = applicationMarkerIndex >= 0 ? applicationMarkerIndex : contentEnd;
  const roleIndexes = lines
    .slice(titleIndex + 1, roleScanEnd)
    .map((line, offset) => ({ title: hustRoleHeading(line), index: titleIndex + 1 + offset }))
    .filter((entry): entry is { title: string; index: number } => Boolean(entry.title));
  if (roleIndexes.length === 0) {
    if (lines.some((line) => line === "需求岗位")) {
      return parseHustAggregateJobInfoPage(lines, pageUrl);
    }
    throw new Error("UNIVERSITY_EMPLOYMENT_ROLES_MISSING");
  }

  const companyName = hustCompanyName(lines, titleIndex, roleIndexes[0]?.index ?? -1);
  const publishedAt = lines
    .find((line) => line.startsWith("发布时间："))
    ?.match(datePattern)?.[0];
  const deadline = lines
    .find((line) => /(?:截止|结束)时间?[:：]/u.test(line))
    ?.match(datePattern)?.[0];
  const locationIndex = lines.findIndex(
    (line, index) =>
      index > titleIndex && /^(?:【)?工作地点(?:】)?[:：]?$/u.test(line),
  );
  const locationText = locationIndex >= 0 ? lines[locationIndex + 1] : undefined;
  const headcountText = lines.find((line) => line.startsWith("招聘人数："));
  const commonRequirementIndex = lines.findIndex(
    (line, index) => index > (roleIndexes.at(-1)?.index ?? titleIndex) && hustMarker(line, "requirements"),
  );
  const applicationIndex = applicationMarkerIndex;
  const applicationEnd = footerIndex >= 0 ? footerIndex : lines.length;
  const applicationLines =
    applicationIndex >= 0 ? lines.slice(applicationIndex, applicationEnd) : [];
  const allApplicationEmails = collectEmails(applicationLines);
  const roleEmailMap = new Map<string, Array<{ email: string; sourceText: string }>>();
  let currentApplicationRoles: string[] = [];
  for (const line of applicationLines) {
    const matchedRoles = roleIndexes
      .map(({ title }) => title)
      .filter((title) => line.includes(title));
    if (matchedRoles.length > 0) currentApplicationRoles = matchedRoles;
    const lineEmails = collectEmails([line]);
    if (currentApplicationRoles.length > 0 && lineEmails.length > 0) {
      for (const role of currentApplicationRoles) {
        roleEmailMap.set(role, [...(roleEmailMap.get(role) ?? []), ...lineEmails]);
      }
    }
  }

  const commonRequirements =
    commonRequirementIndex >= 0
      ? lines
          .slice(
            commonRequirementIndex + 1,
            applicationIndex >= 0 ? applicationIndex : contentEnd,
          )
          .filter((line) => !hustBenefitMarker(line))
          .join("\n")
      : "";

  return roleIndexes.map((role, index) => {
    const nextRoleIndex = roleIndexes[index + 1]?.index ?? contentEnd;
    const sectionEnd = Math.min(
      nextRoleIndex,
      commonRequirementIndex > role.index ? commonRequirementIndex : contentEnd,
      applicationIndex > role.index ? applicationIndex : contentEnd,
    );
    const sectionLines = lines.slice(role.index + 1, sectionEnd);
    const roleRequirementIndex = sectionLines.findIndex((line) => hustMarker(line, "requirements"));
    const dutyIndex = sectionLines.findIndex((line) => /^(?:岗位职责|工作职责)[:：]?$/u.test(line));
    const dutyStart = dutyIndex >= 0 ? dutyIndex + 1 : 0;
    const dutyStopCandidates = [
      roleRequirementIndex >= 0 ? roleRequirementIndex : sectionLines.length,
      sectionLines.findIndex((line) => hustBenefitMarker(line)),
    ].filter((value) => value >= 0);
    const dutyStop = Math.min(...dutyStopCandidates, sectionLines.length);
    const responsibilities = sectionLines.slice(dutyStart, dutyStop).join("\n").trim();
    const roleRequirements =
      roleRequirementIndex >= 0
        ? sectionLines
            .slice(roleRequirementIndex + 1)
            .filter((line) => !hustBenefitMarker(line))
            .join("\n")
            .trim()
        : commonRequirements;
    if (!responsibilities) throw new Error("UNIVERSITY_EMPLOYMENT_BODY_SECTION_MISSING");
    if (!roleRequirements) throw new Error("UNIVERSITY_EMPLOYMENT_REQUIREMENTS_SECTION_MISSING");

    const emails =
      allApplicationEmails.length === 1
        ? allApplicationEmails
        : roleEmailMap.get(role.title) ?? [];
    return {
      sourceJobId: `${pageIdentity("hust-jobinfo", pageUrl)}-role-${String(index + 1).padStart(2, "0")}`,
      pageUrl,
      companyName,
      title: role.title,
      category: undefined,
      locationText,
      employmentTypeText: "实习",
      educationText: undefined,
      headcountText,
      publishedAt,
      deadline,
      responsibilities,
      requirements: roleRequirements,
      emails,
      applicationUrlOnPage: undefined,
      hasMultiCitySupplement: Boolean(locationText?.match(/[/、,，]/u)),
    };
  });
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
  // **冻结公告身份校验**，不是供给范围过滤：下面 `allwinnerRoles` 是写死的岗位表，只对这一份
  // 公告成立。公告换了还按这张表产出岗位就是凭空编造，因此按结构变更硬失败。
  if (!compactContent.includes("2027届实习生招聘")) {
    throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
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
  // 同上：`dtlRoles` 是写死的八岗表，只对这一份公告成立，因此这是公告身份校验而非供给过滤。
  if (!lines.some((line) => line.includes("Internship（纯实习）"))) {
    throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
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

function isSustechRoleHeading(line: string): boolean {
  return /^[（(][一二三四五六七八九十]+[）)]/.test(line) && line.includes("实习");
}

function sustechRoleTitle(line: string): string {
  return line
    .replace(/^[（(][一二三四五六七八九十]+[）)]/, "")
    .replace(/[（(]招聘[\s\S]*$/, "")
    .trim();
}

export function parseSustechBysjyPage(html: string, pageUrl: string): UniversityEmploymentJob[] {
  const lines = htmlToDeterministicLines(html);
  const titleMatch = html.match(
    /<h1[^>]*class=["'][^"']*dh-tit[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleMatch?.[1]
    ? decodeTitleEntities(titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " "))
    : undefined;
  if (!title) throw new Error("UNIVERSITY_EMPLOYMENT_TITLE_MISSING");

  const publishedMatch = html.match(
    /<span[^>]*class=["'][^"']*time[^"']*["'][^>]*>\s*(\d{4})年(\d{1,2})月(\d{1,2})日/i,
  );
  const publishedYear = publishedMatch?.[1];
  const publishedMonth = publishedMatch?.[2];
  const publishedDay = publishedMatch?.[3];
  const publishedAt =
    publishedYear && publishedMonth && publishedDay
      ? `${publishedYear}-${publishedMonth.padStart(2, "0")}-${publishedDay.padStart(2, "0")}`
      : undefined;

  const contentEnd = lines.findIndex((line) => line === "招聘职位");
  const contentLines = contentEnd < 0 ? lines : lines.slice(0, contentEnd);
  const companyLine = contentLines.find((line) => /有限责任公司|股份有限公司/.test(line));
  const companyName = companyLine?.match(/([^，。；：（(]*?(?:有限责任公司|股份有限公司))/)?.[1];
  if (!companyName) throw new Error("UNIVERSITY_EMPLOYMENT_COMPANY_MISSING");

  const roleIndexes = contentLines
    .map((line, index) => (isSustechRoleHeading(line) ? index : -1))
    .filter((index) => index >= 0);
  if (roleIndexes.length === 0) throw new Error("UNIVERSITY_EMPLOYMENT_ROLES_MISSING");

  const baseId = pageIdentity("sustech-bysjy", pageUrl);
  const emails = collectEmails(contentLines);
  if (emails.length === 0) throw new Error("UNIVERSITY_EMPLOYMENT_APPLICATION_EMAIL_MISSING");

  return roleIndexes.map((roleIndex, roleNumber) => {
    const nextRoleIndex = roleIndexes[roleNumber + 1] ?? contentLines.length;
    const rawSegment = contentLines.slice(roleIndex + 1, nextRoleIndex);
    const audienceIndex = rawSegment.findIndex((line) => /^(?:三、|三\.)/.test(line));
    const segment = audienceIndex < 0 ? rawSegment : rawSegment.slice(0, audienceIndex);
    const responsibilityIndex = segment.findIndex(
      (line) => line === "岗位职责：" || line === "岗位职责:",
    );
    const requirementIndex = segment.findIndex(
      (line) => line === "任职要求：" || line === "任职要求:",
    );
    if (responsibilityIndex < 0 || requirementIndex <= responsibilityIndex) {
      throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
    }
    const responsibilities = segment
      .slice(responsibilityIndex + 1, requirementIndex)
      .join("\n")
      .trim();
    const requirements = segment.slice(requirementIndex + 1).join("\n").trim();
    if (!responsibilities || !requirements) {
      throw new Error("UNIVERSITY_EMPLOYMENT_REQUIREMENTS_SECTION_MISSING");
    }
    const locationLine = segment.find(
      (line) => line.startsWith("工作地：") || line.startsWith("工作地:"),
    );
    const locationText = locationLine?.replace(/^工作地[：:]/, "").trim();
    const heading = contentLines[roleIndex] ?? "";
    return {
      sourceJobId: `${baseId}-${roleNumber + 1}`,
      pageUrl,
      companyName,
      title: sustechRoleTitle(heading),
      category: undefined,
      locationText,
      employmentTypeText: "实习",
      educationText: requirements.match(/(?:本科|硕士|博士)[^。；\n]*/)?.[0],
      headcountText: heading.match(/招聘[^）)]*/)?.[0],
      publishedAt,
      deadline: undefined,
      responsibilities,
      requirements,
      emails,
      applicationUrlOnPage: undefined,
      hasMultiCitySupplement: Boolean(locationText && /[/、,，]/.test(locationText)),
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
  if (input.format === "hust-jobinfo") {
    return parseHustJobInfoPage(input.html, input.pageUrl);
  }
  if (input.format === "sustech-bysjy") {
    return parseSustechBysjyPage(input.html, input.pageUrl);
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
    case "hust-jobinfo": {
      const [job] = parseHustJobInfoPage(input.html, input.pageUrl);
      if (!job) throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
      return job;
    }
    case "gdut-campus": {
      const [job] = parseGdutCampusPage(input.html, input.pageUrl);
      if (!job) throw new Error("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
      return job;
    }
    case "sustech-bysjy": {
      const [job] = parseSustechBysjyPage(input.html, input.pageUrl);
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
  const pageCompanyName = job.companyName.normalize("NFKC").trim();
  const acceptedCompanyNames = [source.companyLegalName, ...(source.companyPageAliases ?? [])].map(
    (name) => name.normalize("NFKC").trim(),
  );
  if (!acceptedCompanyNames.includes(pageCompanyName)) {
    throw new Error("UNIVERSITY_EMPLOYMENT_COMPANY_MISMATCH");
  }
  // ADR-0035 第一条：这里原是**全部高校来源共用的**那道实习过滤——每个解析器最终都汇到
  // normalize，因此它一条就足以把校招、应届与管培生全部挡在库外。已撤销；工作性质作为事实
  // 原样记录，是否可投由资格层的 `catalog.job_reachability_verdict` 判定。

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
    // 工作性质原文与「纯实习」不一致仍然**记录**，但不再产出 `SOURCE_KIND_CONFLICT` 复核项。
    //
    // 那个复核项是 `BLOCKING_REVIEW_OPEN` 的成员，连本机 `local_mvp` 都进不去。它成立的前提是
    // 供给单位为「实习」——那时「官方写全职」确实让人怀疑这条是否在范围内。ADR-0035 把单位改为
    // 「在校生可投岗位」后，全职校招本身就在范围内，工作性质不再决定准入，因此它不构成需要
    // 人工放行的矛盾。实测代价很具体：慧策 30 条历史岗位有 29 条命中该项，来源随之被暂停。
    qualityFlags.push({ code: "OFFICIAL_EMPLOYMENT_TYPE_NOT_INTERNSHIP", detail: employmentType });
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
    /每周(?:可保证|保证|可工作|工作)?\s*(\d+)\s*个?工作日(?:以上|及以上)?/u,
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
