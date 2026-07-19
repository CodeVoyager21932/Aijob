import { describe, expect, it } from "vitest";
import {
  controlledLocalSourceKeys,
  officialSourceAdapterVersions,
} from "./official-source-adapters.js";
import { assessSource, loadSourceConfig } from "./source-config.js";
import { TENCENT_ADAPTER_VERSION } from "./tencent-campus-adapter.js";

describe("Tencent source configuration", () => {
  it("keeps a policy-failed source in local-probe-only status", async () => {
    const config = await loadSourceConfig("tencent-campus");
    const assessment = assessSource(config);

    expect(config.sourceType).toBe("organization_career_site");
    expect(config.policy.status).toBe("pending_review");
    expect(config.policy.adapterVersion).toBe(TENCENT_ADAPTER_VERSION);
    expect(config.candidate.hardGates.accessPolicyAccepted).toBe(false);
    expect(config.localProbe.maxItems).toBe(20);
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
  it.each(controlledLocalSourceKeys)("keeps %s pending and local-only", async (sourceKey) => {
    const config = await loadSourceConfig(sourceKey);
    const assessment = assessSource(config);

    expect(config.sourceKey).toBe(sourceKey);
    expect(config.policy.status).toBe("pending_review");
    expect(config.policy.adapterKey).toBe(sourceKey);
    expect(config.policy.adapterVersion).toBe(officialSourceAdapterVersions[sourceKey]);
    expect(config.localProbe.enabled).toBe(true);
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
});
