import { z } from "zod";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";
import {
  known,
  type NormalizedOfficialJob,
  semanticRevisionValue,
  unknown,
} from "./normalized-official-job.js";

export const OFFICIAL_ACCOUNT_MANUAL_ADAPTER_VERSION = "0.1.0";
export const OFFICIAL_ACCOUNT_MANUAL_NORMALIZER_VERSION = "0.1.0";

const applicationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("official_url"), url: z.string().url() }).strict(),
  z
    .object({
      type: z.literal("company_email"),
      email: z.string().trim().email().max(320),
      sourceText: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

const officialAccountJobSchema = z
  .object({
    sourceJobId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{1,200}$/),
    title: z.string().trim().min(1).max(300),
    locations: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    employmentScope: z.literal("实习"),
    recruitmentChannel: z.enum(["实习", "校招"]),
    jobCategory: z.string().trim().min(1).max(200),
    responsibilities: z.string().trim().min(1).max(50_000),
    requirements: z.string().trim().min(1).max(50_000),
    application: applicationSchema,
    itemIndex: z.number().int().min(0).max(99),
  })
  .strict();

const officialAccountSnapshotSchema = z
  .object({
    schemaVersion: z.literal("organization-official-account-manual-snapshot-v1"),
    captureMode: z.literal("manual-official-account-visible-content"),
    sourcePageUrl: z.string().url(),
    capturedAt: z.string().datetime({ offset: true }),
    reportedTotal: z.number().int().positive(),
    jobs: z.array(officialAccountJobSchema).min(1).max(30),
  })
  .strict();

export type OfficialAccountManualSnapshot = z.infer<typeof officialAccountSnapshotSchema>;
export type OfficialAccountManualJob = z.infer<typeof officialAccountJobSchema>;

function assertUnique(values: string[], code: string): void {
  if (new Set(values).size !== values.length) throw new Error(code);
}

export function parseOfficialAccountManualSnapshot(value: unknown): OfficialAccountManualSnapshot {
  const snapshot = officialAccountSnapshotSchema.parse(value);
  assertUnique(
    snapshot.jobs.map(({ sourceJobId }) => sourceJobId),
    "OFFICIAL_ACCOUNT_DUPLICATE_SOURCE_JOB_ID",
  );
  assertUnique(
    snapshot.jobs.map(({ itemIndex }) => String(itemIndex)),
    "OFFICIAL_ACCOUNT_DUPLICATE_ITEM_INDEX",
  );
  for (const job of snapshot.jobs) {
    assertUnique(job.locations, "OFFICIAL_ACCOUNT_DUPLICATE_LOCATION");
  }
  return snapshot;
}

function captureMinimum(value: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

function graduationYears(value: string): number[] {
  return [
    ...new Set(
      [...value.matchAll(/(20\d{2})\s*届/gu)]
        .map((match) => Number(match[1]))
        .filter(Number.isInteger),
    ),
  ];
}

function isCompanyDomainEmail(email: string, officialDomain: string): boolean {
  const domain = email.toLowerCase().split("@")[1];
  const expected = officialDomain.toLowerCase().replace(/^www\./, "");
  return Boolean(domain && (domain === expected || domain.endsWith(`.${expected}`)));
}

export function normalizeOfficialAccountManualJob(input: {
  job: OfficialAccountManualJob;
  organizationName: string;
  officialDomain: string;
  sourcePageUrl: string;
  snapshotEvidenceRef: string;
}): NormalizedOfficialJob {
  const { job, organizationName, officialDomain, sourcePageUrl, snapshotEvidenceRef } = input;
  if (job.application.type === "company_email") {
    const email = job.application.email.toLowerCase();
    if (
      !isCompanyDomainEmail(email, officialDomain) ||
      !job.application.sourceText.toLowerCase().includes(email)
    ) {
      throw new Error("OFFICIAL_ACCOUNT_COMPANY_EMAIL_UNVERIFIED");
    }
  }

  const pointer = `/jobs/${job.itemIndex}`;
  const family = classifyOfficialJobFamily({
    title: job.title,
    sourceLabels: [job.jobCategory],
    sourceEvidenceRef: snapshotEvidenceRef,
    titleEvidenceRef: snapshotEvidenceRef,
  });
  const sourceText = `${job.responsibilities}\n${job.requirements}`;
  const durationMonths = captureMinimum(sourceText, [
    /(?:至少|不少于|为期|连续实习)\s*(\d+)\s*个?月/u,
    /(\d+)\s*个?月(?:以上|及以上)/u,
  ]);
  const weeklyAttendanceDays = captureMinimum(sourceText, [
    /每周(?:至少|不少于|可实习)?\s*(\d+)\s*天/u,
    /一周(?:至少|不少于|可实习)?\s*(\d+)\s*天/u,
  ]);
  const years = graduationYears(sourceText);
  const normalizedWithoutHash = {
    sourceJobId: job.sourceJobId,
    companyName: organizationName,
    title: job.title,
    jobFamily: family.value,
    locations: known(job.locations, [snapshotEvidenceRef]),
    businessGroups: [],
    entryScope: "实习生",
    sourceProjectName: null,
    recruitLabelName: job.recruitmentChannel,
    recruitmentType: known(job.recruitmentChannel, [snapshotEvidenceRef]),
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    structuredFields: {
      arrivalTime: unknown<string>(),
      weeklyAttendanceDays:
        weeklyAttendanceDays === undefined
          ? unknown<number>()
          : known(weeklyAttendanceDays, [snapshotEvidenceRef]),
      durationMonths:
        durationMonths === undefined
          ? unknown<number>()
          : known(durationMonths, [snapshotEvidenceRef]),
      graduationYears:
        years.length === 0 ? unknown<number[]>() : known(years, [snapshotEvidenceRef]),
      recruitmentBatch: known(job.recruitmentChannel, [snapshotEvidenceRef]),
      publishedAt: unknown<string>(),
      deadline: unknown<string>(),
      ...(job.application.type === "company_email"
        ? {
            applicationEmail: job.application.email.toLowerCase(),
            applicationEmailSourceText: job.application.sourceText,
          }
        : {}),
    },
    ingestionState: "validated" as const,
    publicationState: "review" as const,
    activityState: "active" as const,
    sourceUrl: sourcePageUrl,
    applyUrl: job.application.type === "official_url" ? job.application.url : null,
    qualityFlags: [
      { code: "MANUAL_OFFICIAL_ACCOUNT_CAPTURE", detail: job.recruitmentChannel },
      ...(family.requiresManualReview
        ? [{ code: "JOB_FAMILY_REVIEW_REQUIRED", detail: job.jobCategory }]
        : []),
    ],
    reviewReasons: [
      { code: "SOURCE_POLICY_PENDING", details: { source: "organization_official_account" } },
      {
        code: "MANUAL_OFFICIAL_ACCOUNT_IMPORT_REQUIRES_REVIEW",
        details: { sourceJobId: job.sourceJobId, itemIndex: job.itemIndex },
      },
      ...(family.requiresManualReview
        ? [
            {
              code: "JOB_FAMILY_REVIEW_REQUIRED",
              details: { officialCategory: job.jobCategory, title: job.title },
            },
          ]
        : []),
    ],
  };
  const applicationValue =
    job.application.type === "official_url" ? job.application.url : job.application.email;
  const evidenceFields: Array<["list" | "detail", string, string, string]> = [
    ["list", "title", `${pointer}/title`, sha256(job.title)],
    ["list", "jobFamily", `${pointer}/jobCategory`, sha256(job.jobCategory)],
    ["list", "locations", `${pointer}/locations`, hashCanonicalJson(job.locations)],
    ["detail", "responsibilities", `${pointer}/responsibilities`, sha256(job.responsibilities)],
    ["detail", "requirements", `${pointer}/requirements`, sha256(job.requirements)],
    ["detail", "application", `${pointer}/application`, sha256(applicationValue)],
  ];

  return {
    ...normalizedWithoutHash,
    revisionContentHash: hashCanonicalJson({
      normalized: semanticRevisionValue(normalizedWithoutHash),
      adapterVersion: OFFICIAL_ACCOUNT_MANUAL_ADAPTER_VERSION,
      normalizerVersion: OFFICIAL_ACCOUNT_MANUAL_NORMALIZER_VERSION,
    }),
    evidence: evidenceFields.map(([role, fieldName, jsonPointer, rawValueHash]) => ({
      role,
      fieldName,
      jsonPointer,
      rawValueHash,
    })),
  };
}
