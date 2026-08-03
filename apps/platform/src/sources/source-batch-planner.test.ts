import { JobFamilySchema, type JobFamily } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  auditSourceBatchPlan,
  type CatalogSupplyMetrics,
  planSourceBatch,
} from "./source-batch-planner.js";
import type { SourceCandidateLedgerRow } from "./source-candidate-ledger.js";
import {
  loadSourceCandidateRegistry,
  type SourceCandidateOverride,
  TARGET_ALPHA_CITIES,
} from "./source-candidates.js";

function baseline(
  overrides: Partial<CatalogSupplyMetrics> = {},
): CatalogSupplyMetrics {
  return {
    totalSupply: 0,
    visibleJobs: 0,
    companies: 0,
    smeVisibleJobs: 0,
    smeCompanies: 0,
    manualVisibleJobs: 0,
    manualCompanies: 0,
    publicJobs: 0,
    jobFamilies: Object.fromEntries(
      JobFamilySchema.options.map((family) => [family, 0]),
    ) as Record<JobFamily, number>,
    cities: Object.fromEntries(TARGET_ALPHA_CITIES.map((city) => [city, 0])) as Record<
      (typeof TARGET_ALPHA_CITIES)[number],
      number
    >,
    companyNames: [],
    registeredOrganizationNames: [],
    ...overrides,
  };
}

function ledgerRow(
  candidateId: string,
  companyName: string,
  overrides: Partial<SourceCandidateLedgerRow> = {},
): SourceCandidateLedgerRow {
  return {
    candidateId,
    companyName,
    activityState: "active_explicit",
    applicationSignal: "official_url",
    evidenceUrl: `https://careers.example.com/jobs/${candidateId}`,
    closeDate: "rolling",
    reviewState: "application_chain_checked",
    lastReviewed: "2026-08-02",
    notes: "",
    priorityTracks: [],
    sourceLedger: "planner-test.csv",
    ...overrides,
  };
}

function approvedOverride(index: number): SourceCandidateOverride {
  return {
    companyKey: `approved-company-${index}`,
    displayName: `Approved Company ${index}`,
    aliases: [],
    assessmentStatus: "preflight_ready",
    sourceKeys: [],
    scaleBand: "small",
    scaleEvidenceRef: "https://example.com/scale-evidence",
    adapterFamily: "beisen-zhiye-public-api",
    jobFamilyHints: [],
    cityHints: [],
    alphaDisplayStatus: "approved",
    pauseReasons: [],
    assessmentEvidenceRefs: [],
    lane: "capacity",
    automationMode: "deterministic",
    capacity: {
      verifiedActiveInternships: 10,
      completeJdInternships: 10,
      verifiedAt: "2026-08-02",
      evidenceRef: "docs/evidence/capacity.md",
    },
  };
}

describe("source batch planner", () => {
  it("holds a source on the Shanghai day after its deadline", async () => {
    const registry = await loadSourceCandidateRegistry();
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry,
      ledgerRows: [
        ledgerRow("DATE-001", "Deadline Company", { closeDate: "2026-08-01" }),
      ],
      now: new Date("2026-08-02T00:01:00+08:00"),
    });

    expect(plan.candidatePool.holds.deadline_expired?.count).toBe(1);
    expect(plan.candidatePool.preflightQueue).toHaveLength(0);
  });

  it("recognizes an already registered organization through an explicit alias", async () => {
    const registry = await loadSourceCandidateRegistry();
    const plan = planSourceBatch({
      baseline: baseline({
        registeredOrganizationNames: ["北京道泰量合私募基金管理有限公司"],
      }),
      milestone: 40,
      registry,
      ledgerRows: [ledgerRow("ALIAS-001", "DTL量化")],
      now: new Date("2026-08-02T08:00:00+08:00"),
    });

    expect(plan.candidatePool.holds.already_in_catalog?.count).toBe(1);
    expect(plan.candidatePool.holds.paused).toBeUndefined();
  });

  it("uses candidate id as the stable final ordering key", async () => {
    const registry = await loadSourceCandidateRegistry();
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry,
      ledgerRows: [
        ledgerRow("ORDER-002", "Ordering Company B"),
        ledgerRow("ORDER-001", "Ordering Company A"),
      ],
      now: new Date("2026-08-02T08:00:00+08:00"),
    });

    expect(
      plan.candidatePool.preflightQueue.map((candidate) => candidate.candidateId),
    ).toEqual(["ORDER-001", "ORDER-002"]);
  });

  it("selects at most ten Alpha-approved companies", async () => {
    const registry = await loadSourceCandidateRegistry();
    const approved = Array.from({ length: 11 }, (_, index) => approvedOverride(index + 1));
    const expandedRegistry = {
      ...registry,
      reserveBatch: [...registry.reserveBatch, ...approved],
    };
    const rows = approved.map((candidate, index) =>
      ledgerRow(`APPROVED-${String(index + 1).padStart(2, "0")}`, candidate.displayName),
    );

    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      limit: 10,
      registry: expandedRegistry,
      ledgerRows: rows,
      now: new Date("2026-08-02T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected).toHaveLength(10);
    expect(() =>
      planSourceBatch({
        baseline: baseline(),
        milestone: 40,
        limit: 11,
        registry: expandedRegistry,
        ledgerRows: rows,
      }),
    ).toThrow("SOURCE_BATCH_PLAN_LIMIT_OUT_OF_RANGE");
  });

  it("keeps a configured source out until Alpha display is approved", async () => {
    const registry = await loadSourceCandidateRegistry();
    const company: SourceCandidateOverride = {
      companyKey: "configured-not-approved",
      displayName: "Configured Not Approved",
      aliases: [],
      assessmentStatus: "configured",
      sourceKeys: ["configured-not-approved-internships"],
      scaleBand: "unknown",
      scaleEvidenceRef: null,
      adapterFamily: "university-employment-detail-html",
      jobFamilyHints: [],
      cityHints: [],
      alphaDisplayStatus: "not_reviewed",
      pauseReasons: [],
      assessmentEvidenceRefs: [],
      lane: "deferred",
      automationMode: "unknown",
      capacity: null,
    };
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, company] },
      ledgerRows: [ledgerRow("ALPHA-001", company.displayName)],
      now: new Date("2026-08-02T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected).toHaveLength(0);
    expect(plan.candidatePool.preflightQueue[0]?.companyName).toBe(company.displayName);
  });

  it("queues stale activity for read-only recheck but never selects it for import", async () => {
    const registry = await loadSourceCandidateRegistry();
    const company = approvedOverride(99);
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, company] },
      ledgerRows: [
        ledgerRow("RECHECK-001", company.displayName, {
          activityState: "active_needs_recheck",
        }),
      ],
      now: new Date("2026-08-02T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected).toHaveLength(0);
    expect(plan.candidatePool.preflightQueue[0]).toMatchObject({
      candidateId: "RECHECK-001",
      activityState: "active_needs_recheck",
    });
  });

  it("computes the first feasible SME checkpoint from the actual denominator", async () => {
    const registry = await loadSourceCandidateRegistry();
    const plan = planSourceBatch({
      baseline: baseline({
        visibleJobs: 149,
        companies: 29,
        smeVisibleJobs: 22,
        smeCompanies: 7,
        manualVisibleJobs: 19,
        manualCompanies: 2,
      }),
      milestone: 40,
      registry,
      ledgerRows: [],
      now: new Date("2026-08-03T08:00:00+08:00"),
    });

    expect(plan.dynamicRequirements).toMatchObject({
      minimumAdditionalSmeCompaniesIfAllNewSme: 15,
      firstFeasibleCompanyCount: 44,
      minimumSmeCompaniesAtFirstFeasibleCount: 22,
      minimumAdditionalSmeVisibleJobsAtMilestone: 138,
      minimumDeterministicVisibleJobsBeforeManualExpansion: 190,
      deterministicVisibleJobs: 130,
      manualExpansionAllowed: false,
      smeRecoveryRequired: true,
    });
    expect(plan.deficits.smeCompanies).toBe(15);
    expect(plan.deficits.manualVisibleJobsOverLimit).toBe(5);
  });

  it("keeps at least seventy percent verified SME companies during recovery", async () => {
    const registry = await loadSourceCandidateRegistry();
    const sme = Array.from({ length: 7 }, (_, index) => approvedOverride(index + 1));
    const nonSme = Array.from({ length: 3 }, (_, index) => ({
      ...approvedOverride(index + 8),
      scaleBand: "unknown" as const,
      scaleEvidenceRef: null,
    }));
    const candidates = [...sme, ...nonSme];
    const plan = planSourceBatch({
      baseline: baseline({
        visibleJobs: 149,
        companies: 29,
        smeVisibleJobs: 22,
        smeCompanies: 7,
      }),
      milestone: 40,
      limit: 10,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, ...candidates] },
      ledgerRows: candidates.map((candidate, index) =>
        ledgerRow(`RECOVERY-${String(index + 1).padStart(2, "0")}`, candidate.displayName),
      ),
      now: new Date("2026-08-03T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected).toHaveLength(10);
    expect(
      plan.candidatePool.selected.filter((candidate) => candidate.scaleBand === "small"),
    ).toHaveLength(7);
    expect(plan.projected.ratios.smeCompanies).toBeGreaterThan(
      plan.dynamicRequirements.currentRatios.smeCompanies,
    );
  });

  it("holds stale and low-yield capacity evidence out of a runnable batch", async () => {
    const registry = await loadSourceCandidateRegistry();
    const stale = {
      ...approvedOverride(201),
      capacity: {
        verifiedActiveInternships: 10,
        completeJdInternships: 10,
        verifiedAt: "2026-07-20",
        evidenceRef: "docs/evidence/stale.md",
      },
    };
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, stale] },
      ledgerRows: [ledgerRow("STALE-001", stale.displayName)],
      now: new Date("2026-08-03T08:00:00+08:00"),
    });

    expect(plan.candidatePool.selected).toHaveLength(0);
    expect(plan.candidatePool.preflightQueue[0]?.readinessBlockers).toContain("capacity_stale");
  });

  it("groups zero-network audit candidates by reusable adapter family", async () => {
    const registry = await loadSourceCandidateRegistry();
    const candidates = [approvedOverride(301), approvedOverride(302)];
    const plan = planSourceBatch({
      baseline: baseline(),
      milestone: 40,
      registry: { ...registry, reserveBatch: [...registry.reserveBatch, ...candidates] },
      ledgerRows: candidates.map((candidate, index) =>
        ledgerRow(`AUDIT-${index + 1}`, candidate.displayName),
      ),
      now: new Date("2026-08-03T08:00:00+08:00"),
    });
    const audit = auditSourceBatchPlan(plan);

    expect(audit.familyGroups[0]).toMatchObject({
      adapterFamily: "beisen-zhiye-public-api",
      candidateCount: 2,
      capacityReadyCount: 2,
      verifiedSmeCount: 2,
      projectedVisibleJobs: 20,
    });
  });
});
