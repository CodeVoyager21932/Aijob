import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { getRepositoryRoot } from "./source-config.js";

const LEDGER_DIRECTORY = "docs/evidence/ingestion";
export const SOURCE_CANDIDATE_LEDGER_FILES = [
  "internship-company-universe.csv",
  "priority-track-candidates-301-400.csv",
  "regional-priority-candidates-401-500.csv",
  "priority-track-candidates-501-600.csv",
  "priority-track-candidates-601-700.csv",
  "priority-track-candidates-701-800.csv",
  "priority-track-candidates-801-900.csv",
  "priority-track-candidates-901-1000.csv",
] as const;

export const CandidateActivityStateSchema = z.enum([
  "active_explicit",
  "active_needs_recheck",
  "discovery_only",
  "expired",
  "non_job_program",
]);
export type CandidateActivityState = z.infer<typeof CandidateActivityStateSchema>;

export const CandidateApplicationSignalSchema = z.enum([
  "official_url",
  "company_email",
  "official_url_and_email",
  "university_only",
  "unknown",
  "personal_email_rejected",
]);
export type CandidateApplicationSignal = z.infer<typeof CandidateApplicationSignalSchema>;

const rawLedgerRowSchema = z
  .record(z.string())
  .superRefine((row, context) => {
    if (!(row.candidate_id || row.staging_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "missing candidate identifier" });
    }
    if (!(row.internship_signal || row.activity_state)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "missing activity state" });
    }
    if (!row.company_name) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "missing company name" });
    }
  });

export interface SourceCandidateLedgerRow {
  candidateId: string;
  companyName: string;
  activityState: CandidateActivityState;
  applicationSignal: CandidateApplicationSignal;
  evidenceUrl: string;
  closeDate: string;
  reviewState: string;
  lastReviewed: string;
  notes: string;
  priorityTracks: string[];
  sourceLedger: string;
}

export interface MergedSourceCandidateEvidence {
  canonicalCompanyName: string;
  evidence: SourceCandidateLedgerRow[];
}

export function normalizeCandidateCompanyName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").trim();
}

function normalizeLedgerRow(
  value: unknown,
  sourceLedger: string,
): SourceCandidateLedgerRow {
  const row = rawLedgerRowSchema.parse(value);
  return {
    candidateId: z.string().trim().min(1).parse(row.candidate_id || row.staging_id),
    companyName: z.string().trim().min(1).parse(row.company_name),
    activityState: CandidateActivityStateSchema.parse(
      row.internship_signal || row.activity_state,
    ),
    applicationSignal: CandidateApplicationSignalSchema.parse(row.application_signal),
    evidenceUrl: z.string().url().parse(row.evidence_url),
    closeDate: z.string().trim().min(1).parse(row.close_date),
    reviewState: z.string().trim().min(1).parse(row.review_state),
    lastReviewed: z.string().date().parse(row.last_reviewed),
    notes: row.notes?.trim() ?? "",
    priorityTracks: (row.priority_tracks ?? "")
      .split("|")
      .map((track) => track.trim())
      .filter(Boolean),
    sourceLedger,
  };
}

export function parseSourceCandidateLedger(
  contents: string,
  sourceLedger: string,
): SourceCandidateLedgerRow[] {
  const records = parse(contents, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as unknown[];
  return records.map((record) => normalizeLedgerRow(record, sourceLedger));
}

export async function loadSourceCandidateLedgerRows(
  rootDirectory = getRepositoryRoot(),
): Promise<SourceCandidateLedgerRow[]> {
  const ledgers = await Promise.all(
    SOURCE_CANDIDATE_LEDGER_FILES.map(async (fileName) => {
      const path = join(rootDirectory, LEDGER_DIRECTORY, fileName);
      return parseSourceCandidateLedger(await readFile(path, "utf8"), basename(path));
    }),
  );
  const rows = ledgers.flat();
  const identifiers = rows.map((row) => row.candidateId);
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("DUPLICATE_SOURCE_CANDIDATE_ID");
  }
  return rows;
}

export function mergeSourceCandidateEvidence(
  rows: SourceCandidateLedgerRow[],
  aliases: ReadonlyMap<string, string> = new Map(),
): MergedSourceCandidateEvidence[] {
  const grouped = new Map<string, MergedSourceCandidateEvidence>();
  for (const row of rows) {
    const normalizedName = normalizeCandidateCompanyName(row.companyName);
    const canonicalCompanyName = aliases.get(normalizedName) ?? row.companyName;
    const key = normalizeCandidateCompanyName(canonicalCompanyName);
    const existing = grouped.get(key) ?? { canonicalCompanyName, evidence: [] };
    existing.evidence.push(row);
    grouped.set(key, existing);
  }
  return [...grouped.values()]
    .map((candidate) => ({
      ...candidate,
      evidence: [...candidate.evidence].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId),
      ),
    }))
    .sort((left, right) =>
      left.canonicalCompanyName.localeCompare(right.canonicalCompanyName, "zh-CN"),
    );
}

export function hasOfficialApplicationSignal(signal: CandidateApplicationSignal): boolean {
  return (
    signal === "official_url" ||
    signal === "company_email" ||
    signal === "official_url_and_email"
  );
}

/**
 * 「还没观察到投递方式」与「确认过没有企业直达投递」是两件事。
 *
 * `unknown` 属于前者：线索来自第三方表格或高校页面，我们**还没看过**企业自己的招聘页。
 * `university_only` 与 `personal_email_rejected` 属于后者：已经看过并确认不符合 ADR-0029
 * 的投递直达要求。
 *
 * 此前两者都被 `holdReason` 排除出候选池，于是「没看过」等于「看过且不合格」——连去看一眼
 * 的机会都没有。而真正的把关在岗位层：`job_version_eligibility` 的
 * `EXACT_APPLICATION_NOT_AVAILABLE` 会拦住任何没有投递入口的岗位，候选层再拦一次
 * 不增加保护，只是阻止发现。
 */
export function isUnobservedApplicationSignal(signal: CandidateApplicationSignal): boolean {
  return signal === "unknown";
}
