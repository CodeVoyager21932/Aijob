import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getRepositoryRoot } from "./source-config.js";
import {
  loadSourceCandidateRegistry,
  parseSourceCandidateRegistryValue,
  sourceCandidateOverrides,
} from "./source-candidates.js";

describe("source candidate registry", () => {
  it("locks the 100-company Alpha gate, operating buffer and bounded batches", async () => {
    const registry = await loadSourceCandidateRegistry();

    expect(registry.schemaVersion).toBe("5.0.0");
    expect(registry.scope).toBe("private_alpha_all_function_internships");
    expect(registry.targets.hardGate).toEqual({ visibleJobs: 1_000, companies: 100 });
    expect(registry.targets.operatingTarget).toEqual({ visibleJobs: 1_100, companies: 110 });
    // ADR-0032：结构门槛轴为可达岗位比例，SME 两项比例已撤回。
    expect(registry.targets.minimumReachableVisibleJobRatio).toBe(0.5);
    expect(registry.targets).not.toHaveProperty("minimumSmeCompanyRatio");
    expect(registry.targets).not.toHaveProperty("minimumSmeVisibleJobRatio");
    expect(registry.targets.manualSourceMaximumCompanyRatio).toBe(0.2);
    expect(registry.targets.manualSourceMaximumVisibleJobRatio).toBe(0.1);
    expect(registry.batchPolicy).toEqual({
      maxCompanies: 10,
      familyPilotMaxCompanies: 3,
      initialJobsPerCompany: 5,
    });
    expect(registry.liveProbeRequiresExplicitApproval).toBe(true);
    expect(registry.companyAliases).toHaveLength(5);
  });

  it("keeps scale claims evidence-backed and every current candidate Alpha-disabled", async () => {
    const candidates = sourceCandidateOverrides(await loadSourceCandidateRegistry());

    expect(
      candidates
        .filter((candidate) => candidate.scaleBand !== "unknown")
        .every((candidate) => candidate.scaleEvidenceRef !== null),
    ).toBe(true);
    expect(candidates.every((candidate) => candidate.alphaDisplayStatus === "not_reviewed")).toBe(
      true,
    );
    expect(
      candidates
        .filter((candidate) => candidate.assessmentStatus === "configured")
        .map((candidate) => candidate.companyKey),
    ).toEqual([
      "dji-paused",
      "zhaopin-wuhan",
      "guanggu-venture",
      "woolley-robot",
      "deeproute",
      "sanshiyuan",
      "hanxu-tech",
      "weride-nankai",
      "anxin-fund",
    ]);
    expect(
      candidates
        .filter((candidate) => candidate.assessmentStatus === "configured")
        .every((candidate) => candidate.sourceKeys.length === 1),
    ).toBe(true);
  });

  it("keeps the fixed 12-family and eight-city structural floors", async () => {
    const registry = await loadSourceCandidateRegistry();

    expect(Object.keys(registry.targets.jobFamilyMinimums)).toHaveLength(12);
    expect(registry.targets.jobFamilyMinimums).toMatchObject({
      product: 100,
      operations: 100,
      engineering: 100,
      data_ai: 100,
      other: 15,
    });
    expect(registry.targets.cityMinimums).toEqual({
      北京: 40,
      上海: 40,
      深圳: 40,
      广州: 40,
      杭州: 40,
      成都: 40,
      武汉: 40,
      南京: 40,
    });
  });

  it("keeps historical batch 03-06 pauses out of automatic preflight", async () => {
    const candidates = sourceCandidateOverrides(await loadSourceCandidateRegistry());
    const historicalKeys = [
      "kunlunxin-paused",
      "dtl-quant-paused",
      "flab-paused",
      "allwinner-paused",
      "qianhai-exchange-paused",
      "ruizhen-tech-paused",
      "mihoyo-paused",
      "netease-boguan-paused",
      "perfect-world-chengdu-paused",
      "ninebot-paused",
      "yonyou-paused",
      "decathlon-china-paused",
      "horizon-robotics-paused",
      "xiyue-investment-paused",
    ];
    const historical = candidates.filter((candidate) =>
      historicalKeys.includes(candidate.companyKey),
    );

    expect(historical.map((candidate) => candidate.companyKey)).toEqual(historicalKeys);
    expect(historical.every((candidate) => candidate.assessmentStatus === "paused")).toBe(true);
    expect(historical.every((candidate) => candidate.pauseReasons.length > 0)).toBe(true);
    expect(historical.every((candidate) => candidate.assessmentEvidenceRefs.length === 1)).toBe(
      true,
    );
  });

  it("normalizes every candidate onto the capacity, coverage or deferred contract", async () => {
    const candidates = sourceCandidateOverrides(await loadSourceCandidateRegistry());
    const lowYieldCoverage = candidates.filter((candidate) =>
      ["dulishuo", "tekbiotech"].includes(candidate.companyKey),
    );

    expect(candidates.every((candidate) => candidate.capacity !== undefined)).toBe(true);
    expect(lowYieldCoverage).toHaveLength(2);
    expect(
      lowYieldCoverage.every(
        (candidate) =>
          candidate.lane === "coverage" &&
          candidate.automationMode === "deterministic" &&
          candidate.sourceKeys.length === 0 &&
          candidate.capacity?.completeJdInternships === 1,
      ),
    ).toBe(true);
  });

  it("keeps every local candidate evidence reference resolvable", async () => {
    const registry = await loadSourceCandidateRegistry();
    const candidates = sourceCandidateOverrides(registry);
    const evidenceRefs = new Set([
      ...registry.companyAliases.map(({ evidenceRef }) => evidenceRef),
      ...candidates.flatMap((candidate) => [
        ...(candidate.scaleEvidenceRef ? [candidate.scaleEvidenceRef] : []),
        ...(candidate.capacity ? [candidate.capacity.evidenceRef] : []),
        ...candidate.assessmentEvidenceRefs,
      ]),
    ]);

    await Promise.all(
      [...evidenceRefs]
        .filter((evidenceRef) => evidenceRef.startsWith("docs/"))
        .map((evidenceRef) =>
          access(resolve(getRepositoryRoot(), evidenceRef.split("#", 1)[0] ?? evidenceRef)),
        ),
    );
  });

  it("rejects capacity candidates without ten complete deterministic internships", async () => {
    const registry = await loadSourceCandidateRegistry();
    const candidate = registry.reserveBatch[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("TEST_CANDIDATE_MISSING");
    const invalid = structuredClone(registry);
    invalid.reserveBatch[0] = {
      ...candidate,
      lane: "capacity",
      automationMode: "deterministic",
      capacity: {
        verifiedActiveInternships: 9,
        completeJdInternships: 9,
        reachableInternships: 9,
        verifiedAt: "2026-08-03",
        evidenceRef: "docs/evidence/invalid.md",
      },
    };

    expect(() => parseSourceCandidateRegistryValue(invalid)).toThrow(
      "capacity candidate requires at least ten complete internships",
    );
  });

  it("rejects duplicate and orphan source configuration references", async () => {
    const registry = await loadSourceCandidateRegistry();
    const configured = registry.reserveBatch.find(
      (candidate) => candidate.assessmentStatus === "configured",
    );
    const unconfigured = registry.reserveBatch.find(
      (candidate) => candidate.assessmentStatus === "needs_recheck",
    );
    expect(configured).toBeDefined();
    expect(unconfigured).toBeDefined();
    if (!configured || !unconfigured) throw new Error("TEST_CANDIDATE_MISSING");

    const duplicate = structuredClone(registry);
    duplicate.reserveBatch = duplicate.reserveBatch.map((candidate) =>
      candidate.companyKey === unconfigured.companyKey
        ? { ...candidate, assessmentStatus: "configured", sourceKeys: configured.sourceKeys }
        : candidate,
    );
    expect(() => parseSourceCandidateRegistryValue(duplicate)).toThrow(
      "duplicate candidate sourceKey",
    );

    const orphan = structuredClone(registry);
    orphan.reserveBatch = orphan.reserveBatch.map((candidate) =>
      candidate.companyKey === unconfigured.companyKey
        ? { ...candidate, sourceKeys: ["orphan-source"] }
        : candidate,
    );
    expect(() => parseSourceCandidateRegistryValue(orphan)).toThrow(
      "orphan source configuration",
    );
  });
});
