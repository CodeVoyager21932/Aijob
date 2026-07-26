import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { officialSourceAdapterVersions } from "./official-source-adapters.js";
import { assessSource, listSourceKeys, loadSourceConfig } from "./source-config.js";
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
      "baidu-internships",
      "bytedance-campus-manual",
      "fanruan-trainee-internships",
      "huice-campus-internships",
      "jd-campus-internships",
      "meituan-official",
      "nankai-tal-2027",
      "pudutech-internships",
      "tencent-campus",
    ]);
  });

  it.each([
    ["adaps-photonics-internships", "beisen-zhiye-public-api", true],
    ["baidu-internships", "baidu-ssr-deterministic-html", true],
    ["bytedance-campus-manual", "bytedance-manual-browser-snapshot", false],
    ["fanruan-trainee-internships", "fanruan-trainee-public-api", true],
    ["huice-campus-internships", "beisen-zhiye-public-api", true],
    ["jd-campus-internships", "jd-campus-public-api", true],
    ["pudutech-internships", "beisen-zhiye-public-api", true],
    ["tencent-campus", "tencent-public-api", true],
    ["meituan-official", "meituan-public-api", true],
    ["nankai-tal-2027", "nankai-tal-deterministic-html", true],
  ] as const)("keeps %s pending and local-only", async (sourceKey, adapterKey, probeEnabled) => {
    const config = await loadSourceConfig(sourceKey);
    const assessment = assessSource(config);

    expect(config.sourceKey).toBe(sourceKey);
    expect(config.policy.status).toBe("pending_review");
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
  });

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
    ["huice-campus-internships", "huicecom.zhiye.com", "/campus/jobs"],
    ["adaps-photonics-internships", "adaps-ph.zhiye.com", "/intern/jobs"],
    ["pudutech-internships", "pudutech.zhiye.com", "/intern/jobs"],
  ] as const)(
    "limits %s to its own Beisen tenant list API and official jobs page",
    async (sourceKey, host, jobsPagePath) => {
      const config = await loadSourceConfig(sourceKey);
      expect(config.policy.version).toBe(2);
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

  it("records the evidenced large scale for Huice and keeps others unknown", async () => {
    const huice = await loadSourceConfig("huice-campus-internships");
    expect(huice.organization.scale).toMatchObject({
      band: "large",
      evidenceUrl: "https://career.nankai.edu.cn/correcruit/content/id/114173.html",
      lastVerifiedAt: "2026-07-26T00:00:00.000Z",
    });
    for (const sourceKey of [
      "fanruan-trainee-internships",
      "adaps-photonics-internships",
      "pudutech-internships",
    ] as const) {
      const config = await loadSourceConfig(sourceKey);
      expect(config.organization.scale.band).toBe("unknown");
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
