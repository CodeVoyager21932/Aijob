import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  listUniversityEmploymentSources,
  normalizeUniversityEmploymentJob,
  normalizeUniversityLocation,
  parseCuhkJobViewPage,
  parseNankaiCorrecruitPage,
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

describe("university employment source registry", () => {
  it("freezes the four batch-02 sources with their carrier formats", () => {
    const sources = listUniversityEmploymentSources();
    expect(sources.map((source) => source.sourceKey)).toEqual([
      "supvan-info-internships",
      "jcquant-internships",
      "shengumedia-internships",
      "hr-soft-internships",
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
