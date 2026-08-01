import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { officialSourceAdapterVersions } from "./official-source-adapters.js";
import {
  assessSource,
  listSourceKeys,
  loadSourceConfig,
  parseSourceConfigValue,
} from "./source-config.js";
import { TENCENT_ADAPTER_VERSION } from "./tencent-campus-adapter.js";

interface MutableSourceConfigFixture {
  sourceType: string;
  candidate: { acquisitionMode: string };
  policy: {
    status: string;
    adapterKey: string;
    crawlInterval: { enabled: boolean; minimumHours: number };
    refreshCoverage: string;
    absencePolicy: string;
  };
  localProbe: { enabled: boolean };
}

async function sourceConfigFixture(name: string): Promise<MutableSourceConfigFixture> {
  const fixtureDirectory = fileURLToPath(
    new URL("../../../../fixtures/source-configs/", import.meta.url),
  );
  return JSON.parse(
    await readFile(path.join(fixtureDirectory, name), "utf8"),
  ) as MutableSourceConfigFixture;
}

describe("Tencent source configuration", () => {
  it("keeps a policy-failed source in local-probe-only status", async () => {
    const config = await loadSourceConfig("tencent-campus");
    const assessment = assessSource(config);

    expect(config.sourceType).toBe("organization_career_site");
    expect(config.policy.status).toBe("pending_review");
    expect(config.policy.adapterVersion).toBe(TENCENT_ADAPTER_VERSION);
    expect(config.candidate.hardGates.accessPolicyAccepted).toBe(false);
    expect(config.localProbe.requestBudget).toEqual({
      maxItems: 20,
      maxPages: 4,
      maxRequests: 24,
      minimumIntervalMs: 1500,
    });
    expect(config.localProbe.queryStreams.map((stream) => stream.targetItems)).toEqual([10, 10]);
    expect(config.policy.fetchTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pathPrefix: "/api/v1/position/searchPosition",
          allowRedirects: false,
          allowedQueryParameters: [],
        }),
        expect.objectContaining({
          pathPrefix: "/api/v1/jobDetails/getJobDetailsByPostId",
          allowRedirects: false,
          allowedQueryParameters: ["postId"],
        }),
      ]),
    );
    expect(assessment).toEqual({
      hardGatesPassed: false,
      totalScore: 45,
      decision: "ineligible",
    });
  });

  it("normalizes product family ids as numbers without changing the source file", async () => {
    const config = await loadSourceConfig("tencent-campus");
    const productStream = config.localProbe.queryStreams[0];

    expect(productStream?.positionFamilyIds).toEqual([79, 80, 83, 94, 219, 253]);
    expect(productStream?.positionFamilyIds.every(Number.isSafeInteger)).toBe(true);
  });
});

describe("controlled local source configurations", () => {
  it("discovers source configuration files instead of relying on a source-key allowlist", async () => {
    await expect(listSourceKeys()).resolves.toEqual([
      "adaps-photonics-internships",
      "allwinner-gdut-internships",
      "baidu-internships",
      "bytedance-campus-manual",
      "citics-shanghai-summer-internship",
      "dingwei-consulting-internships",
      "dtl-quant-internships",
      "fanruan-trainee-internships",
      "galasports-internships",
      "hanxu-tech-internships",
      "hr-soft-internships",
      "huice-campus-internships",
      "jcquant-internships",
      "jd-campus-internships",
      "kunlunxin-internships",
      "meituan-official",
      "nankai-tal-2027",
      "onerobotics-internships",
      "pudutech-internships",
      "sharecapital-internships",
      "shengumedia-internships",
      "shining3d-internships",
      "spirit-ai-feishu-manual",
      "supvan-info-internships",
      "tencent-campus",
      "triple-stone-internships",
      "unity-drive-internships",
    ]);
  });

  it.each([
    ["adaps-photonics-internships", "beisen-zhiye-public-api", true],
    ["allwinner-gdut-internships", "university-employment-detail-html", false],
    ["baidu-internships", "baidu-ssr-deterministic-html", true],
    ["bytedance-campus-manual", "bytedance-manual-browser-snapshot", false],
    ["citics-shanghai-summer-internship", "university-employment-detail-html", true],
    ["dingwei-consulting-internships", "university-employment-detail-html", true],
    ["dtl-quant-internships", "university-employment-detail-html", false],
    ["fanruan-trainee-internships", "fanruan-trainee-public-api", true],
    ["galasports-internships", "university-employment-detail-html", false],
    ["hanxu-tech-internships", "university-employment-detail-html", true],
    ["hr-soft-internships", "university-employment-detail-html", true],
    ["huice-campus-internships", "beisen-zhiye-public-api", true],
    ["jcquant-internships", "university-employment-detail-html", true],
    ["jd-campus-internships", "jd-campus-public-api", true],
    ["kunlunxin-internships", "university-employment-detail-html", false],
    ["onerobotics-internships", "beisen-zhiye-public-api", true],
    ["pudutech-internships", "beisen-zhiye-public-api", true],
    ["sharecapital-internships", "university-employment-detail-html", true],
    ["shengumedia-internships", "university-employment-detail-html", true],
    ["shining3d-internships", "beisen-zhiye-public-api", true],
    ["spirit-ai-feishu-manual", "official-account-manual-snapshot", false],
    ["supvan-info-internships", "university-employment-detail-html", true],
    ["tencent-campus", "tencent-public-api", true],
    ["triple-stone-internships", "university-employment-detail-html", true],
    ["unity-drive-internships", "university-employment-detail-html", true],
    ["meituan-official", "meituan-public-api", true],
    ["nankai-tal-2027", "nankai-tal-deterministic-html", true],
  ] as const)(
    "keeps %s in its expected local-only policy state",
    async (sourceKey, adapterKey, probeEnabled) => {
      const config = await loadSourceConfig(sourceKey);
      const assessment = assessSource(config);
      const expectedPolicyStatus = [
        "allwinner-gdut-internships",
        "dtl-quant-internships",
        "galasports-internships",
        "kunlunxin-internships",
      ].includes(sourceKey)
        ? "paused"
        : "pending_review";

      expect(config.sourceKey).toBe(sourceKey);
      expect(config.policy.status).toBe(expectedPolicyStatus);
      expect(config.policy.adapterKey).toBe(adapterKey);
      expect(config.policy.adapterVersion).toBe(officialSourceAdapterVersions[adapterKey]);
      expect(config.policy.crawlInterval.minimumHours).toBeGreaterThan(0);
      expect(["full_scope", "tracked_records", "manual_snapshot"]).toContain(
        config.policy.refreshCoverage,
      );
      expect(config.localProbe.enabled).toBe(probeEnabled);
      expect(config.localProbe.requestBudget.maxRequests).toBeGreaterThanOrEqual(
        config.localProbe.requestBudget.maxPages,
      );
      expect(config.policy.fetchTargets.every((target) => !target.allowRedirects)).toBe(true);
      expect(config.policy.applyTargets.every((target) => !target.allowRedirects)).toBe(true);
      expect(assessment.hardGatesPassed).toBe(false);
      expect(assessment.decision).toBe("ineligible");
    },
  );

  it("limits the university source to one exact page and the verified Moka tenant", async () => {
    const config = await loadSourceConfig("nankai-tal-2027");
    expect(config.policy.fetchTargets).toEqual([
      expect.objectContaining({
        method: "GET",
        host: "career.nankai.edu.cn",
        pathPrefix: "/correcruit/content/id/115842.html",
        allowedQueryParameters: [],
      }),
    ]);
    expect(config.policy.applyTargets).toEqual([
      expect.objectContaining({
        host: "app.mokahr.com",
        pathPrefix: "/campus-recruitment/tal/95443",
        allowedQueryParameters: ["locale"],
      }),
    ]);
  });

  it("limits Baidu to the anonymous SSR internship page and UUID detail routes", async () => {
    const config = await loadSourceConfig("baidu-internships");
    expect(config.localProbe.requestBudget).toEqual({
      maxItems: 10,
      maxPages: 1,
      maxRequests: 1,
      minimumIntervalMs: 2000,
    });
    expect(config.policy.fetchTargets).toEqual([
      expect.objectContaining({
        method: "GET",
        host: "talent.baidu.com",
        pathPrefix: "/jobs/list",
        allowedQueryParameters: ["recruitType"],
      }),
    ]);
    expect(config.policy.applyTargets).toEqual([
      expect.objectContaining({
        host: "talent.baidu.com",
        pathPrefix: "/jobs/detail/INTERN/",
        allowedQueryParameters: [],
      }),
    ]);
  });

  it("limits JD to one anonymous internship API page and official detail routes", async () => {
    const config = await loadSourceConfig("jd-campus-internships");
    expect(config.localProbe.requestBudget).toEqual({
      maxItems: 10,
      maxPages: 1,
      maxRequests: 1,
      minimumIntervalMs: 2000,
    });
    expect(config.policy.fetchTargets).toEqual([
      expect.objectContaining({
        method: "POST",
        host: "campus.jd.com",
        pathPrefix: "/api/wx/position/page",
        allowedQueryParameters: ["type"],
      }),
    ]);
    expect(config.policy.applyTargets).toEqual([
      expect.objectContaining({
        method: "GET",
        host: "campus.jd.com",
        pathPrefix: "/api/wx/position/index",
        allowedQueryParameters: ["type"],
      }),
    ]);
  });

  it("limits Fanruan to the trainee list form POST and numeric detail routes", async () => {
    const config = await loadSourceConfig("fanruan-trainee-internships");
    expect(config.localProbe.requestBudget).toEqual({
      maxItems: 30,
      maxPages: 3,
      maxRequests: 40,
      minimumIntervalMs: 2000,
    });
    expect(config.policy.fetchTargets).toEqual([
      expect.objectContaining({
        method: "POST",
        host: "join.fanruan.com",
        pathPrefix: "/trainee",
        allowedQueryParameters: [],
      }),
    ]);
    expect(config.policy.applyTargets).toEqual([
      expect.objectContaining({
        method: "GET",
        host: "join.fanruan.com",
        pathPrefix: "/trainee/detail",
        allowedQueryParameters: ["id"],
      }),
    ]);
  });

  it.each([
    ["huice-campus-internships", "huicecom.zhiye.com", "/campus/jobs", 3],
    ["adaps-photonics-internships", "adaps-ph.zhiye.com", "/intern/jobs", 3],
    ["pudutech-internships", "pudutech.zhiye.com", "/intern/jobs", 3],
    ["onerobotics-internships", "woanhome.zhiye.com", "/intern/jobs", 2],
  ] as const)(
    "limits %s to its own Beisen tenant list API and official jobs page",
    async (sourceKey, host, jobsPagePath, policyVersion) => {
      const config = await loadSourceConfig(sourceKey);
      expect(config.policy.version).toBe(policyVersion);
      expect(config.localProbe.requestBudget).toEqual({
        maxItems: 30,
        maxPages: 3,
        maxRequests: 40,
        minimumIntervalMs: 2000,
      });
      expect(config.policy.fetchTargets).toEqual([
        expect.objectContaining({
          method: "POST",
          host,
          pathPrefix: "/api/Jobad/GetJobAdPageList",
          allowedQueryParameters: [],
        }),
      ]);
      expect(config.policy.applyTargets).toEqual([
        expect.objectContaining({
          method: "GET",
          host,
          pathPrefix: jobsPagePath,
          allowedQueryParameters: [],
        }),
      ]);
    },
  );

  it.each([
    [
      "supvan-info-internships",
      "career.nankai.edu.cn",
      "/correcruit/content/id/116240.html",
      [] as string[],
      { host: "www.supvan.com", pathPrefix: "/joinUs" },
      { maxItems: 6, maxPages: 6, maxRequests: 10, minimumIntervalMs: 2000 },
      5,
    ],
    [
      "jcquant-internships",
      "career.cuhk.edu.cn",
      "/job/view/id/466931",
      [] as string[],
      { host: "career.cuhk.edu.cn", pathPrefix: "/job/view/id/466931" },
      { maxItems: 1, maxPages: 1, maxRequests: 2, minimumIntervalMs: 2000 },
      5,
    ],
    [
      "galasports-internships",
      "career.cuhk.edu.cn",
      "/job/view/id/468689",
      [] as string[],
      { host: "career.cuhk.edu.cn", pathPrefix: "/job/view/id/468689" },
      { maxItems: 1, maxPages: 1, maxRequests: 2, minimumIntervalMs: 2000 },
      3,
    ],
    [
      "shengumedia-internships",
      "career.cuhk.edu.cn",
      "/job/view/id/467659",
      [] as string[],
      { host: "career.cuhk.edu.cn", pathPrefix: "/job/view/id/467659" },
      { maxItems: 1, maxPages: 1, maxRequests: 2, minimumIntervalMs: 2000 },
      5,
    ],
    [
      "hr-soft-internships",
      "www.career.zju.edu.cn",
      "/jyxt/sczp/zpztgl/ckZpgwXq.zf",
      ["zpxxbh"],
      { host: "www.career.zju.edu.cn", pathPrefix: "/jyxt/sczp/zpztgl/ckZpgwXq.zf" },
      { maxItems: 1, maxPages: 1, maxRequests: 2, minimumIntervalMs: 2000 },
      5,
    ],
    [
      "kunlunxin-internships",
      "www.career.zju.edu.cn",
      "/jyxt/sczp/zpztgl/ckZpgwXq.zf",
      ["zpxxbh"],
      { host: "www.career.zju.edu.cn", pathPrefix: "/jyxt/sczp/zpztgl/ckZpgwXq.zf" },
      { maxItems: 1, maxPages: 1, maxRequests: 10, minimumIntervalMs: 2000 },
      5,
    ],
    [
      "dingwei-consulting-internships",
      "www.career.zju.edu.cn",
      "/jyxt/sczp/zpztgl/ckZpgwXq.zf",
      ["zpxxbh"],
      { host: "www.career.zju.edu.cn", pathPrefix: "/jyxt/sczp/zpztgl/ckZpgwXq.zf" },
      { maxItems: 1, maxPages: 1, maxRequests: 10, minimumIntervalMs: 2000 },
      5,
    ],
    [
      "sharecapital-internships",
      "career.cuhk.edu.cn",
      "/job/view/id/467309",
      [] as string[],
      { host: "career.cuhk.edu.cn", pathPrefix: "/job/view/id/467309" },
      { maxItems: 1, maxPages: 1, maxRequests: 10, minimumIntervalMs: 2000 },
      5,
    ],
    [
      "dtl-quant-internships",
      "career.nankai.edu.cn",
      "/correcruit/content/id/116147.html",
      [] as string[],
      { host: "www.dytechlab.com", pathPrefix: "/careers" },
      { maxItems: 8, maxPages: 1, maxRequests: 10, minimumIntervalMs: 2000 },
      5,
    ],
    [
      "unity-drive-internships",
      "career.nankai.edu.cn",
      "/correcruit/content/id/115887.html",
      [] as string[],
      { host: "career.nankai.edu.cn", pathPrefix: "/correcruit/content/id/115887.html" },
      { maxItems: 3, maxPages: 3, maxRequests: 10, minimumIntervalMs: 2000 },
      5,
    ],
    [
      "triple-stone-internships",
      "career.nankai.edu.cn",
      "/correcruit/content/id/116046.html",
      [] as string[],
      { host: "career.nankai.edu.cn", pathPrefix: "/correcruit/content/id/116046.html" },
      { maxItems: 1, maxPages: 1, maxRequests: 10, minimumIntervalMs: 2000 },
      5,
    ],
    [
      "hanxu-tech-internships",
      "www.career.zju.edu.cn",
      "/jyxt/sczp/zpztgl/ckZpgwXq.zf",
      ["zpxxbh"],
      { host: "app.mokahr.com", pathPrefix: "/campus-recruitment/hanxu/144645" },
      { maxItems: 2, maxPages: 2, maxRequests: 10, minimumIntervalMs: 2000 },
      3,
    ],
  ] as const)(
    "limits %s to its frozen university detail pages",
    async (
      sourceKey,
      fetchHost,
      firstFetchPath,
      queryParameters,
      applyTarget,
      budget,
      policyVersion,
    ) => {
      const config = await loadSourceConfig(sourceKey);
      expect(config.policy.version).toBe(policyVersion);
      expect(config.localProbe.requestBudget).toEqual(budget);
      expect(config.policy.fetchTargets[0]).toMatchObject({
        method: "GET",
        host: fetchHost,
        pathPrefix: firstFetchPath,
        allowedQueryParameters: [...queryParameters],
      });
      expect(config.policy.fetchTargets.every((target) => target.host === fetchHost)).toBe(true);
      expect(config.policy.applyTargets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            host: applyTarget.host,
            pathPrefix: applyTarget.pathPrefix,
          }),
        ]),
      );
    },
  );

  it("records the evidenced medium scale for HR-Soft from the university employer panel", async () => {
    const config = await loadSourceConfig("hr-soft-internships");
    expect(config.organization.scale).toMatchObject({
      band: "medium",
      evidenceUrl:
        "https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4DE5B03172671701E0653A68DD0E9B18",
      lastVerifiedAt: "2026-07-26T00:00:00.000Z",
    });
    for (const sourceKey of [
      "supvan-info-internships",
      "jcquant-internships",
      "shengumedia-internships",
    ] as const) {
      const other = await loadSourceConfig(sourceKey);
      expect(other.organization.scale.band).toBe("unknown");
    }
  });

  it("records evidenced large scales and keeps unresolved organizations unknown", async () => {
    const huice = await loadSourceConfig("huice-campus-internships");
    expect(huice.organization.scale).toMatchObject({
      band: "large",
      evidenceUrl: "https://career.nankai.edu.cn/correcruit/content/id/114173.html",
      lastVerifiedAt: "2026-07-26T00:00:00.000Z",
    });
    const fanruan = await loadSourceConfig("fanruan-trainee-internships");
    expect(fanruan.organization.scale).toMatchObject({
      band: "large",
      evidenceUrl: "https://join.fanruan.com/explore-fr",
      lastVerifiedAt: "2026-07-29T00:00:00.000Z",
    });
    for (const sourceKey of ["adaps-photonics-internships", "pudutech-internships"] as const) {
      const config = await loadSourceConfig(sourceKey);
      expect(config.organization.scale.band).toBe("unknown");
    }
  });

  it("records Share Capital as small and keeps unresolved batch-03 scales unknown", async () => {
    const sharecapital = await loadSourceConfig("sharecapital-internships");
    expect(sharecapital.organization.scale).toMatchObject({
      band: "small",
      evidenceUrl: "https://www.sharecapital.cn/about-us",
      lastVerifiedAt: "2026-07-29T00:00:00.000Z",
    });
    for (const sourceKey of [
      "kunlunxin-internships",
      "dingwei-consulting-internships",
      "dtl-quant-internships",
    ] as const) {
      const config = await loadSourceConfig(sourceKey);
      expect(config.organization.scale.band).toBe("unknown");
    }
  });

  it("records batch-07 SME scale evidence without using platform estimates", async () => {
    const expected = [
      [
        "onerobotics-internships",
        "medium",
        "https://www.hkexnews.hk/listedco/listconews/sehk/2026/0429/2026042904445_c.pdf",
      ],
      ["unity-drive-internships", "small", "https://www.unity-drive.com/about.html"],
      ["triple-stone-internships", "medium", "https://www.triple-stone.cn/about-us/"],
    ] as const;

    for (const [sourceKey, band, evidenceUrl] of expected) {
      const config = await loadSourceConfig(sourceKey);
      expect(config.organization.scale).toMatchObject({
        band,
        evidenceUrl,
        lastVerifiedAt: "2026-07-30T00:00:00.000Z",
      });
    }
  });

  it("records the official small-team evidence for Hanxu Tech", async () => {
    const config = await loadSourceConfig("hanxu-tech-internships");
    expect(config.organization.scale).toMatchObject({
      band: "small",
      evidenceUrl: "https://sie.pku.edu.cn/xwgg/xwdt/09fd2cf34e034555949484ebe6a15177.htm",
      lastVerifiedAt: "2026-07-31T00:00:00.000Z",
    });
    expect(config.policy.applyTargets).toEqual([
      expect.objectContaining({
        method: "GET",
        host: "app.mokahr.com",
        pathPrefix: "/campus-recruitment/hanxu/144645",
        allowedQueryParameters: ["locale"],
      }),
    ]);
  });

  it("enables 21 deterministic sources and two reminders while keeping four sources paused", async () => {
    const deterministic = [];
    const reminders = [];
    const paused = [];
    const unexpectedlyDisabled = [];
    for (const sourceKey of await listSourceKeys()) {
      const config = await loadSourceConfig(sourceKey);
      if (config.policy.status === "paused") {
        paused.push({
          sourceKey,
          version: config.policy.version,
          crawlEnabled: config.policy.crawlInterval.enabled,
          localProbeEnabled: config.localProbe.enabled,
        });
      } else if (!config.policy.crawlInterval.enabled) {
        unexpectedlyDisabled.push(sourceKey);
      } else if (config.policy.refreshCoverage === "manual_snapshot") {
        reminders.push({
          sourceKey,
          version: config.policy.version,
          minimumHours: config.policy.crawlInterval.minimumHours,
          localProbeEnabled: config.localProbe.enabled,
        });
      } else {
        deterministic.push({
          sourceKey,
          version: config.policy.version,
          coverage: config.policy.refreshCoverage,
          absencePolicy: config.policy.absencePolicy,
          minimumHours: config.policy.crawlInterval.minimumHours,
        });
      }
    }

    expect(deterministic).toEqual([
      {
        sourceKey: "adaps-photonics-internships",
        version: 3,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 24,
      },
      {
        sourceKey: "baidu-internships",
        version: 3,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 24,
      },
      {
        sourceKey: "citics-shanghai-summer-internship",
        version: 6,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 168,
      },
      {
        sourceKey: "dingwei-consulting-internships",
        version: 5,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 168,
      },
      {
        sourceKey: "fanruan-trainee-internships",
        version: 3,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 24,
      },
      {
        sourceKey: "hanxu-tech-internships",
        version: 3,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 168,
      },
      {
        sourceKey: "hr-soft-internships",
        version: 5,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 168,
      },
      {
        sourceKey: "huice-campus-internships",
        version: 3,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 24,
      },
      {
        sourceKey: "jcquant-internships",
        version: 5,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 168,
      },
      {
        sourceKey: "jd-campus-internships",
        version: 2,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 24,
      },
      {
        sourceKey: "meituan-official",
        version: 4,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 24,
      },
      {
        sourceKey: "nankai-tal-2027",
        version: 3,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 24,
      },
      {
        sourceKey: "onerobotics-internships",
        version: 2,
        coverage: "full_scope",
        absencePolicy: "close_after_two_complete_absences",
        minimumHours: 24,
      },
      {
        sourceKey: "pudutech-internships",
        version: 3,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 24,
      },
      {
        sourceKey: "sharecapital-internships",
        version: 5,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 168,
      },
      {
        sourceKey: "shengumedia-internships",
        version: 5,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 168,
      },
      {
        sourceKey: "shining3d-internships",
        version: 3,
        coverage: "full_scope",
        absencePolicy: "close_after_two_complete_absences",
        minimumHours: 24,
      },
      {
        sourceKey: "supvan-info-internships",
        version: 5,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 168,
      },
      {
        sourceKey: "tencent-campus",
        version: 6,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 24,
      },
      {
        sourceKey: "triple-stone-internships",
        version: 5,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 168,
      },
      {
        sourceKey: "unity-drive-internships",
        version: 5,
        coverage: "tracked_records",
        absencePolicy: "none",
        minimumHours: 168,
      },
    ]);
    expect(reminders).toEqual([
      {
        sourceKey: "bytedance-campus-manual",
        version: 3,
        minimumHours: 168,
        localProbeEnabled: false,
      },
      {
        sourceKey: "spirit-ai-feishu-manual",
        version: 4,
        minimumHours: 168,
        localProbeEnabled: false,
      },
    ]);
    expect(paused).toEqual([
      {
        sourceKey: "allwinner-gdut-internships",
        version: 6,
        crawlEnabled: false,
        localProbeEnabled: false,
      },
      {
        sourceKey: "dtl-quant-internships",
        version: 5,
        crawlEnabled: false,
        localProbeEnabled: false,
      },
      {
        sourceKey: "galasports-internships",
        version: 3,
        crawlEnabled: false,
        localProbeEnabled: false,
      },
      {
        sourceKey: "kunlunxin-internships",
        version: 5,
        crawlEnabled: false,
        localProbeEnabled: false,
      },
    ]);
    expect(unexpectedlyDisabled).toEqual([]);
  });

  it("records the official medium-scale evidence for Gala Sports", async () => {
    const config = await loadSourceConfig("galasports-internships");
    expect(config.organization).toMatchObject({
      slug: "galasports",
      name: "深圳市望尘科技有限公司",
      officialDomain: "galasports.com",
      scale: {
        band: "medium",
        evidenceUrl: "https://www.galasports.com/about.html",
        lastVerifiedAt: "2026-07-31T00:00:00.000Z",
      },
    });
  });

  it("keeps ByteDance browser snapshots manual, internship-only and unable to live probe", async () => {
    const config = await loadSourceConfig("bytedance-campus-manual");
    expect(config.candidate.acquisitionMode).toBe("browser_required");
    expect(config.localProbe.enabled).toBe(false);
    expect(config.policy).toMatchObject({
      crawlInterval: { enabled: true, minimumHours: 168 },
      refreshCoverage: "manual_snapshot",
      absencePolicy: "none",
    });
    expect(config.policy.fetchTargets).toEqual([
      expect.objectContaining({
        method: "GET",
        host: "jobs.bytedance.com",
        pathPrefix: "/campus/position",
        allowedQueryParameters: [],
      }),
    ]);
    expect(config.policy.policyNotes).toContain("导入 CLI 本身不得触网");
  });

  it("rejects network probing for every browser-required source type", async () => {
    const fixture = await sourceConfigFixture("official-account-test.json");
    fixture.sourceType = "organization_career_site";
    fixture.policy.adapterKey = "tencent-public-api";
    fixture.localProbe.enabled = true;
    expect(() => parseSourceConfigValue(fixture)).toThrow(
      "browser_required sources cannot enable network probing",
    );
  });

  it("requires browser sources to use reminder-only refresh coverage", async () => {
    const fixture = await sourceConfigFixture("bytedance-manual-test.json");
    fixture.policy.refreshCoverage = "tracked_records";

    expect(() => parseSourceConfigValue(fixture)).toThrow(
      "browser_required sources require manual_snapshot refresh coverage",
    );
  });

  it("allows absence closure only for complete deterministic coverage", async () => {
    const manual = await sourceConfigFixture("bytedance-manual-test.json");
    manual.policy.absencePolicy = "close_after_two_complete_absences";
    expect(() => parseSourceConfigValue(manual)).toThrow(
      "manual_snapshot sources cannot close jobs from automated absence",
    );

    const tracked = await sourceConfigFixture("bytedance-manual-test.json");
    tracked.candidate.acquisitionMode = "deterministic_html";
    tracked.policy.refreshCoverage = "tracked_records";
    tracked.policy.absencePolicy = "close_after_two_complete_absences";
    expect(() => parseSourceConfigValue(tracked)).toThrow(
      "only full_scope refresh coverage can close jobs from absence",
    );

    tracked.policy.refreshCoverage = "full_scope";
    expect(() => parseSourceConfigValue(tracked)).not.toThrow();
  });

  it("blocks inactive deterministic schedules but permits reminder-only browser schedules", async () => {
    for (const status of ["paused", "blocked", "retired"]) {
      const deterministic = await sourceConfigFixture("bytedance-manual-test.json");
      deterministic.candidate.acquisitionMode = "deterministic_html";
      deterministic.policy.status = status;
      deterministic.policy.crawlInterval.enabled = true;
      deterministic.policy.refreshCoverage = "tracked_records";
      expect(() => parseSourceConfigValue(deterministic)).toThrow(
        "inactive sources cannot enable deterministic network refresh",
      );
    }

    const reminder = await sourceConfigFixture("bytedance-manual-test.json");
    reminder.policy.status = "paused";
    reminder.policy.crawlInterval.enabled = true;
    expect(() => parseSourceConfigValue(reminder)).not.toThrow();
  });

  it("locks official account sources to local manual import with evidenced company scale", async () => {
    const fixtureDirectory = fileURLToPath(
      new URL("../../../../fixtures/source-configs/", import.meta.url),
    );
    const config = await loadSourceConfig("official-account-test", fixtureDirectory);
    expect(config).toMatchObject({
      sourceType: "organization_official_account",
      organization: {
        scale: {
          band: "medium",
          evidenceUrl: "https://example.com/about",
        },
      },
      candidate: {
        provenanceLevel: "official_account_link",
        acquisitionMode: "browser_required",
      },
      policy: {
        status: "pending_review",
        adapterKey: "official-account-manual-snapshot",
        refreshCoverage: "manual_snapshot",
        absencePolicy: "none",
      },
      localProbe: { enabled: false },
    });
  });
});
