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
  parseHustJobInfoPage,
  parseNankaiCorrecruitPage,
  parseSustechBysjyPage,
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
const GALASPORTS_CUHK_PAGE_URL = "https://career.cuhk.edu.cn/job/view/id/468689";
const ZJU_PAGE_URL =
  "https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4DE5B03172671701E0653A68DD0E9B18";
const HANXU_ZJU_PAGE_URL =
  "https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4CCE42B8467C9601E0653A68DD0E9B18";
const GDUT_PAGE_URL = "https://career.gdut.edu.cn/campus/view/id/1020713";
const HUST_GUANGGU_PAGE_URL = "https://job.hust.edu.cn/zpinfo3/2406395.htm";
const SUSTECH_ANXIN_PAGE_URL = "https://career.sustech.edu.cn/detail/online?id=3529493";

function sustechAnxinHtmlFixture(): string {
  return [
    "<!doctype html><html><body>",
    '<div class="details-head"><h1 class="dh-tit">安信基金2027届实习生（可留用）校园招聘简章</h1>',
    '<p class="dh-info"><span class="time">2026年6月29日</span></p></div>',
    '<div class="details-content">',
    "<p>一、公司概况</p>",
    "<p>安信基金管理有限责任公司（以下简称公司）由中国证监会批准设立。</p>",
    "<p>（一）行业研究员实习生（招聘20人，考察留用）</p>",
    "<p>工作地：深圳/上海</p>",
    "<p>岗位职责：</p><p>协助上市公司和行业研究，形成研究报告。</p>",
    "<p>任职要求：</p><p>知名院校硕士研究生及以上学历，具有金融经济背景。</p>",
    "<p>（二）量化研究员实习生（招聘4人，考察留用）</p>",
    "<p>工作地：上海</p>",
    "<p>岗位职责：</p><p>清洗分析金融数据，协助测试机器学习策略。</p>",
    "<p>任职要求：</p><p>硕士研究生及以上学历，熟练掌握Python和机器学习框架。</p>",
    "<p>五、招聘流程及简历投递</p><p>或发送至邮箱：hr@essencefund.com</p>",
    '<div class="detail-module"><div class="dm-tit">招聘职位</div></div>',
    "</body></html>",
  ].join("");
}

function hustHtmlFixture(): string {
  return [
    "<!doctype html><html lang=\"zh-CN\"><body>",
    "<h1>华中科技大学就业信息网</h1>",
    "<h2>武汉光谷创新投资有限公司2026年实习生招聘</h2>",
    "<p>发布时间：2026-06-18</p>",
    "<p>截止时间：2026-12-31</p>",
    "<p>工作地点：</p><p>武汉</p>",
    "<p>招聘人数：2</p>",
    "<p>【投资分析实习生】</p>",
    "<p>岗位职责：</p><p>参与项目研究、行业分析和投资材料整理。</p>",
    "<p>岗位要求：</p><p>金融、经济或统计相关专业，具备研究能力。</p>",
    "<p>【研究助理实习生】</p>",
    "<p>岗位职责：</p><p>协助完成数据整理、访谈纪要和报告撰写。</p>",
    "<p>岗位要求：</p>",
    "<p>岗位要求：</p><p>每周可实习四天，能够持续三个月。</p>",
    "<p>投递方式：</p>",
    "<p>投资分析实习生：intern@ovvc.net</p>",
    "<p>研究助理实习生：huyaqi@ovvc.net</p>",
    "<p>就业指导与服务中心</p>",
    "</body></html>",
  ].join("");
}

function hustDjiAggregateHtmlFixture(): string {
  return [
    "<!doctype html><html lang=\"zh-CN\"><body>",
    "<h1>华中科技大学就业信息网</h1>",
    "<h2>DJI 大疆 2027 AI 实习生专项招聘计划开启</h2>",
    "<p>发布时间：2026-05-29</p>",
    "<p>一、AI 实习生职位</p>",
    "<p>面向2027 届高校毕业生</p>",
    "<p>地点 | 深圳 上海 北京</p>",
    "<p>AI 算法类</p>",
    "<p>计算机视觉算法实习生（世界模型）</p>",
    "<p>机器学习算法实习生（模型优化）</p>",
    "<p>二、我们期待这样的你</p>",
    "<p>技术扎实，知行合一</p>",
    "<p>具备计算机视觉、机器学习、深度学习、生成式 AI 等领域扎实的技术功底。</p>",
    "<p>三、你将获得</p>",
    "<p>系统级成长的机会</p>",
    "<p>五、投递方式</p>",
    "<p>登录 we.dji.com 进入校园招聘投递</p>",
    "<p>需求岗位</p>",
    "<p>需求人数</p>",
    "<p>需求学历</p>",
    "<p>需求专业</p>",
    "<p>其他要求</p>",
    "<p>AI实习生</p>",
    "<p>100</p>",
    "<p>本科</p>",
    "<p>计算机科学与技术,人工智能</p>",
    "<p>就业指导与服务中心</p>",
    "<p>邮箱：job@hust.edu.cn</p>",
    "<p>深圳市大疆创新科技有限公司</p>",
    "</body></html>",
  ].join("");
}

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
      "galasports-internships",
      "shengumedia-internships",
      "hr-soft-internships",
      "allwinner-gdut-internships",
      "citics-shanghai-summer-internship",
      "kunlunxin-internships",
      "dingwei-consulting-internships",
      "hanxu-tech-internships",
      "sharecapital-internships",
      "dtl-quant-internships",
      "unity-drive-internships",
      "triple-stone-internships",
      "anxin-fund-internships",
    ]);
    expect(resolveUniversityEmploymentSource("supvan-info-internships").pageUrls).toHaveLength(6);
    expect(resolveUniversityEmploymentSource("jcquant-internships").pageUrls).toHaveLength(1);
    expect(resolveUniversityEmploymentSource("galasports-internships").pageUrls).toEqual([
      GALASPORTS_CUHK_PAGE_URL,
    ]);
    expect(resolveUniversityEmploymentSource("hanxu-tech-internships").pageUrls).toEqual([
      HANXU_ZJU_PAGE_URL,
      "https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4CCEE37BBB2DB309E0653A68DD0E9B18",
    ]);
    expect(resolveUniversityEmploymentSource("anxin-fund-internships").pageUrls).toEqual([
      SUSTECH_ANXIN_PAGE_URL,
    ]);
    expect(() => resolveUniversityEmploymentSource("unknown-source")).toThrowError(
      "UNIVERSITY_EMPLOYMENT_SOURCE_NOT_CONFIGURED",
    );
  });

  it("builds a new carrier source entirely from validated adapter options", () => {
    expect(
      resolveUniversityEmploymentSource({
        sourceKey: "configured-university-source",
        organization: {
          name: "配置化测试有限公司",
          officialDomain: "configured.example.com",
        },
        policy: {
          entrypoints: ["https://career.example.edu.cn/job/view/id/1001"],
          adapterOptions: {
            pageFormat: "cuhk-jobview",
            companyDisplayName: "配置化测试",
            companyPageAliases: ["配置测试"],
            application: { type: "company_email" },
          },
        },
      }),
    ).toEqual({
      sourceKey: "configured-university-source",
      companyLegalName: "配置化测试有限公司",
      companyDisplayName: "配置化测试",
      companyPageAliases: ["配置测试"],
      officialDomain: "configured.example.com",
      pageFormat: "cuhk-jobview",
      pageUrls: ["https://career.example.edu.cn/job/view/id/1001"],
      application: { type: "company_email" },
    });
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

describe("hust jobinfo detail page", () => {
  it("splits multiple roles and maps role-specific company emails", () => {
    const jobs = parseHustJobInfoPage(hustHtmlFixture(), HUST_GUANGGU_PAGE_URL);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      sourceJobId: "hust-2406395-role-01",
      companyName: "武汉光谷创新投资有限公司",
      title: "投资分析实习生",
      employmentTypeText: "实习",
      publishedAt: "2026-06-18",
      deadline: "2026-12-31",
      locationText: "武汉",
    });
    expect(jobs[0]?.responsibilities).toContain("参与项目研究");
    expect(jobs[0]?.requirements).toContain("金融、经济或统计相关专业");
    expect(jobs[0]?.emails).toEqual([
      { email: "intern@ovvc.net", sourceText: "投资分析实习生：intern@ovvc.net" },
    ]);
    expect(jobs[1]?.requirements).toContain("每周可实习四天");
    expect(jobs[1]?.emails).toEqual([
      { email: "huyaqi@ovvc.net", sourceText: "研究助理实习生：huyaqi@ovvc.net" },
    ]);
  });

  it("fails closed when a role has no responsibilities", () => {
    const html = hustHtmlFixture().replace(
      "<p>岗位职责：</p><p>协助完成数据整理、访谈纪要和报告撰写。</p>",
      "<p>岗位职责：</p>",
    );

    expect(() => parseHustJobInfoPage(html, HUST_GUANGGU_PAGE_URL)).toThrowError(
      "UNIVERSITY_EMPLOYMENT_BODY_SECTION_MISSING",
    );
  });

  it("parses the DJI aggregate role without importing university footer contact data", () => {
    const jobs = parseHustJobInfoPage(
      hustDjiAggregateHtmlFixture(),
      "https://job.hust.edu.cn/zpinfo1/2400683.htm",
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      sourceJobId: "hust-2400683-aggregate-01",
      companyName: "深圳市大疆创新科技有限公司",
      title: "AI实习生",
      locationText: "深圳/上海/北京",
      educationText: "本科",
      headcountText: "100",
      publishedAt: "2026-05-29",
      applicationUrlOnPage: "https://we.dji.com",
      emails: [],
    });
    expect(jobs[0]?.responsibilities).toContain("计算机视觉算法实习生");
    expect(jobs[0]?.requirements).toContain("技术扎实");
    expect(jobs[0]?.requirements).not.toContain("job@hust.edu.cn");
  });
});

describe("SUSTech bysjy detail pages", () => {
  it("extracts multiple explicit internship roles with a company-domain email", () => {
    const jobs = parseSustechBysjyPage(sustechAnxinHtmlFixture(), SUSTECH_ANXIN_PAGE_URL);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      sourceJobId: "sustech-3529493-1",
      companyName: "安信基金管理有限责任公司",
      title: "行业研究员实习生",
      locationText: "深圳/上海",
      employmentTypeText: "实习",
      publishedAt: "2026-06-29",
    });
    expect(jobs[0]?.emails).toEqual([
      { email: "hr@essencefund.com", sourceText: "或发送至邮箱：hr@essencefund.com" },
    ]);
    expect(jobs[1]?.sourceJobId).toBe("sustech-3529493-2");
    expect(jobs[1]?.requirements).toContain("机器学习框架");
    expect(
      parseUniversityEmploymentJobs({
        format: "sustech-bysjy",
        html: sustechAnxinHtmlFixture(),
        pageUrl: SUSTECH_ANXIN_PAGE_URL,
      }),
    ).toHaveLength(2);
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

  // 栏目标记守卫保留，但按 ADR-0035 重新归类：它校验的是**页面身份**（本解析器写死了南开
  // 「实习信息」栏目的字段布局），不是供给范围。原先的 `NOT_INTERNSHIP_SECTION` 属「软拒绝」，
  // 也就是页面换了还照样自动接受；改为结构变更后它是硬冲突。
  it("fails closed when the section identity marker or frozen apply url changes", async () => {
    const html = await htmlFixture("university-employment-nankai.synthetic.html");
    const source = resolveUniversityEmploymentSource("supvan-info-internships");

    expect(() =>
      parseNankaiCorrecruitPage(html.replace("实习信息,", "招聘信息,"), NANKAI_PAGE_URL),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");

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

describe("nankai correcruit SME batch 07 sources", () => {
  it("normalizes oneclear roles with the company-domain application email", async () => {
    const html = await htmlFixture("university-employment-nankai-unity-drive.synthetic.html");
    const pageUrl = "https://career.nankai.edu.cn/correcruit/content/id/115887.html";
    const source = resolveUniversityEmploymentSource("unity-drive-internships");
    const job = parseNankaiCorrecruitPage(html, pageUrl);
    const normalized = normalizeUniversityEmploymentJob({
      source,
      job,
      pageEvidenceRef: "fetch-unity-drive",
    });

    expect(job).toMatchObject({
      sourceJobId: "nankai-115887",
      companyName: "深圳一清创新科技有限公司",
      title: "定位算法",
    });
    expect(normalized.companyName).toBe("一清创新");
    expect(normalized.structuredFields).toMatchObject({
      applicationEmail: "synthetic@unity-drive.com",
      publishedAt: { state: "known", value: "2026-05-28" },
    });
    expect(normalized.responsibilities).toContain("无人车定位算法");
    expect(normalized.responsibilities).not.toContain("任职要求");
    expect(normalized.requirements).toContain("可连续实习六个月");
  });

  it("normalizes the triple-stone summer internship and fails on a foreign email", async () => {
    const html = await htmlFixture("university-employment-nankai-triple-stone.synthetic.html");
    const pageUrl = "https://career.nankai.edu.cn/correcruit/content/id/116046.html";
    const source = resolveUniversityEmploymentSource("triple-stone-internships");
    const job = parseNankaiCorrecruitPage(html, pageUrl);
    const normalized = normalizeUniversityEmploymentJob({
      source,
      job,
      pageEvidenceRef: "fetch-triple-stone",
    });

    expect(normalized.companyName).toBe("三石园科技");
    expect(normalized.structuredFields).toMatchObject({
      applicationEmail: "synthetic@triple-stone.com",
    });
    expect(normalized.responsibilities).toBe("参与新员工培训并深入生产一线学习工艺流程。");
    expect(normalized.responsibilities).not.toContain("针对对象");
    expect(normalized.requirements).toContain("针对对象：2027届、2028届毕业生");
    expect(normalized.requirements).toContain("专业不限");
    expect(() =>
      normalizeUniversityEmploymentJob({
        source,
        job: {
          ...job,
          emails: [{ email: "synthetic@qq.com", sourceText: "职位投递邮箱：synthetic@qq.com" }],
        },
        pageEvidenceRef: "fetch-triple-stone",
      }),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_COMPANY_EMAIL_UNVERIFIED");
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

  // ADR-0035 第一条：工作性质取值不再决定去留，只要求该字段**存在**——缺失说明页面布局变了。
  it("keeps a non-internship employment type but fails closed when the field disappears", async () => {
    const html = await htmlFixture("university-employment-cuhk.synthetic.html");
    const source = resolveUniversityEmploymentSource("jcquant-internships");

    const fullTime = parseCuhkJobViewPage(
      html.replace("工作性质：实习", "工作性质：全职"),
      CUHK_PAGE_URL,
    );
    expect(fullTime.employmentTypeText).toBe("全职");
    expect(
      normalizeUniversityEmploymentJob({ source, job: fullTime, pageEvidenceRef: "fetch" })
        .qualityFlags,
    ).toContainEqual({ code: "OFFICIAL_EMPLOYMENT_TYPE_NOT_INTERNSHIP", detail: "全职" });

    expect(() =>
      parseCuhkJobViewPage(html.replace("工作性质：实习", "工作节奏：实习"), CUHK_PAGE_URL),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_STRUCTURE_CHANGED");

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

describe("cuhk job view detail page (galasports)", () => {
  it("normalizes the sports-game planning internship and company-domain email", async () => {
    const html = await htmlFixture("university-employment-cuhk-galasports.synthetic.html");
    const source = resolveUniversityEmploymentSource("galasports-internships");
    expect(source).toMatchObject({
      companyLegalName: "深圳市望尘科技有限公司",
      companyPageAliases: ["望尘科技"],
    });
    const job = parseCuhkJobViewPage(html, GALASPORTS_CUHK_PAGE_URL);

    expect(job).toMatchObject({
      sourceJobId: "cuhk-468689",
      companyName: "望尘科技",
      title: "望尘科技体育游戏策划实习岗位",
      employmentTypeText: "实习",
      publishedAt: "2026-07-02",
      deadline: "2026-07-31",
    });
    expect(job.responsibilities).toContain("负责体育游戏玩法和系统的设计");
    expect(job.requirements).toContain("热爱体育");
    expect(job.requirements).not.toContain("招生网");
    expect(job.emails).toEqual([
      {
        email: "huangtingting@galasports.com",
        sourceText: "简历作品可直接发邮箱huangtingting@galasports.com",
      },
    ]);

    const normalized = normalizeUniversityEmploymentJob({
      source,
      job,
      pageEvidenceRef: "fetch-cuhk-468689",
    });
    expect(normalized.companyName).toBe("望尘科技");
    expect(normalized.jobFamily).toMatchObject({ state: "known", value: "other" });
    expect(normalized.structuredFields).toMatchObject({
      applicationEmail: "huangtingting@galasports.com",
      deadline: { state: "known", value: "2026-07-31" },
    });
    expect(normalized.qualityFlags).not.toContainEqual(
      expect.objectContaining({ code: "SOURCE_KIND_CONFLICT" }),
    );
  });

  it("fails closed when the application email leaves the official domain", async () => {
    const html = await htmlFixture("university-employment-cuhk-galasports.synthetic.html");
    const source = resolveUniversityEmploymentSource("galasports-internships");
    const job = parseCuhkJobViewPage(
      html.replaceAll("huangtingting@galasports.com", "huangtingting@qq.com"),
      GALASPORTS_CUHK_PAGE_URL,
    );

    expect(() =>
      normalizeUniversityEmploymentJob({
        source,
        job,
        pageEvidenceRef: "fetch-cuhk-468689",
      }),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_COMPANY_EMAIL_UNVERIFIED");
  });

  it("fails closed when the page name is not an evidenced legal name or alias", async () => {
    const html = await htmlFixture("university-employment-cuhk-galasports.synthetic.html");
    const source = resolveUniversityEmploymentSource("galasports-internships");
    const job = parseCuhkJobViewPage(
      html.replaceAll("望尘科技", "其他游戏公司"),
      GALASPORTS_CUHK_PAGE_URL,
    );

    expect(() =>
      normalizeUniversityEmploymentJob({
        source,
        job,
        pageEvidenceRef: "fetch-cuhk-468689",
      }),
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
    // ADR-0035 第一条：「全职,实习」仍然记录为观察项，但不再产出阻塞复核的 `SOURCE_KIND_CONFLICT`。
    expect(normalized.qualityFlags).toContainEqual({
      code: "OFFICIAL_EMPLOYMENT_TYPE_NOT_INTERNSHIP",
      detail: "全职,实习",
    });
    expect(normalized.reviewReasons.map((reason) => reason.code)).not.toContain(
      "SOURCE_KIND_CONFLICT",
    );
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

describe("zju jyxt detail page (hanxu tech)", () => {
  it("parses parenthesized requirement headings and the explicit official Moka link", async () => {
    const html = await htmlFixture("university-employment-zju-hanxu.synthetic.html");
    const source = resolveUniversityEmploymentSource("hanxu-tech-internships");
    const job = parseZjuJyxtPage(html, HANXU_ZJU_PAGE_URL);

    expect(job).toMatchObject({
      sourceJobId: "zju-4CCE42B8467C9601E0653A68DD0E9B18",
      companyName: "寒序科技（北京）有限公司",
      title: "战略与投融资部门实习生",
      employmentTypeText: "实习",
      publishedAt: "2026-03-13",
      deadline: "2026-12-31",
      applicationUrlOnPage:
        "https://app.mokahr.com/campus-recruitment/hanxu/144645?locale=zh-CN#/",
    });
    expect(job.responsibilities).toContain("完善商业计划书和投融资材料");
    expect(job.requirements).toContain("每周可保证3个工作日以上");
    expect(job.requirements).not.toContain("职位类别");

    const normalized = normalizeUniversityEmploymentJob({
      source,
      job,
      pageEvidenceRef: "fetch-hanxu",
    });
    expect(normalized.applyUrl).toBe(
      "https://app.mokahr.com/campus-recruitment/hanxu/144645?locale=zh-CN#/",
    );
    expect(normalized.locations).toMatchObject({ state: "known", value: ["北京"] });
    expect(normalized.structuredFields.durationMonths).toMatchObject({
      state: "known",
      value: 3,
    });
    expect(normalized.structuredFields.weeklyAttendanceDays).toMatchObject({
      state: "known",
      value: 3,
    });
  });

  it("keeps non-internship pages but still requires a parenthesized requirement section", async () => {
    const html = await htmlFixture("university-employment-zju-hanxu.synthetic.html");

    // ADR-0035 第一条：六段结构里的工作性质原样带走，不再据此整条丢弃。
    expect(
      parseZjuJyxtPage(html.replace("<span>实习</span>", "<span>全职</span>"), HANXU_ZJU_PAGE_URL)
        .employmentTypeText,
    ).toBe("全职");
    expect(() =>
      parseZjuJyxtPage(
        html.replace("（二）任职要求", "（二）岗位条件"),
        HANXU_ZJU_PAGE_URL,
      ),
    ).toThrowError("UNIVERSITY_EMPLOYMENT_REQUIREMENTS_SECTION_MISSING");
  });
});
