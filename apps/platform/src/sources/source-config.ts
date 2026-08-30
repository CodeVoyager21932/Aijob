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
// ADR-0034 第三条：两层形状的展开在独立模块，本文件只负责判别与接线。
import {
  expandTenantSourceConfig,
  isTenantSourceConfigShape,
} from "./source-tenant-config.js";
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

/**
 * ADR-0033：`accessPolicyAccepted` 记为 `pass` 必须有能支撑该结论的证据。
 * 证据缺失、robots 取不到、robots 禁止任一已登记 target、或条款禁止聚合时，
 * 该门都不得为 `pass`——判据与证据必须一致，不允许只写结论。
 */
function enforceAccessPolicyEvidence(value: unknown, context: z.RefinementCtx): void {
  // 归一化配置的 hardGates 是布尔，原始配置是 `{status,note}`。
  // 只有原始配置形态需要校验证据，因此在这里做运行时收窄而不是收紧入参类型。
  const shape = z
    .object({
      candidate: z
        .object({
          hardGates: z
            .object({ accessPolicyAccepted: z.object({ status: z.string() }).partial().optional() })
            .partial()
            .optional(),
        })
        .partial()
        .optional(),
      policy: z
        .object({ accessPolicyEvidence: z.unknown().optional() })
        .partial()
        .optional(),
    })
    .safeParse(value);
  if (!shape.success) return;

  const gate = shape.data.candidate?.hardGates?.accessPolicyAccepted?.status;
  if (gate !== "pass") return;

  const evidence = shape.data.policy?.accessPolicyEvidence as AccessPolicyEvidence | null | undefined;
  const gatePath = ["candidate", "hardGates", "accessPolicyAccepted", "status"];
  if (!evidence) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: gatePath,
      message: "accessPolicyAccepted=pass requires policy.accessPolicyEvidence (ADR-0033)",
    });
    return;
  }
  if (evidence.robots.status !== "fetched") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: gatePath,
      message: "accessPolicyAccepted=pass requires a retrieved robots.txt; unavailable fails closed",
    });
    return;
  }
  if (!evidence.robots.allowsAllFetchTargets) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: gatePath,
      message: "accessPolicyAccepted=pass requires robots to allow every registered fetch target",
    });
  }
  if (evidence.termsOfService.prohibitsAggregation) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: gatePath,
      message: "accessPolicyAccepted=pass is impossible when the terms prohibit aggregation",
    });
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
  enforceAccessPolicyEvidence(value, context);
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

/**
 * ADR-0033 的访问政策证据。`accessPolicyAccepted` 记为 `pass` 必须有此证据，
 * 且证据本身要能被复核：robots 快照哈希、ToS 条款摘录、判定结论与核验时间。
 *
 * 这些字段刻意都是**已取回结果的留证**，不含任何网络行为——抓取属触网步骤。
 */
const accessPolicyEvidenceSchema = z.object({
  /** robots.txt 的取回结果。`unavailable` 按 fail-closed 视为禁止。 */
  robots: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("fetched"),
      /** 快照正文的 sha256，用于检测 robots 是否变化。 */
      bodySha256: z.string().regex(/^[0-9a-f]{64}$/),
      /** 判定时点该 robots 是否允许全部已登记 fetchTargets。 */
      allowsAllFetchTargets: z.boolean(),
      /** robots 声明的 Crawl-delay 秒数；未声明为 null。 */
      crawlDelaySeconds: z.number().nonnegative().nullable(),
    }),
    z.object({
      status: z.literal("unavailable"),
      reason: z.enum(["not_found", "timeout", "http_error", "network_error"]),
    }),
  ]),
  /** 服务条款核验：摘录相关条款原文并给出是否存在禁止聚合条款的结论。 */
  termsOfService: z.object({
    /** 条款页面 URL；站点未提供条款时为 null。 */
    documentUrl: z.string().url().nullable(),
    /** 相关条款原文摘录。不得改写，只摘录。 */
    excerpt: z.string().trim().min(1).max(5_000),
    /** 是否存在禁止第三方抓取、复制、转载或聚合公开招聘信息的条款。 */
    prohibitsAggregation: z.boolean(),
  }),
  /** 本次访问政策核验的日期（Asia/Shanghai）。 */
  verifiedAt: z.string().date(),
  /** 人工可复核的证据引用。 */
  evidenceRef: z.string().trim().min(1),
});

export type AccessPolicyEvidence = z.infer<typeof accessPolicyEvidenceSchema>;

const refreshCoverageSchema = z.enum(["full_scope", "tracked_records", "manual_snapshot"]);
const absencePolicySchema = z.enum(["none", "close_after_two_complete_absences"]);
const catalogRoleSchema = z.enum(["canonical", "discovery_only", "disabled"]);
const runtimeScopeSchema = z.enum(["test", "local", "alpha", "production"]);


/** 硬门槛三态。`pending` 表示评估未完成，与 `fail`（评估过且不合格）是不同的事实。 */
const hardGateStatusSchema = z.enum(["pass", "pending", "fail"]);

/** 迁移 001 给 `source_candidates.candidate_status` 的 CHECK 约束，持久化只接受这五个取值。 */
const persistedCandidateStatusSchema = z.enum([
  "candidate",
  "technical_probe",
  "pilot",
  "watch",
  "rejected",
]);

/** 配置侧多一个 `local_probe_only`：本机探针阶段在准入词表里没有对应取值。 */
const candidateStatusSchema = z.enum([
  "local_probe_only",
  ...persistedCandidateStatusSchema.options,
]);

/**
 * `local_probe_only` 不在数据库 CHECK 约束内，持久化为 `technical_probe`；其余原样透传。
 *
 * 此前转换把结果硬编码为 `technical_probe` 并丢弃配置里的取值，因此配置无论写什么都无效。
 */
function persistedCandidateStatus(
  status: z.infer<typeof candidateStatusSchema>,
): z.infer<typeof persistedCandidateStatusSchema> {
  return status === "local_probe_only" ? "technical_probe" : status;
}

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
      candidateStatus: persistedCandidateStatusSchema,
      assessor: z.string().min(1),
      // 原为 `z.boolean()`，归一化时把 `pending` 与 `fail` 压成同一个 `false`，于是
      // 「还没评估」与「评估不合格」无法区分，33 个只是等运行证据的来源看起来像被否决。
      // 保留三态。
      hardGates: z.object({
        officialIdentity: hardGateStatusSchema,
        targetSupply: hardGateStatusSchema,
        noAuthBypass: hardGateStatusSchema,
        officialApplyLink: hardGateStatusSchema,
        accessPolicyAccepted: hardGateStatusSchema,
        stableIdentityAndFields: hardGateStatusSchema,
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
  status: hardGateStatusSchema,
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
      // ADR-0034 第四条：原为 `z.literal("local_probe_only")`，把过渡期状态写成类型常量，
      // 配置无法表达任何其他阶段。放宽为枚举，且转换不再丢弃它。默认值不变。
      candidateStatus: candidateStatusSchema.default("local_probe_only"),
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
      accessPolicyEvidence: accessPolicyEvidenceSchema.nullable().default(null),
      fetchTargets: z.array(targetSchema).min(1),
      applyTargets: z.array(targetSchema).min(1),
    }),
    localProbe: z.object({
      enabled: z.boolean(),
      environment: z.literal("local"),
      requestBudget: requestBudgetSchema,
      // ADR-0034 第四条：原为 `z.literal("partial")`。默认值不变。
      completion: z.enum(["partial", "complete"]).default("partial"),
      // ADR-0034 第四条：原有 `publicationAllowed: z.literal(false)` 已删除。它**全仓从未被任何
      // 代码读取**，却看起来像在把守发布。发布现由 `catalog.published_jobs.public_version_id`
      // 与资格对账表达，见 catalog/publication-reconciliation.ts。
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

/**
 * ADR-0034 第三条：接受两种输入形状。
 *
 * - 既有完整形状（`schemaVersion: "1.0.0"`）：行为逐字节不变。
 * - 两层形状（`schemaVersion: "tenant-1.0.0"`）：由 `vendorConfig` 展开后走**同一条**校验与
 *   transform。展开产出 raw 形状而不是归一化形状，因此 `superRefine` 的全部边界校验对新格式
 *   同样生效——不给新格式开后门。
 */
export function parseSourceConfigValue(
  value: unknown,
  expectedSourceKey?: string,
  vendorConfig?: unknown,
): SourceConfig {
  const source = isTenantSourceConfigShape(value)
    ? expandTenantSourceConfig({
        tenant: value,
        vendor: (() => {
          if (vendorConfig === undefined) throw new Error("VENDOR_CONFIG_REQUIRED");
          return vendorConfig;
        })(),
      })
    : value;
  const raw = rawSourceConfigSchema.parse(source);
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
      candidateStatus: persistedCandidateStatus(raw.candidate.candidateStatus),
      assessor: raw.candidate.assessor,
      hardGates: Object.fromEntries(
        Object.entries(raw.candidate.hardGates).map(([key, result]) => [key, result.status]),
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
  const parsed: unknown = JSON.parse(contents);
  if (!isTenantSourceConfigShape(parsed)) {
    return parseSourceConfigValue(parsed, sourceKey);
  }
  const vendorKey = (parsed as { vendor?: unknown }).vendor;
  if (typeof vendorKey !== "string" || !/^[a-z0-9-]+$/.test(vendorKey)) {
    throw new Error("TENANT_CONFIG_VENDOR_REFERENCE_INVALID");
  }
  const vendorContents = await readFile(
    path.join(repositoryRoot, "config", "source-vendors", `${vendorKey}.json`),
    "utf8",
  );
  return parseSourceConfigValue(parsed, sourceKey, JSON.parse(vendorContents));
}

/**
 * 评估结论。
 *
 * `assessing` 是本轮新增：此前 `pending` 与 `fail` 都被压成 `false`，两者都得出
 * `ineligible`，于是「还在等连续运行证据」和「评过且不合格」在记录里无法区分——而前者
 * 恰恰要靠先跑起来才能产出证据。未完成的流程不该被记成否决结论。
 *
 * `totalScore` 只在六硬门全过之后才参与判定，因此当 `accessPolicyAccepted` 尚未按
 * ADR-0033 重评时，分数阈值实际不构成门槛。
 */
export interface SourceAssessment {
  hardGatesPassed: boolean;
  /** 评估过且不合格的门槛。 */
  failedGates: string[];
  /** 评估未完成的门槛。不是否决。 */
  pendingGates: string[];
  totalScore: number;
  decision: "pilot" | "watch" | "reject" | "ineligible" | "assessing";
}

export function assessSource(config: SourceConfig): SourceAssessment {
  const gates = Object.entries(config.candidate.hardGates);
  const failedGates = gates.filter(([, status]) => status === "fail").map(([gate]) => gate);
  const pendingGates = gates.filter(([, status]) => status === "pending").map(([gate]) => gate);
  const hardGatesPassed = failedGates.length === 0 && pendingGates.length === 0;
  const totalScore = Object.values(config.candidate.scores).reduce(
    (total, score) => total + score,
    0,
  );
  const base = { hardGatesPassed, failedGates, pendingGates, totalScore };

  if (failedGates.length > 0) return { ...base, decision: "ineligible" };
  if (pendingGates.length > 0) return { ...base, decision: "assessing" };
  if (totalScore >= 75) return { ...base, decision: "pilot" };
  if (totalScore >= 60) return { ...base, decision: "watch" };
  return { ...base, decision: "reject" };
}
