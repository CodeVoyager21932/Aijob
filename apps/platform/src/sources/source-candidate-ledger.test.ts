import { describe, expect, it } from "vitest";
import {
  loadSourceCandidateLedgerRows,
  mergeSourceCandidateEvidence,
  normalizeCandidateCompanyName,
  parseSourceCandidateLedger,
} from "./source-candidate-ledger.js";

describe("source candidate evidence ledgers", () => {
  it("normalizes both supported CSV shapes without losing quoted notes", () => {
    const universe = parseSourceCandidateLedger(
      [
        "candidate_id,company_name,evidence_url,close_date,internship_signal,application_signal,review_state,last_reviewed,notes",
        'ICU-1,示例公司,https://example.com/jobs,rolling,active_explicit,official_url,checked,2026-08-02,"职责完整, 要求完整"',
      ].join("\n"),
      "universe.csv",
    );
    const staged = parseSourceCandidateLedger(
      [
        "staging_id,company_name,priority_tracks,evidence_url,close_date,activity_state,application_signal,review_state,last_reviewed,notes",
        "PT-1,另一家公司,product_operations|electronic_information_technology,https://example.org/jobs,2026-12-31,active_needs_recheck,company_email,checked,2026-08-02,待复核",
      ].join("\n"),
      "staged.csv",
    );

    expect(universe[0]).toMatchObject({
      candidateId: "ICU-1",
      activityState: "active_explicit",
      notes: "职责完整, 要求完整",
    });
    expect(staged[0]).toMatchObject({
      candidateId: "PT-1",
      activityState: "active_needs_recheck",
      priorityTracks: ["product_operations", "electronic_information_technology"],
    });
  });

  it("loads the complete thousand-company universe with the audited activity totals", async () => {
    const rows = await loadSourceCandidateLedgerRows();
    const activityCounts = Object.fromEntries(
      [...new Set(rows.map((row) => row.activityState))].map((state) => [
        state,
        rows.filter((row) => row.activityState === state).length,
      ]),
    );
    const officialActive = rows.filter(
      (row) =>
        ["active_explicit", "active_needs_recheck"].includes(row.activityState) &&
        ["official_url", "company_email", "official_url_and_email"].includes(
          row.applicationSignal,
        ),
    );

    expect(rows).toHaveLength(1_000);
    expect(new Set(rows.map((row) => row.candidateId))).toHaveLength(1_000);
    expect(activityCounts).toEqual({
      active_explicit: 112,
      active_needs_recheck: 227,
      discovery_only: 362,
      expired: 297,
      non_job_program: 2,
    });
    expect(officialActive).toHaveLength(96);
  });

  it("only merges companies through exact normalized names or explicit aliases", () => {
    const rows = [
      {
        candidateId: "A",
        companyName: "万境千寻",
        activityState: "active_explicit" as const,
        applicationSignal: "official_url" as const,
        evidenceUrl: "https://example.com/a",
        closeDate: "rolling",
        reviewState: "checked",
        lastReviewed: "2026-08-02",
        notes: "",
        priorityTracks: [],
        sourceLedger: "a.csv",
      },
      {
        candidateId: "B",
        companyName: "千寻智能",
        activityState: "active_explicit" as const,
        applicationSignal: "official_url" as const,
        evidenceUrl: "https://example.com/b",
        closeDate: "rolling",
        reviewState: "checked",
        lastReviewed: "2026-08-02",
        notes: "",
        priorityTracks: [],
        sourceLedger: "b.csv",
      },
    ];
    const withoutAlias = mergeSourceCandidateEvidence(rows);
    const withAlias = mergeSourceCandidateEvidence(
      rows,
      new Map([[normalizeCandidateCompanyName("万境千寻"), "千寻智能"]]),
    );

    expect(withoutAlias).toHaveLength(2);
    expect(withAlias).toHaveLength(1);
    expect(withAlias[0]?.canonicalCompanyName).toBe("千寻智能");
    expect(withAlias[0]?.evidence.map((row) => row.candidateId)).toEqual(["A", "B"]);
  });
});
