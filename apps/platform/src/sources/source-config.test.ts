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
        "kunlunxin-internships",
      ].includes(sourceKey)
        ? "paused"
        : "pending_review";

      expect(config.sourceKey).toBe(sourceKey);
      expect(config.policy.status).toBe(expectedPolicyStatus);
      expect(config.policy.adapterKey).toBe(adapterKey);
      expect(config.policy.adapterVersion).toBe(officialSourceAdapterVersions[adapterKey]);
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
    ["huice-campus-internships", "huicecom.zhiye.com", "/campus/jobs", 2],
    ["adaps-photonics-internships", "adaps-ph.zhiye.com", "/intern/jobs", 2],
    ["pudutech-internships", "pudutech.zhiye.com", "/intern/jobs", 2],
    ["onerobotics-internships", "woanhome.zhiye.com", "/intern/jobs", 1],
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
    ],
    [
      "jcquant-internships",
      "career.cuhk.edu.cn",
      "/job/view/id/466931",
      [] as string[],
      { host: "career.cuhk.edu.cn", pathPrefix: "/job/view/id/466931" },
      { maxItems: 1, maxPages: 1, maxRequests: 2, minimumIntervalMs: 2000 },
    ],
    [
      "shengumedia-internships",
      "career.cuhk.edu.cn",
      "/job/view/id/467659",
      [] as string[],
      { host: "career.cuhk.edu.cn", pathPrefix: "/job/view/id/467659" },
      { maxItems: 1, maxPages: 1, maxRequests: 2, minimumIntervalMs: 2000 },
    ],
    [
      "hr-soft-internships",
      "www.career.zju.edu.cn",
      "/jyxt/sczp/zpztgl/ckZpgwXq.zf",
      ["zpxxbh"],
      { host: "www.career.zju.edu.cn", pathPrefix: "/jyxt/sczp/zpztgl/ckZpgwXq.zf" },
      { maxItems: 1, maxPages: 1, maxRequests: 2, minimumIntervalMs: 2000 },
    ],
    [
      "kunlunxin-internships",
      "www.career.zju.edu.cn",
      "/jyxt/sczp/zpztgl/ckZpgwXq.zf",
      ["zpxxbh"],
      { host: "www.career.zju.edu.cn", pathPrefix: "/jyxt/sczp/zpztgl/ckZpgwXq.zf" },
      { maxItems: 1, maxPages: 1, maxRequests: 10, minimumIntervalMs: 2000 },
    ],
    [
      "dingwei-consulting-internships",
      "www.career.zju.edu.cn",
      "/jyxt/sczp/zpztgl/ckZpgwXq.zf",
      ["zpxxbh"],
      { host: "www.career.zju.edu.cn", pathPrefix: "/jyxt/sczp/zpztgl/ckZpgwXq.zf" },
      { maxItems: 1, maxPages: 1, maxRequests: 10, minimumIntervalMs: 2000 },
    ],
    [
      "sharecapital-internships",
      "career.cuhk.edu.cn",
      "/job/view/id/467309",
      [] as string[],
      { host: "career.cuhk.edu.cn", pathPrefix: "/job/view/id/467309" },
      { maxItems: 1, maxPages: 1, maxRequests: 10, minimumIntervalMs: 2000 },
    ],
    [
      "dtl-quant-internships",
      "career.nankai.edu.cn",
      "/correcruit/content/id/116147.html",
      [] as string[],
      { host: "www.dytechlab.com", pathPrefix: "/careers" },
      { maxItems: 8, maxPages: 1, maxRequests: 10, minimumIntervalMs: 2000 },
    ],
    [
      "unity-drive-internships",
      "career.nankai.edu.cn",
      "/correcruit/content/id/115887.html",
      [] as string[],
      { host: "career.nankai.edu.cn", pathPrefix: "/correcruit/content/id/115887.html" },
      { maxItems: 3, maxPages: 3, maxRequests: 10, minimumIntervalMs: 2000 },
    ],
    [
      "triple-stone-internships",
      "career.nankai.edu.cn",
      "/correcruit/content/id/116046.html",
      [] as string[],
      { host: "career.nankai.edu.cn", pathPrefix: "/correcruit/content/id/116046.html" },
      { maxItems: 1, maxPages: 1, maxRequests: 10, minimumIntervalMs: 2000 },
    ],
  ] as const)(
    "limits %s to its frozen university detail pages",
    async (sourceKey, fetchHost, firstFetchPath, queryParameters, applyTarget, budget) => {
      const config = await loadSourceConfig(sourceKey);
      const expectedPolicyVersion =
        sourceKey === "kunlunxin-internships" || sourceKey === "dtl-quant-internships" ? 3 : 2;
      expect(config.policy.version).toBe(expectedPolicyVersion);
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

  it("keeps ByteDance browser snapshots manual, internship-only and unable to live probe", async () => {
    const config = await loadSourceConfig("bytedance-campus-manual");
    expect(config.candidate.acquisitionMode).toBe("browser_required");
    expect(config.localProbe.enabled).toBe(false);
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
    const fixtureDirectory = fileURLToPath(
      new URL("../../../../fixtures/source-configs/", import.meta.url),
    );
    const fixture = JSON.parse(
      await readFile(path.join(fixtureDirectory, "official-account-test.json"), "utf8"),
    ) as {
      sourceType: string;
      policy: { adapterKey: string };
      localProbe: { enabled: boolean };
    };
    fixture.sourceType = "organization_career_site";
    fixture.policy.adapterKey = "tencent-public-api";
    fixture.localProbe.enabled = true;
    expect(() => parseSourceConfigValue(fixture)).toThrow(
      "browser_required sources cannot enable network probing",
    );
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
      },
      localProbe: { enabled: false },
    });
  });
});
