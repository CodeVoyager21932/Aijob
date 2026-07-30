import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  listUniversityEmploymentSources,
  normalizeUniversityEmploymentJob,
  normalizeUniversityLocation,
  parseCuhkJobViewPage,
  parseDtlNankaiPage,
  parseGdutCampusPage,
  parseNankaiCorrecruitPage,
  parseUniversityEmploymentJobs,
  parseUniversityEmploymentPage,
  parseZjuJyxtPage,
  resolveUniversityEmploymentSource,
} from "./university-employment-adapter.js";

async function htmlFixture(name: string): Promise<string> {
  return readFile(new URL(`../../../../fixtures/ingestion/${name}`, import.meta.url), "utf-8");
}

const NANKAI_PAGE_URL = "https://career.nankai.edu.cn/correcruit/content/id/116240.html";
const CUHK_PAGE_URL = "https://career.cuhk.edu.cn/job/view/id/466931";
const ZJU_PAGE_URL =
  "https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4DE5B03172671701E0653A68DD0E9B18";
const GDUT_PAGE_URL = "https://career.gdut.edu.cn/campus/view/id/1020713";

function gdutHtmlFixture(companyName = "珠海全志科技股份有限公司"): string {
  const roles = [
    ["2701", "数字设计工程师", "珠海/西安/上海"],
    ["2702", "算法设计工程师", "珠海/西安"],
    ["2703", "算法测试工程师", "珠海/西安"],
    ["2704", "ATE测试系统设计工程师", "珠海"],
    ["2705", "嵌入式软件设计工程师", "珠海"],
    ["2706", "射频系统设计工程师", "珠海"],
    ["2707", "硬件工程师", "珠海"],
  ];
  const roleHtml = roles
    .map(
      ([code, title, location]) =>
        `<p><strong>${code} ${title}（2027届实习）</strong></p>` +
        `<p>一、任职资格<br/>1. 本科及以上在校生，相关专业；<br/>2. 连续实习3个月及以上；` +
        `<br/>二、职位描述<br/>1. 参与${title}相关研发和验证工作；` +
        `<br/>2. 工作地点：${location}；<br/>三、职位方向</p>`,
    )
    .join("");
  const content =
    `<p><strong>珠海全志科技2027届实习生招聘</strong></p>` +
    `<p>申请入口：<a href="https://campus.allwinnertech.com/">https://campus.allwinnertech.com</a></p>` +
    roleHtml;
  const decoded = `view1d${" ".repeat(16)}${content}`;
  const inflated = `view2d${" ".repeat(50)}${Buffer.from(decoded).toString("base64")}`;
  const blob = deflateSync(Buffer.from(inflated)).toString("base64");
  return [
    '<!doctype html><html lang="zh-CN"><body>',
    `<div class="title-message"><h5>${companyName}</h5>`,
    '<span class="expired_time">过期时间：2026-08-25</span></div>',
    "<li>发布时间：2026-06-25 10:24</li>",
    `<script>unzip("${blob}")</script>`,
    "</body></html>",
  ].join("");
}

function dtlHtmlFixture(): string {
  const roles = [
    "量化研究员",
    "量化研究员-机器学习",
    "基本面量化研究员",
    "交易算法研究员",
    "交易分析师",
    "软件工程师（系统、数据与基础设施）",
    "GPU工程师",
    "人力资源专员",
  ];
  const roleHtml = roles
    .map(
      (title, index) =>
        `<h6>${index + 1}.${title}</h6><p>职位描述</p>` +
        `<p>参与${title}相关工作并完成可复现交付。</p>` +
        `<p>任职要求</p><p>相关专业在校生，具备岗位所需基础能力。</p>`,
    )
    .join("");
  return [
    '<!doctype html><html lang="zh-CN"><head>',
    "<title>DTL量化2026秋季实习生招聘-北京道泰量合私募基金管理有限公司</title>",
    '<meta name="keywords" content="南开大学,实习信息,DTL量化" />',
    "</head><body>",
    '<div class="zpxx"><span>职位投递邮箱：</span>careers_cn@dytechlab.com</div>',
    '<div class="zpxx"><span>职位投递网址链接：</span>https://www.dytechlab.com/careers</div>',
    '<div class="zpxx"><span>工作地域：</span>北京市 / 上海市</div>',
    '<div class="zpxx"><span>职位类别：</span>金融业务人员</div>',
    '<div class="zpxx"><span>学历要求：</span>本科 / 硕士研究生 / 博士研究生</div>',
    '<div class="zpxx"><span>招聘人数：</span>15人</div>',
    "<div>发布时间：2026-06-23</div>",
    "<p>* 专业要求：</p><p>数学、统计、计算机、金融工程、物理等理工类专业</p>",
    "<p>* 职位描述：</p><p>Internship（纯实习）</p>",
    roleHtml,
    "<p>友情链接</p></body></html>",
  ].join("");
}

describe("university employment source registry", () => {
  it("freezes batch-02 and batch-04 sources with their carrier formats", () => {
    const sources = listUniversityEmploymentSources();
    expect(sources.map((source) => source.sourceKey)).toEqual([
      "supvan-info-internships",
      "jcquant-internships",
      "shengumedia-internships",
      "hr-soft-internships",
      "allwinner-gdut-internships",
      "citics-shanghai-summer-internship",
      "kunlunxin-internships",
      "dingwei-consulting-internships",
      "sharecapital-internships",
      "dtl-quant-internships",
    ]);
    expect(resolveUniversityEmploymentSource("supvan-info-internships").pageUrls).toHaveLength(6);
    expect(resolveUniversityEmploymentSource("jcquant-internships").pageUrls).toHaveLength(1);
    expect(() => resolveUniversityEmploymentSource("unknown-source")).toThrowError(
      "UNIVERSITY_EMPLOYMENT_SOURCE_NOT_CONFIGURED",
    );
  });

  it("normalizes official location text to city names", () => {
    expect(normalizeUniversityLocation("北京市")).toBe("北京");
    expect(normalizeUniversityLocation("广东省 - 深圳市")).toBe("深圳");
    expect(normalizeUniversityLocation("浙江省杭州市滨江区")).toBe("杭州");
  });
});

describe("gdut campus brochure (allwinner)", () => {
  it("decodes one static brochure into seven complete internship jobs", () => {
    const html = gdutHtmlFixture();
    const source = resolveUniversityEmploymentSource("allwinner-gdut-internships");
    const jobs = parseGdutCampusPage(html, GDUT_PAGE_URL);

    expect(jobs).toHaveLength(7);
    expect(jobs[0]).toMatchObject({
      sourceJobId: "gdut-1020713-2701",
      companyName: "珠海全志科技股份有限公司",
      title: "数字设计工程师",
      publishedAt: "2026-06-25",
      deadline: "2026-08-25",
      applicationUrlOnPage: "https://campus.allwinnertech.com",
    });
    expect(jobs.every((job) => job.responsibilities.length > 0)).toBe(true);
    expect(jobs.every((job) => job.requirements.length > 0)).toBe(true);

    const [firstJob] = jobs;
    if (!firstJob) throw new Error("GDUT_TEST_FIXTURE_EMPTY");
    const normalized = normalizeUniversityEmploymentJob({
      source,
      job: firstJob,
      pageEvidenceRef: "fetch-gdut",
    });
    expect(normalized.applyUrl).toBe(
      "https://campus.allwinnertech.com/campus-recruitment/allwinnertech/43436/#/jobs?zhineng%5B0%5D=240584",
    );
    expect(normalized.locations).toMatchObject({
      state: "known",
      value: ["珠海", "西安", "上海"],
    });
    expect(normalized.structuredFields.durationMonths).toMatchObject({
      state: "known",
      value: 3,
    });
  });

  it("fails closed on payload corruption, bad page identity and company mismatch", () => {
    const html = gdutHtmlFixture();
    const source = resolveUniversityEmploymentSource("allwinner-gdut-internships");

    const corruptedHtml = html.replace(/unzip\("([A-Za-z0-9+/=])/, 'unzip("A');
    expect(() => parseGdutCampusPage(corruptedHtml, GDUT_PAGE_URL)).toThrowError(
      "UNIVERSITY_EMPLOYMENT_GDUT_STATIC_PAYLOAD_INVALID",
    );
    expect(() =>
      parseGdutCampusPage(html, "https://career.gdut.edu.cn/campus/view/id/bad"),
    ).toThrow("UNIVERSITY_EMPLOYMENT_PAGE_URL_UNRECOGNIZED");

    const [wrongCompany] = parseGdutCampusPage(
      gdutHtmlFixture("另一家公司有限公司"),
      GDUT_PAGE_URL,
    );
    if (!wrongCompany) throw new Error("GDUT_TEST_FIXTURE_EMPTY");
    expect(() =>
      normalizeUniversityEmploymentJob({
        source,
        job: wrongCompany,
        pageEvidenceRef: "fetch",
      }),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_COMPANY_MISMATCH");
  });

  it("dispatches one-to-many pages without changing one-job formats", async () => {
    const gdutHtml = gdutHtmlFixture();
    const zjuHtml = await htmlFixture("university-employment-zju.synthetic.html");
    expect(
      parseUniversityEmploymentJobs({
        format: "gdut-campus",
        html: gdutHtml,
        pageUrl: GDUT_PAGE_URL,
      }),
    ).toHaveLength(7);
    expect(
      parseUniversityEmploymentJobs({
        format: "zju-jyxt",
        html: zjuHtml,
        pageUrl: ZJU_PAGE_URL,
      }),
    ).toHaveLength(1);
  });
});

describe("nankai correcruit detail page (supvan-info)", () => {
  it("parses the internship detail page and keeps the frozen official apply url", async () => {
    const html = await htmlFixture("university-employment-nankai.synthetic.html");
    const source = resolveUniversityEmploymentSource("supvan-info-internships");
    const job = parseNankaiCorrecruitPage(html, NANKAI_PAGE_URL);

    expect(job.sourceJobId).toBe("nankai-116240");
    expect(job.title).toBe("嵌入式工程师");
    expect(job.companyName).toBe("北京硕方信息技术有限公司");
    expect(job.applicationUrlOnPage).toBe("https://www.supvan.com/joinUs");
    expect(job.publishedAt).toBe("2026-07-06");
    expect(job.requirements).toContain("学历要求：硕士研究生");
    expect(job.requirements).toContain("通信协议");
    expect(job.responsibilities).toContain("Linux 内核核心架构");
    expect(job.responsibilities).not.toContain("渠道销售助理");

    const normalized = normalizeUniversityEmploymentJob({
      source,
      job,
      pageEvidenceRef: "fetch-nankai-116240",
    });
    expect(normalized.companyName).toBe("硕方信息");
    expect(normalized.applyUrl).toBe("https://www.supvan.com/joinUs");
    expect(normalized.entryScope).toBe("实习生");
    expect(normalized.jobFamily).toMatchObject({ state: "known", value: "engineering" });
    expect(normalized.locations).toMatchObject({ state: "known", value: ["北京"] });
    expect(normalized.structuredFields.publishedAt).toMatchObject({ value: "2026-07-06" });
    expect(normalized.structuredFields.durationMonths).toMatchObject({ value: 3 });
    expect(normalized.structuredFields.weeklyAttendanceDays).toMatchObject({ value: 4 });
    // 页面邮箱域 jtsupvan.com 未通过企业域名白名单：不产出邮箱投递方式，留复核标记。
    expect(
      (normalized.structuredFields as Record<string, unknown>).applicationEmail,
    ).toBeUndefined();
    expect(normalized.qualityFlags).toContainEqual({
      code: "COMPANY_EMAIL_DOMAIN_UNVERIFIED",
      detail: "jtsupvan.com",
    });
    expect(normalized.reviewReasons).toContainEqual({
      code: "SOURCE_POLICY_PENDING",
      details: { source: "supvan-info-internships" },
    });
  });

  it("fails closed when the internship section marker or frozen apply url changes", async () => {
    const html = await htmlFixture("university-employment-nankai.synthetic.html");
    const source = resolveUniversityEmploymentSource("supvan-info-internships");

    expect(() =>
      parseNankaiCorrecruitPage(html.replace("实习信息,", "招聘信息,"), NANKAI_PAGE_URL),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_NOT_INTERNSHIP_SECTION");

    const tampered = parseNankaiCorrecruitPage(
      html.replace("https://www.supvan.com/joinUs", "https://evil.example.com/joinUs"),
      NANKAI_PAGE_URL,
    );
    expect(() =>
      normalizeUniversityEmploymentJob({
        source,
        job: tampered,
        pageEvidenceRef: "fetch",
      }),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_APPLY_URL_MISMATCH");
  });
});

describe("nankai correcruit multi-role page (dtl)", () => {
  it("splits the frozen brochure into eight internship jobs", () => {
    const jobs = parseDtlNankaiPage(
      dtlHtmlFixture(),
      "https://career.nankai.edu.cn/correcruit/content/id/116147.html",
    );

    expect(jobs).toHaveLength(8);
    expect(jobs[0]).toMatchObject({
      sourceJobId: "nankai-116147-dtl-01",
      companyName: "北京道泰量合私募基金管理有限公司",
      title: "量化研究员",
      employmentTypeText: "实习",
      applicationUrlOnPage: "https://www.dytechlab.com/careers",
    });
    expect(jobs[5]).toMatchObject({
      sourceJobId: "nankai-116147-dtl-06",
      title: "软件工程师（系统、数据与基础设施）",
    });
    expect(jobs.every((job) => job.responsibilities.length > 0)).toBe(true);
    expect(jobs.every((job) => job.requirements.length > 0)).toBe(true);
  });

  it("fails closed when a role loses its requirements section", () => {
    expect(() =>
      parseDtlNankaiPage(
        dtlHtmlFixture().replace(
          "<p>任职要求</p><p>相关专业在校生，具备岗位所需基础能力。</p>",
          "<p>相关专业在校生，具备岗位所需基础能力。</p>",
        ),
        "https://career.nankai.edu.cn/correcruit/content/id/116147.html",
      ),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
  });
});

describe("cuhk job view detail page (jcquant)", () => {
  it("parses the internship posting and verifies the company-domain email", async () => {
    const html = await htmlFixture("university-employment-cuhk.synthetic.html");
    const source = resolveUniversityEmploymentSource("jcquant-internships");
    const job = parseCuhkJobViewPage(html, CUHK_PAGE_URL);

    expect(job.sourceJobId).toBe("cuhk-466931");
    expect(job.title).toBe("量化研究员（实习生）");
    expect(job.employmentTypeText).toBe("实习");
    expect(job.publishedAt).toBe("2025-12-22");
    expect(job.deadline).toBe("2028-01-01");
    expect(job.emails).toEqual([
      {
        email: "synthetic-hr@jcquant.vip",
        sourceText: "简历投递至synthetic-hr@jcquant.vip，简历命名格式：名字-学校-应聘岗位",
      },
    ]);

    const normalized = normalizeUniversityEmploymentJob({
      source,
      job,
      pageEvidenceRef: "fetch-cuhk-466931",
    });
    expect(normalized.companyName).toBe("鲸驰寰宇");
    expect(normalized.applyUrl).toBeNull();
    expect(normalized.structuredFields).toMatchObject({
      applicationEmail: "synthetic-hr@jcquant.vip",
      deadline: { state: "known", value: "2028-01-01" },
    });
    expect(normalized.locations).toMatchObject({ state: "known", value: ["深圳"] });
    expect(normalized.qualityFlags).not.toContainEqual(
      expect.objectContaining({ code: "SOURCE_KIND_CONFLICT" }),
    );
  });

  it("fails closed on non-internship type, foreign email domains and company mismatch", async () => {
    const html = await htmlFixture("university-employment-cuhk.synthetic.html");
    const source = resolveUniversityEmploymentSource("jcquant-internships");

    expect(() =>
      parseCuhkJobViewPage(html.replace("工作性质：实习", "工作性质：全职"), CUHK_PAGE_URL),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP");

    const foreignEmail = parseCuhkJobViewPage(
      html.replaceAll("synthetic-hr@jcquant.vip", "synthetic-hr@qq.com"),
      CUHK_PAGE_URL,
    );
    expect(() =>
      normalizeUniversityEmploymentJob({ source, job: foreignEmail, pageEvidenceRef: "fetch" }),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_COMPANY_EMAIL_UNVERIFIED");

    const wrongCompany = parseCuhkJobViewPage(
      html.replace("深圳市鲸驰寰宇科技有限公司", "另一家公司有限公司"),
      CUHK_PAGE_URL,
    );
    expect(() =>
      normalizeUniversityEmploymentJob({ source, job: wrongCompany, pageEvidenceRef: "fetch" }),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_COMPANY_MISMATCH");
  });
});

describe("cuhk job view detail page (citics shanghai)", () => {
  it("accepts the numbered requirement section and a browser-verified official ATS job", async () => {
    const html = await htmlFixture("university-employment-cuhk-citics.synthetic.html");
    const pageUrl = "https://career.cuhk.edu.cn/job/view/id/468515";
    const source = resolveUniversityEmploymentSource("citics-shanghai-summer-internship");
    const job = parseCuhkJobViewPage(html, pageUrl);

    expect(job.companyName).toBe("中信证券股份有限公司上海分公司");
    expect(job.responsibilities).toContain("证券投资相关客户服务");
    expect(job.requirements).toContain("本科及以上学历在校应届毕业生");
    expect(job.requirements).not.toContain("中信证券业务覆盖");

    const normalized = normalizeUniversityEmploymentJob({
      source,
      job,
      pageEvidenceRef: "fetch-citics",
    });
    expect(normalized.companyName).toBe("中信证券上海分公司");
    expect(normalized.applyUrl).toContain("positionNo=5468");
    expect(normalized.locations).toMatchObject({ state: "known", value: ["上海"] });
  });
});

describe("zju jyxt detail page (hr-soft)", () => {
  it("imports the mixed full-time/internship posting with conflict review markers", async () => {
    const html = await htmlFixture("university-employment-zju.synthetic.html");
    const source = resolveUniversityEmploymentSource("hr-soft-internships");
    const job = parseZjuJyxtPage(html, ZJU_PAGE_URL);

    expect(job.sourceJobId).toBe("zju-4DE5B03172671701E0653A68DD0E9B18");
    expect(job.title).toBe("商务助理");
    expect(job.employmentTypeText).toBe("全职,实习");
    expect(job.deadline).toBe("2027-12-31");
    expect(job.publishedAt).toBe("2026-03-26");
    expect(job.emails).toEqual([{ email: "hr@hr-soft.cn", sourceText: "电子邮箱：hr@hr-soft.cn" }]);
    expect(job.requirements).toContain("学历要求：本科及以上");
    expect(job.hasMultiCitySupplement).toBe(true);

    const normalized = normalizeUniversityEmploymentJob({
      source,
      job,
      pageEvidenceRef: "fetch-zju",
    });
    expect(normalized.companyName).toBe("红海云");
    expect(normalized.applyUrl).toBeNull();
    expect(normalized.locations).toMatchObject({ state: "known", value: ["杭州"] });
    expect(normalized.jobFamily).toMatchObject({ state: "known", value: "sales_business" });
    expect(normalized.qualityFlags).toContainEqual({
      code: "SOURCE_KIND_CONFLICT",
      detail: "全职,实习",
    });
    expect(normalized.qualityFlags).toContainEqual(
      expect.objectContaining({ code: "MULTI_CITY_SUPPLEMENT" }),
    );
    expect(normalized.structuredFields).toMatchObject({
      applicationEmail: "hr@hr-soft.cn",
      applicationEmailSourceText: "电子邮箱：hr@hr-soft.cn",
    });
  });

  it("prefers the explicit application email over a general contact email", async () => {
    const html = await htmlFixture("university-employment-zju.synthetic.html");
    const job = parseZjuJyxtPage(
      html.replace("<p>任职要求</p>", "<p>简历投递：apply@hr-soft.cn</p><p>任职要求</p>"),
      ZJU_PAGE_URL,
    );

    expect(job.emails).toEqual([
      {
        email: "apply@hr-soft.cn",
        sourceText: "简历投递：apply@hr-soft.cn",
      },
    ]);
  });

  it("fails closed when the frozen six-token structure changes", async () => {
    const html = await htmlFixture("university-employment-zju.synthetic.html");
    expect(() =>
      parseZjuJyxtPage(html.replace("<span>2027-12-31</span>", ""), ZJU_PAGE_URL),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");
  });

  it("dispatches by frozen page format", async () => {
    const html = await htmlFixture("university-employment-zju.synthetic.html");
    const job = parseUniversityEmploymentPage({ format: "zju-jyxt", html, pageUrl: ZJU_PAGE_URL });
    expect(job.title).toBe("商务助理");
  });
});
