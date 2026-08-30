import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  BEISEN_ZHIYE_DISPLAY_FIELDS,
  buildBeisenZhiyeApplyUrl,
  buildBeisenZhiyeListRequest,
  buildBeisenZhiyeListUrl,
  isBeisenExplicitInternship,
  listBeisenZhiyeTenants,
  normalizeBeisenLocation,
  normalizeBeisenZhiyeJobAd,
  parseBeisenZhiyeListPage,
  resolveBeisenZhiyeTenant,
} from "./beisen-zhiye-adapter.js";

async function jsonFixture(): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL("../../../../fixtures/ingestion/beisen-zhiye-jobads.synthetic.json", import.meta.url),
      "utf8",
    ),
  );
}

describe("Beisen zhiye adapter", () => {
  it("freezes one tenant per approved source with tenant-scoped hosts", () => {
    expect(listBeisenZhiyeTenants().map((tenant) => [tenant.sourceKey, tenant.host])).toEqual([
      ["huice-campus-internships", "huicecom.zhiye.com"],
      ["adaps-photonics-internships", "adaps-ph.zhiye.com"],
      ["pudutech-internships", "pudutech.zhiye.com"],
      ["shining3d-internships", "shining3d.zhiye.com"],
      ["onerobotics-internships", "woanhome.zhiye.com"],
    ]);
    expect(resolveBeisenZhiyeTenant("huice-campus-internships").category).toBe("2");
    expect(resolveBeisenZhiyeTenant("adaps-photonics-internships").category).toBe("3");
    expect(resolveBeisenZhiyeTenant("pudutech-internships").category).toBe("3");
    expect(resolveBeisenZhiyeTenant("shining3d-internships")).toMatchObject({
      portalId: "957a969f-e192-4ab2-ae07-44c35064f1ab",
      category: "3",
    });
    expect(resolveBeisenZhiyeTenant("onerobotics-internships")).toMatchObject({
      portalId: "8db50333-7ab7-4960-8f87-ddd9468f4766",
      category: "3",
    });
    expect(() => resolveBeisenZhiyeTenant("unknown-tenant")).toThrow(
      "BEISEN_TENANT_NOT_CONFIGURED",
    );
  });

  it("builds a new public tenant entirely from validated adapter options", () => {
    expect(
      resolveBeisenZhiyeTenant({
        sourceKey: "configured-beisen-source",
        organization: { name: "配置化北森测试有限公司" },
        policy: {
          entrypoints: ["https://configured.zhiye.com/intern/jobs"],
          adapterOptions: {
            category: "3",
            pageIndex: 0,
            pageSize: 30,
            portalId: "70f7ec4f-81c8-4ce8-a47c-a4354a7a91dc",
            jobsPagePath: "/intern/jobs",
            companyDisplayName: "配置化北森测试",
          },
        },
      }),
    ).toEqual({
      sourceKey: "configured-beisen-source",
      companyName: "配置化北森测试",
      host: "configured.zhiye.com",
      portalId: "70f7ec4f-81c8-4ce8-a47c-a4354a7a91dc",
      category: "3",
      categoryLabel: "实习",
      jobsPagePath: "/intern/jobs",
      reportedTotalKey: "intern-jobads",
    });
  });

  it("builds the official zero-based page list request with location-enabling display fields", () => {
    const tenant = resolveBeisenZhiyeTenant("pudutech-internships");
    expect(buildBeisenZhiyeListUrl(tenant)).toBe(
      "https://pudutech.zhiye.com/api/Jobad/GetJobAdPageList",
    );
    expect(buildBeisenZhiyeListRequest({ tenant, pageIndex: 0, pageSize: 30 })).toEqual({
      PageIndex: 0,
      PageSize: 30,
      KeyWords: "",
      SpecialType: 0,
      PortalId: "01fb2482-2cdb-41ee-8ec2-dabe83de23e3",
      Category: "3",
      DisplayFields: [...BEISEN_ZHIYE_DISPLAY_FIELDS],
    });
    expect(BEISEN_ZHIYE_DISPLAY_FIELDS).toContain("LocId");
    expect(() => buildBeisenZhiyeListRequest({ tenant, pageIndex: -1, pageSize: 30 })).toThrow();
    expect(() => buildBeisenZhiyeListRequest({ tenant, pageIndex: 0, pageSize: 31 })).toThrow();
  });

  it("normalizes official region names to city labels", () => {
    expect(normalizeBeisenLocation("广东省·深圳市")).toBe("深圳");
    expect(normalizeBeisenLocation("北京市")).toBe("北京");
    expect(normalizeBeisenLocation("上海市")).toBe("上海");
    expect(normalizeBeisenLocation("香港")).toBe("香港");
  });

  it("parses the job ad list and keeps only explicit internship titles", async () => {
    const page = parseBeisenZhiyeListPage(await jsonFixture());
    expect(page.total).toBe(4);
    expect(page.jobs).toHaveLength(4);
    expect(page.jobs.filter(isBeisenExplicitInternship).map((job) => job.JobAdId)).toEqual([
      900001, 900002, 900004,
    ]);

    const tenant = resolveBeisenZhiyeTenant("huice-campus-internships");
    const internship = page.jobs[0];
    expect(internship).toBeDefined();
    if (!internship) throw new Error("FIXTURE_JOB_MISSING");
    const normalized = normalizeBeisenZhiyeJobAd({
      tenant,
      job: internship,
      listItemIndex: 0,
      pageEvidenceRef: "fetch-beisen-list",
    });
    expect(normalized.companyName).toBe("慧策");
    expect(normalized.sourceJobId).toBe("900001");
    expect(normalized.applyUrl).toBe("https://huicecom.zhiye.com/campus/jobs");
    expect(normalized.locations).toMatchObject({ state: "known", value: ["北京"] });
    expect(normalized.structuredFields.publishedAt).toMatchObject({
      state: "known",
      value: "2026-04-20",
    });
    expect(normalized.structuredFields.durationMonths).toMatchObject({ state: "known", value: 3 });
    expect(normalized.structuredFields.weeklyAttendanceDays).toMatchObject({
      state: "known",
      value: 4,
    });
    expect(normalized.structuredFields.deadline.state).toBe("unknown");
    expect(normalized.qualityFlags.map((flag) => flag.code)).not.toContain("SOURCE_KIND_CONFLICT");
    expect(normalized.reviewReasons.map((reason) => reason.code)).toContain(
      "SOURCE_POLICY_PENDING",
    );
  });

  it("keeps a stated deadline and treats Beisen sentinel dates as unknown", async () => {
    const page = parseBeisenZhiyeListPage(await jsonFixture());
    const tenant = resolveBeisenZhiyeTenant("adaps-photonics-internships");
    const withDeadline = page.jobs.find((job) => job.JobAdId === 900002);
    expect(withDeadline).toBeDefined();
    if (!withDeadline) throw new Error("FIXTURE_JOB_MISSING");
    const normalized = normalizeBeisenZhiyeJobAd({
      tenant,
      job: withDeadline,
      listItemIndex: 1,
      pageEvidenceRef: "fetch-beisen-list",
    });
    expect(normalized.applyUrl).toBe("https://adaps-ph.zhiye.com/intern/jobs");
    expect(normalized.structuredFields.deadline).toMatchObject({
      state: "known",
      value: "2027-03-31",
    });
    expect(normalized.structuredFields.publishedAt.state).toBe("unknown");
    expect(normalized.locations.state).toBe("unknown");

    const sentinelDeadline = normalizeBeisenZhiyeJobAd({
      tenant,
      job: { ...withDeadline, EndTime: "2222-02-02T00:00:00" },
      listItemIndex: 1,
      pageEvidenceRef: "fetch-beisen-list",
    });
    expect(sentinelDeadline.structuredFields.deadline.state).toBe("unknown");
  });

  it("keeps a title-marked internship with conflicting Kind but records a review reason", async () => {
    const page = parseBeisenZhiyeListPage(await jsonFixture());
    const tenant = resolveBeisenZhiyeTenant("huice-campus-internships");
    const conflicted = page.jobs.find((job) => job.JobAdId === 900004);
    expect(conflicted).toBeDefined();
    if (!conflicted) throw new Error("FIXTURE_JOB_MISSING");
    const normalized = normalizeBeisenZhiyeJobAd({
      tenant,
      job: conflicted,
      listItemIndex: 3,
      pageEvidenceRef: "fetch-beisen-list",
    });
    expect(normalized.locations).toMatchObject({ state: "known", value: ["深圳", "成都"] });
    expect(normalized.qualityFlags).toContainEqual({
      code: "SOURCE_KIND_CONFLICT",
      detail: "全职",
    });
    expect(normalized.reviewReasons.map((reason) => reason.code)).toContain("SOURCE_KIND_CONFLICT");
  });

  it("normalizes campus jobs without an internship marker instead of dropping them", async () => {
    const page = parseBeisenZhiyeListPage(await jsonFixture());
    const tenant = resolveBeisenZhiyeTenant("huice-campus-internships");
    const campusOnly = page.jobs.find((job) => job.JobAdId === 900003);
    expect(campusOnly).toBeDefined();
    if (!campusOnly) throw new Error("FIXTURE_JOB_MISSING");

    // ADR-0035 第一条：此处原先抛 `BEISEN_NOT_EXPLICIT_INTERNSHIP`。慧策租户请求的是
    // category="2"（校园招聘），抓回来后被那条过滤全部拒绝——校招岗位被取回后被扔掉。
    // 供给单位已改为「在校生可投岗位」，筛选上移到资格层，适配器只忠实解析。
    const normalized = normalizeBeisenZhiyeJobAd({
      tenant,
      job: campusOnly,
      listItemIndex: 2,
      pageEvidenceRef: "fetch-beisen-list",
    });
    expect(normalized.title).toBe(campusOnly.JobAdName);
    expect(normalized.sourceJobId).toBe(String(campusOnly.JobAdId));

    // 观察函数保留，但不再决定去留。
    expect(isBeisenExplicitInternship(campusOnly)).toBe(false);
  });

  it("fails closed on non-200 codes, inconsistent counts, or duplicate ids", async () => {
    const fixture = (await jsonFixture()) as { Code: number; Count: number; Data: unknown[] };
    expect(() => parseBeisenZhiyeListPage({ ...fixture, Code: 400 })).toThrow();
    expect(() => parseBeisenZhiyeListPage({ ...fixture, Count: 2 })).toThrow(
      "BEISEN_LIST_COUNT_INCONSISTENT",
    );
    const duplicated = JSON.parse(JSON.stringify(fixture)) as {
      Data: Array<{ JobAdId: number }>;
    };
    const secondJob = duplicated.Data[1];
    if (!secondJob) throw new Error("FIXTURE_JOB_MISSING");
    secondJob.JobAdId = 900001;
    expect(() => parseBeisenZhiyeListPage(duplicated)).toThrow("BEISEN_DUPLICATE_JOBAD_ID");
  });

  it("points the apply link at the tenant's official jobs page", () => {
    expect(buildBeisenZhiyeApplyUrl(resolveBeisenZhiyeTenant("pudutech-internships"))).toBe(
      "https://pudutech.zhiye.com/intern/jobs",
    );
    expect(buildBeisenZhiyeApplyUrl(resolveBeisenZhiyeTenant("huice-campus-internships"))).toBe(
      "https://huicecom.zhiye.com/campus/jobs",
    );
    expect(buildBeisenZhiyeApplyUrl(resolveBeisenZhiyeTenant("adaps-photonics-internships"))).toBe(
      "https://adaps-ph.zhiye.com/intern/jobs",
    );
    expect(buildBeisenZhiyeApplyUrl(resolveBeisenZhiyeTenant("onerobotics-internships"))).toBe(
      "https://woanhome.zhiye.com/intern/jobs",
    );
  });
});
