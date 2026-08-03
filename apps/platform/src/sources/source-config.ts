import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AcquisitionModeSchema,
  CompanyScaleSchema,
  ProvenanceLevelSchema,
  SourceTypeSchema,
} from "@aijob/contracts";
import { z } from "zod";
import { canonicalJson } from "../lib/canonical-json.js";
import {
  assertConfiguredAdapterDescriptor,
  parseOfficialSourceAdapterOptions,
} from "./official-source-adapters.js";

const unknownCompanyScale = {
  band: "unknown",
  evidenceUrl: null,
  evidenceText: null,
  lastVerifiedAt: null,
} as const;

const organizationSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  officialDomain: z.string().min(1),
  scale: CompanyScaleSchema.default(unknownCompanyScale),
});

function enforceOfficialAccountBoundary(
  value: {
    sourceKey: string;
    sourceType: string;
    catalogRole?: string | undefined;
    runtimeScope?: string | undefined;
    candidate: { provenanceLevel: string; acquisitionMode: string };
    policy: {
      status: string;
      adapterKey: string;
      crawlInterval: { enabled: boolean; minimumHours: number };
      refreshCoverage: "full_scope" | "tracked_records" | "manual_snapshot";
      absencePolicy: "none" | "close_after_two_complete_absences";
    };
    localProbe: { enabled: boolean };
  },
  context: z.RefinementCtx,
): void {
  if (value.sourceType !== "organization_official_account") return;
  const requirements: Array<[boolean, (string | number)[], string]> = [
    [
      value.candidate.provenanceLevel === "official_account_link",
      ["candidate", "provenanceLevel"],
      "official account sources require official_account_link provenance",
    ],
    [
      value.candidate.acquisitionMode === "browser_required",
      ["candidate", "acquisitionMode"],
      "official account sources are manual-visible-content only",
    ],
    [
      value.policy.status === "pending_review",
      ["policy", "status"],
      "official account sources must remain pending_review",
    ],
    [
      value.policy.adapterKey === "official-account-manual-snapshot",
      ["policy", "adapterKey"],
      "official account sources require the manual snapshot adapter",
    ],
    [
      !value.localProbe.enabled,
      ["localProbe", "enabled"],
      "official account sources cannot enable network probing",
    ],
  ];
  for (const [valid, path, message] of requirements) {
    if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  }
}

function enforceSourceBoundaries(
  value: Parameters<typeof enforceOfficialAccountBoundary>[0],
  context: z.RefinementCtx,
): void {
  const effectiveCatalogRole =
    value.catalogRole ??
    (value.candidate.provenanceLevel === "organization_owned" ||
    value.candidate.provenanceLevel === "verified_ats_tenant"
      ? "canonical"
      : value.candidate.provenanceLevel === "university_published" ||
          value.candidate.provenanceLevel === "official_account_link"
        ? "discovery_only"
        : "disabled");
  if (
    effectiveCatalogRole === "canonical" &&
    value.candidate.provenanceLevel !== "organization_owned" &&
    value.candidate.provenanceLevel !== "verified_ats_tenant"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["catalogRole"],
      message: "canonical catalog sources require organization_owned or verified_ats_tenant provenance",
    });
  }
  if (effectiveCatalogRole !== "canonical" && value.policy.crawlInterval.enabled) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policy", "crawlInterval", "enabled"],
      message: "discovery-only and disabled sources cannot enable automatic refresh",
    });
  }
  if (
    value.runtimeScope === "test" &&
    !value.sourceKey.endsWith("-test") &&
    !value.sourceKey.startsWith("test-")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtimeScope"],
      message: "test runtime sources require a test source key",
    });
  }
  if (
    value.candidate.acquisitionMode === "browser_required" &&
    value.policy.refreshCoverage !== "manual_snapshot"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policy", "refreshCoverage"],
      message: "browser_required sources require manual_snapshot refresh coverage",
    });
  }
  if (value.candidate.acquisitionMode === "browser_required" && value.localProbe.enabled) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["localProbe", "enabled"],
      message: "browser_required sources cannot enable network probing",
    });
  }
  if (
    value.policy.refreshCoverage === "manual_snapshot" &&
    value.policy.absencePolicy !== "none"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policy", "absencePolicy"],
      message: "manual_snapshot sources cannot close jobs from automated absence",
    });
  } else if (
    value.policy.absencePolicy === "close_after_two_complete_absences" &&
    value.policy.refreshCoverage !== "full_scope"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policy", "absencePolicy"],
      message: "only full_scope refresh coverage can close jobs from absence",
    });
  }
  if (
    ["paused", "blocked", "retired"].includes(value.policy.status) &&
    value.policy.crawlInterval.enabled &&
    value.policy.refreshCoverage !== "manual_snapshot"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policy", "crawlInterval", "enabled"],
      message: "inactive sources cannot enable deterministic network refresh",
    });
  }
  enforceOfficialAccountBoundary(value, context);
}

const allowedQueryParameterSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._~-]+$/);

const targetSchema = z
  .object({
    method: z.enum(["GET", "POST"]),
    scheme: z.literal("https"),
    host: z.string().min(1),
    port: z.literal(443),
    pathPrefix: z.string().startsWith("/"),
    allowRedirects: z.boolean().default(false),
    allowedQueryParameters: z
      .array(allowedQueryParameterSchema)
      .default([])
      .refine((parameters) => new Set(parameters).size === parameters.length, {
        message: "allowedQueryParameters must not contain duplicates",
      }),
  })
  .strict();

const normalizedQueryStreamSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  keyword: z.string().max(30),
  positionFamilyIds: z.array(z.number().int().positive()),
  targetItems: z.number().int().min(1).max(1_000),
});

const requestBudgetSchema = z
  .object({
    maxItems: z.number().int().min(1).max(1_000),
    maxPages: z.number().int().min(1).max(100),
    maxRequests: z.number().int().min(1).max(2_000),
    minimumIntervalMs: z.number().int().min(250).max(60_000),
  })
  .refine((budget) => budget.maxRequests >= budget.maxPages, {
    message: "maxRequests must be greater than or equal to maxPages",
  });

const crawlIntervalSchema = z.object({
  enabled: z.boolean(),
  minimumHours: z.number().int().positive(),
});

const refreshCoverageSchema = z.enum(["full_scope", "tracked_records", "manual_snapshot"]);
const absencePolicySchema = z.enum(["none", "close_after_two_complete_absences"]);
const catalogRoleSchema = z.enum(["canonical", "discovery_only", "disabled"]);
const runtimeScopeSchema = z.enum(["test", "local", "alpha", "production"]);

function defaultCatalogRole(provenanceLevel: z.infer<typeof ProvenanceLevelSchema>) {
  if (provenanceLevel === "organization_owned" || provenanceLevel === "verified_ats_tenant") {
    return "canonical" as const;
  }
  if (provenanceLevel === "university_published" || provenanceLevel === "official_account_link") {
    return "discovery_only" as const;
  }
  return "disabled" as const;
}

function defaultRuntimeScope(sourceKey: string) {
  return sourceKey.endsWith("-test") || sourceKey.startsWith("test-")
    ? ("test" as const)
    : ("local" as const);
}

const normalizedSourceConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceKey: z.string().regex(/^[a-z0-9-]+$/),
    sourceType: SourceTypeSchema,
    catalogRole: catalogRoleSchema,
    runtimeScope: runtimeScopeSchema,
    organization: organizationSchema,
    candidate: z.object({
      name: z.string().min(1),
      entrypointUrl: z.string().url(),
      provenanceLevel: ProvenanceLevelSchema,
      acquisitionMode: AcquisitionModeSchema,
      candidateStatus: z.enum(["candidate", "technical_probe", "pilot", "watch", "rejected"]),
      assessor: z.string().min(1),
      hardGates: z.object({
        officialIdentity: z.boolean(),
        targetSupply: z.boolean(),
        noAuthBypass: z.boolean(),
        officialApplyLink: z.boolean(),
        accessPolicyAccepted: z.boolean(),
        stableIdentityAndFields: z.boolean(),
      }),
      scores: z.object({
        targetSupply: z.number().int().min(0).max(30),
        policyAccess: z.number().int().min(0).max(25),
        structure: z.number().int().min(0).max(20),
        freshnessMaintenance: z.number().int().min(0).max(15),
        diversity: z.number().int().min(0).max(10),
      }),
      evidenceNotes: z.string().min(1),
    }),
    policy: z.object({
      version: z.number().int().positive(),
      status: z.enum(["pending_review", "approved", "paused", "blocked", "retired"]),
      adapterKey: z.string().regex(/^[a-z0-9-]+$/),
      adapterVersion: z.string().min(1),
      adapterOptions: z.record(z.unknown()),
      entrypoints: z.array(z.string().url()).min(1),
      crawlInterval: crawlIntervalSchema,
      refreshCoverage: refreshCoverageSchema,
      absencePolicy: absencePolicySchema,
      reviewedAt: z.string().datetime().nullable(),
      policyNotes: z.string().min(1),
      fetchTargets: z.array(targetSchema).min(1),
      applyTargets: z.array(targetSchema).min(1),
    }),
    localProbe: z.object({
      enabled: z.boolean(),
      requestBudget: requestBudgetSchema,
      requestDefaults: z.record(z.unknown()),
      queryStreams: z.array(normalizedQueryStreamSchema).min(1).max(50),
    }),
  })
  .superRefine(enforceSourceBoundaries);

const assessedValueSchema = z.object({
  status: z.enum(["pass", "pending", "fail"]),
  note: z.string().min(1),
});

const scoredValueSchema = z.object({
  weight: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  status: z.string().min(1),
  note: z.string().min(1),
});

const rawSourceConfigSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    sourceKey: z.string().regex(/^[a-z0-9-]+$/),
    sourceType: SourceTypeSchema,
    catalogRole: catalogRoleSchema.optional(),
    runtimeScope: runtimeScopeSchema.optional(),
    organization: organizationSchema,
    candidate: z.object({
      name: z.string().min(1),
      entrypointUrl: z.string().url(),
      provenanceLevel: ProvenanceLevelSchema,
      acquisitionMode: AcquisitionModeSchema,
      candidateStatus: z.literal("local_probe_only"),
      assessor: z.string().min(1),
      hardGates: z.object({
        officialIdentity: assessedValueSchema,
        targetSupply: assessedValueSchema,
        noAuthBypass: assessedValueSchema,
        officialApplyLink: assessedValueSchema,
        accessPolicyAccepted: assessedValueSchema,
        stableIdentityAndFields: assessedValueSchema,
      }),
      scores: z.object({
        targetSupply: scoredValueSchema,
        policyAccess: scoredValueSchema,
        structure: scoredValueSchema,
        freshnessMaintenance: scoredValueSchema,
        diversity: scoredValueSchema,
      }),
      evidenceNotes: z.array(z.string().min(1)).min(1),
    }),
    policy: z.object({
      version: z.string().regex(/^\d+$/),
      status: z.enum(["pending_review", "approved", "paused", "blocked", "retired"]),
      adapterKey: z.string().regex(/^[a-z0-9-]+$/),
      adapterVersion: z.string().min(1),
      adapterOptions: z.record(z.unknown()).optional(),
      entrypoints: z.array(z.string().url()).min(1),
      crawlInterval: crawlIntervalSchema,
      refreshCoverage: refreshCoverageSchema,
      absencePolicy: absencePolicySchema,
      reviewedAt: z.string().date(),
      policyNotes: z.array(z.string().min(1)).min(1),
      fetchTargets: z.array(targetSchema).min(1),
      applyTargets: z.array(targetSchema).min(1),
    }),
    localProbe: z.object({
      enabled: z.boolean(),
      environment: z.literal("local"),
      requestBudget: requestBudgetSchema,
      completion: z.literal("partial"),
      publicationAllowed: z.literal(false),
      requestDefaults: z.record(z.unknown()).default({}),
      queryStreams: z
        .array(
          z.object({
            key: z.string().regex(/^[a-z0-9-]+$/),
            label: z.string().min(1),
            keyword: z.string().max(30),
            positionFamilyIds: z.array(z.string().regex(/^\d+$/)).default([]),
            targetItems: z.number().int().min(1).max(1_000),
          }),
        )
        .min(1)
        .max(50),
    }),
  })
  .superRefine(enforceSourceBoundaries);

export type SourceConfig = z.infer<typeof normalizedSourceConfigSchema>;
export type SourceTarget = z.infer<typeof targetSchema>;
export type ProbeQueryStream = z.infer<typeof normalizedQueryStreamSchema>;

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const sourceConfigDirectory = path.join(repositoryRoot, "config", "sources");

export function getRepositoryRoot(): string {
  return repositoryRoot;
}

export async function listSourceKeys(): Promise<string[]> {
  const entries = await readdir(sourceConfigDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^[a-z0-9-]+\.json$/.test(entry.name))
    .map((entry) => entry.name.slice(0, -".json".length))
    .sort((left, right) => left.localeCompare(right));
}

export function parseSourceConfigValue(value: unknown, expectedSourceKey?: string): SourceConfig {
  const raw = rawSourceConfigSchema.parse(value);
  if (expectedSourceKey && raw.sourceKey !== expectedSourceKey) {
    throw new Error("SOURCE_KEY_FILENAME_MISMATCH");
  }
  const legacyAdapterOptions = parseOfficialSourceAdapterOptions(
    raw.policy.adapterKey,
    raw.localProbe.requestDefaults,
  );
  const adapterOptions = raw.policy.adapterOptions
    ? parseOfficialSourceAdapterOptions(raw.policy.adapterKey, raw.policy.adapterOptions)
    : legacyAdapterOptions;
  if (
    raw.policy.adapterOptions &&
    canonicalJson(adapterOptions) !== canonicalJson(legacyAdapterOptions)
  ) {
    throw new Error("ADAPTER_OPTIONS_REQUEST_DEFAULTS_MISMATCH");
  }
  assertConfiguredAdapterDescriptor({
    adapterKey: raw.policy.adapterKey,
    adapterVersion: raw.policy.adapterVersion,
    acquisitionMode: raw.candidate.acquisitionMode,
    adapterOptions,
  });
  return normalizedSourceConfigSchema.parse({
    schemaVersion: 1,
    sourceKey: raw.sourceKey,
    sourceType: raw.sourceType,
    catalogRole: raw.catalogRole ?? defaultCatalogRole(raw.candidate.provenanceLevel),
    runtimeScope: raw.runtimeScope ?? defaultRuntimeScope(raw.sourceKey),
    organization: raw.organization,
    candidate: {
      name: raw.candidate.name,
      entrypointUrl: raw.candidate.entrypointUrl,
      provenanceLevel: raw.candidate.provenanceLevel,
      acquisitionMode: raw.candidate.acquisitionMode,
      candidateStatus: "technical_probe",
      assessor: raw.candidate.assessor,
      hardGates: Object.fromEntries(
        Object.entries(raw.candidate.hardGates).map(([key, result]) => [
          key,
          result.status === "pass",
        ]),
      ),
      scores: Object.fromEntries(
        Object.entries(raw.candidate.scores).map(([key, result]) => [key, result.score]),
      ),
      evidenceNotes: [
        ...raw.candidate.evidenceNotes,
        ...Object.entries(raw.candidate.hardGates).map(
          ([key, result]) => `${key}=${result.status}: ${result.note}`,
        ),
        ...Object.entries(raw.candidate.scores).map(
          ([key, result]) => `${key}=${result.score}/${result.weight}: ${result.note}`,
        ),
      ].join("\n"),
    },
    policy: {
      version: Number(raw.policy.version),
      status: raw.policy.status,
      adapterKey: raw.policy.adapterKey,
      adapterVersion: raw.policy.adapterVersion,
      adapterOptions,
      entrypoints: raw.policy.entrypoints,
      crawlInterval: raw.policy.crawlInterval,
      refreshCoverage: raw.policy.refreshCoverage,
      absencePolicy: raw.policy.absencePolicy,
      reviewedAt: `${raw.policy.reviewedAt}T00:00:00.000Z`,
      policyNotes: raw.policy.policyNotes.join("\n"),
      fetchTargets: raw.policy.fetchTargets,
      applyTargets: raw.policy.applyTargets,
    },
    localProbe: {
      enabled: raw.localProbe.enabled,
      requestBudget: raw.localProbe.requestBudget,
      requestDefaults: legacyAdapterOptions,
      queryStreams: raw.localProbe.queryStreams.map((stream) => ({
        ...stream,
        positionFamilyIds: stream.positionFamilyIds.map(Number),
      })),
    },
  });
}

export async function loadSourceConfig(
  sourceKey: string,
  configDirectory = sourceConfigDirectory,
): Promise<SourceConfig> {
  if (!/^[a-z0-9-]+$/.test(sourceKey)) {
    throw new Error("INVALID_SOURCE_KEY");
  }

  const configPath = path.join(configDirectory, `${sourceKey}.json`);
  const contents = await readFile(configPath, "utf8");
  return parseSourceConfigValue(JSON.parse(contents), sourceKey);
}

export function assessSource(config: SourceConfig): {
  hardGatesPassed: boolean;
  totalScore: number;
  decision: "pilot" | "watch" | "reject" | "ineligible";
} {
  const hardGatesPassed = Object.values(config.candidate.hardGates).every(Boolean);
  const totalScore = Object.values(config.candidate.scores).reduce(
    (total, score) => total + score,
    0,
  );

  if (!hardGatesPassed) {
    return { hardGatesPassed, totalScore, decision: "ineligible" };
  }
  if (totalScore >= 75) {
    return { hardGatesPassed, totalScore, decision: "pilot" };
  }
  if (totalScore >= 60) {
    return { hardGatesPassed, totalScore, decision: "watch" };
  }
  return { hardGatesPassed, totalScore, decision: "reject" };
}
