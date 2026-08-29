import { readFile } from "node:fs/promises";
import { JobFamilySchema, MINIMUM_REACHABLE_VISIBLE_JOB_RATIO } from "@aijob/contracts";
import { z } from "zod";
import { getRepositoryRoot } from "./source-config.js";

export const TARGET_ALPHA_CITIES = [
  "北京",
  "上海",
  "深圳",
  "广州",
  "杭州",
  "成都",
  "武汉",
  "南京",
] as const;

export const AlphaTargetCitySchema = z.enum(TARGET_ALPHA_CITIES);
export type AlphaTargetCity = z.infer<typeof AlphaTargetCitySchema>;

const sourceCandidateSchema = z.object({
  companyKey: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  assessmentStatus: z.enum([
    "discovered",
    "needs_recheck",
    "preflight_ready",
    "configured",
    "paused",
    "rejected",
  ]),
  sourceKeys: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  scaleBand: z.enum(["small", "medium", "large", "unknown"]),
  scaleEvidenceRef: z.string().trim().min(1).nullable(),
  adapterFamily: z.string().regex(/^[a-z0-9-]+$/).nullable().default(null),
  jobFamilyHints: z.array(JobFamilySchema).default([]),
  cityHints: z.array(AlphaTargetCitySchema).default([]),
  alphaDisplayStatus: z
    .enum(["not_reviewed", "approved", "paused", "blocked"])
    .default("not_reviewed"),
  pauseReasons: z.array(z.string().trim().min(1)).default([]),
  assessmentEvidenceRefs: z.array(z.string().trim().min(1)).default([]),
  lane: z.enum(["capacity", "coverage", "deferred"]).default("deferred"),
  automationMode: z
    .enum(["deterministic", "browser_required", "blocked", "unknown"])
    .default("unknown"),
  capacity: z
    .object({
      verifiedActiveInternships: z.number().int().nonnegative(),
      completeJdInternships: z.number().int().nonnegative(),
      /**
       * 其中按 ADR-0032 判定为 `reachable` 的实习岗位数。候选企业尚未入库，拿不到岗位
       * 正文，因此可达性必须在容量探测时一并记录为证据。缺失即视为 0（未核验），
       * 候选不享受可达配额——与「`unknown` 不计入配额」一致，fail-closed。
       */
      reachableInternships: z.number().int().nonnegative().nullable().default(null),
      verifiedAt: z.string().date(),
      evidenceRef: z.string().trim().min(1),
    })
    .nullable()
    .default(null),
});

const jobFamilyMinimumsSchema = z.object({
  product: z.number().int().min(100),
  operations: z.number().int().min(100),
  engineering: z.number().int().min(100),
  data_ai: z.number().int().min(100),
  design: z.number().int().min(15),
  marketing: z.number().int().min(15),
  sales_business: z.number().int().min(15),
  finance: z.number().int().min(15),
  people_admin_legal: z.number().int().min(15),
  research_consulting: z.number().int().min(15),
  supply_chain_manufacturing: z.number().int().min(15),
  other: z.number().int().min(15),
});

const cityMinimumsSchema = z.object(
  Object.fromEntries(
    TARGET_ALPHA_CITIES.map((city) => [city, z.number().int().min(40)]),
  ) as Record<AlphaTargetCity, z.ZodNumber>,
);

const sourceCandidateRegistrySchema = z
  .object({
    schemaVersion: z.literal("5.0.0"),
    scope: z.literal("private_alpha_all_function_internships"),
    evidenceLevel: z.literal("E0"),
    targets: z.object({
      hardGate: z.object({
        visibleJobs: z.literal(1_000),
        companies: z.literal(100),
      }),
      operatingTarget: z.object({
        visibleJobs: z.literal(1_100),
        companies: z.literal(110),
      }),
      /**
       * ADR-0032：结构门槛由 SME 比例改为可达岗位比例。SME 两项比例已撤回，
       * `scaleBand` 保留为观察字段，不再参与门槛与排序。
       */
      minimumReachableVisibleJobRatio: z.literal(MINIMUM_REACHABLE_VISIBLE_JOB_RATIO),
      jobFamilyMinimums: jobFamilyMinimumsSchema,
      cityMinimums: cityMinimumsSchema,
      manualSourceMaximumCompanyRatio: z.literal(0.2),
      manualSourceMaximumVisibleJobRatio: z.literal(0.1),
    }),
    batchPolicy: z.object({
      maxCompanies: z.literal(10),
      familyPilotMaxCompanies: z.literal(3),
      initialJobsPerCompany: z.literal(5),
    }),
    liveProbeRequiresExplicitApproval: z.literal(true),
    companyAliases: z.array(
      z.object({
        canonicalName: z.string().trim().min(1),
        aliases: z.array(z.string().trim().min(1)).min(1),
        evidenceRef: z.string().trim().min(1),
      }),
    ),
    priorityBatch: z.array(sourceCandidateSchema).max(10),
    reserveBatch: z.array(sourceCandidateSchema).min(1),
  })
  .superRefine((registry, context) => {
    const candidates = [...registry.priorityBatch, ...registry.reserveBatch];
    const keys = candidates.map((candidate) => candidate.companyKey);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate companyKey" });
    }

    const candidateNames = candidates.flatMap((candidate) => [
      candidate.displayName,
      ...candidate.aliases,
    ]);
    if (new Set(candidateNames).size !== candidateNames.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate candidate alias" });
    }

    const sourceKeys = candidates.flatMap((candidate) => candidate.sourceKeys);
    if (new Set(sourceKeys).size !== sourceKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate candidate sourceKey" });
    }

    const aliasNames = registry.companyAliases.flatMap((group) => [
      group.canonicalName,
      ...group.aliases,
    ]);
    if (new Set(aliasNames).size !== aliasNames.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate company alias" });
    }

    for (const candidate of candidates) {
      if (candidate.scaleBand !== "unknown" && candidate.scaleEvidenceRef === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing scale evidence for ${candidate.companyKey}`,
        });
      }
      if (candidate.assessmentStatus === "discovered" && candidate.sourceKeys.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `discovered candidate cannot have source keys: ${candidate.companyKey}`,
        });
      }
      if (candidate.assessmentStatus === "configured" && candidate.sourceKeys.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `configured candidate requires a source key: ${candidate.companyKey}`,
        });
      }
      if (
        candidate.sourceKeys.length > 0 &&
        !["configured", "paused", "rejected"].includes(candidate.assessmentStatus)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `orphan source configuration: ${candidate.companyKey}`,
        });
      }
      if (
        candidate.assessmentStatus === "preflight_ready" &&
        candidate.alphaDisplayStatus !== "approved"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `preflight-ready candidate requires Alpha display approval: ${candidate.companyKey}`,
        });
      }
      if (
        candidate.capacity !== null &&
        candidate.capacity.completeJdInternships > candidate.capacity.verifiedActiveInternships
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `complete JD count exceeds active internships: ${candidate.companyKey}`,
        });
      }
      if (
        candidate.capacity !== null &&
        !candidate.assessmentEvidenceRefs.includes(candidate.capacity.evidenceRef)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `capacity evidence is not referenced: ${candidate.companyKey}`,
        });
      }
      if (candidate.lane === "capacity") {
        if (candidate.automationMode !== "deterministic") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `capacity candidate must be deterministic: ${candidate.companyKey}`,
          });
        }
        if (candidate.capacity === null || candidate.capacity.completeJdInternships < 10) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `capacity candidate requires at least ten complete internships: ${candidate.companyKey}`,
          });
        }
      }
      if (
        candidate.lane === "coverage" &&
        (candidate.capacity === null ||
          candidate.capacity.completeJdInternships < 1 ||
          candidate.capacity.completeJdInternships > 9)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `coverage candidate requires one to nine complete internships: ${candidate.companyKey}`,
        });
      }
      if (
        candidate.lane === "coverage" &&
        candidate.scaleBand !== "small" &&
        candidate.scaleBand !== "medium" &&
        candidate.jobFamilyHints.length === 0 &&
        candidate.cityHints.length === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `coverage candidate requires an SME, family or city contribution: ${candidate.companyKey}`,
        });
      }
    }
  });

export type SourceCandidateRegistry = z.infer<typeof sourceCandidateRegistrySchema>;
export type SourceCandidateOverride = SourceCandidateRegistry["priorityBatch"][number];

export function sourceCandidateOverrides(
  registry: SourceCandidateRegistry,
): SourceCandidateOverride[] {
  return [...registry.priorityBatch, ...registry.reserveBatch];
}

export function parseSourceCandidateRegistryValue(value: unknown): SourceCandidateRegistry {
  return sourceCandidateRegistrySchema.parse(value);
}

export async function loadSourceCandidateRegistry(): Promise<SourceCandidateRegistry> {
  const contents = await readFile(`${getRepositoryRoot()}/config/source-candidates.json`, "utf8");
  return parseSourceCandidateRegistryValue(JSON.parse(contents));
}
