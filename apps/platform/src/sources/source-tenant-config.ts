import { z } from "zod";
import {
  renderVendorTemplate,
  type VendorSourceConfig,
  vendorSourceConfigSchema,
} from "./source-vendor-config.js";

/**
 * ADR-0034 第三条的租户层。
 *
 * 一个租户配置只写**逐企业事实**：租户标识与路径变体、组织身份、两道租户级硬门，以及运营状态。
 * 服务条款结论、robots 主机模型、请求预算、适配器版本、URL 形状全部来自厂商层。
 *
 * 展开后走的是与既有完整配置**同一条** `rawSourceConfigSchema` 与同一个 transform，因此下游
 * 消费者（`source-registry`、`probe`、`collector-worker`）完全不需要知道配置是哪种形状写的。
 * 这也让「两层形式不丢信息」成为可证命题：展开结果与既有完整配置逐字段相等即可。
 */

const tenantAssessedGateSchema = z.object({
  status: z.enum(["pass", "pending", "fail"]),
  note: z.string().min(1),
});

const tenantScoredValueSchema = z.object({
  weight: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  status: z.string().min(1),
  note: z.string().min(1),
});

export const tenantSourceConfigSchema = z
  .object({
    schemaVersion: z.literal("tenant-1.0.0"),
    /** 引用 `config/source-vendors/<vendor>.json`。 */
    vendor: z.string().regex(/^[a-z0-9-]+$/),
    sourceKey: z.string().regex(/^[a-z0-9-]+$/),
    /**
     * 租户标识与路径变体，用于渲染厂商层的 URL 与请求模板。
     *
     * 北森族实测只需 4 个：`tenant`（子域）、`category`、`entryPath`、`applyPath`。
     */
    tenantParameters: z.record(z.string().min(1)),
    organization: z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      officialDomain: z.string().min(1),
      scale: z.unknown().optional(),
    }),
    candidate: z.object({
      name: z.string().min(1),
      /** 入口 URL；省略则由厂商层的 apply 模板渲染。 */
      entrypointUrl: z.string().url().optional(),
      assessor: z.string().min(1),
      /**
       * 租户级硬门。只有这三道逐企业评：
       * - `officialIdentity`：企业自有站点指向该租户页，或 ICP 主体一致
       * - `targetSupply`：当前是否在招实习
       * - `stableIdentityAndFields`：该租户的标识与字段是否经连续运行验证
       *
       * 其余三道由厂商层继承。逐租户子域厂商的 robots 判定另由访问政策证据承载。
       */
      gates: z
        .object({
          officialIdentity: tenantAssessedGateSchema,
          targetSupply: tenantAssessedGateSchema,
          stableIdentityAndFields: tenantAssessedGateSchema,
        })
        .strict(),
      /** 租户级评分。结构与访问政策由厂商层继承。 */
      scores: z
        .object({
          targetSupply: tenantScoredValueSchema,
          freshnessMaintenance: tenantScoredValueSchema,
          diversity: tenantScoredValueSchema,
        })
        .strict(),
      evidenceNotes: z.array(z.string().min(1)).min(1),
    }),
    policy: z
      .object({
        version: z.string().regex(/^\d+$/),
        status: z.enum(["pending_review", "approved", "paused", "blocked", "retired"]),
        reviewedAt: z.string().date(),
        crawlIntervalEnabled: z.boolean(),
        /** 追加在厂商层政策说明之后的租户个案说明。 */
        policyNotes: z.array(z.string().min(1)).default([]),
        accessPolicyEvidence: z.unknown().optional(),
      })
      .strict(),
    /** 选择厂商声明的准入画像；省略即用厂商默认画像。 */
    profile: z.string().min(1).optional(),
    /** 个案覆盖。刻意只留运行开关——四个共变字段已由 `profile` 承载。 */
    overrides: z
      .object({
        catalogRole: z.enum(["canonical", "discovery_only", "disabled"]).optional(),
        runtimeScope: z.enum(["test", "local", "alpha", "production"]).optional(),
        localProbeEnabled: z.boolean().optional(),
      })
      .strict()
      .default({}),
    /** 探针查询流。省略时由租户名生成单条全量流。 */
    queryStreams: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z0-9-]+$/),
          label: z.string().min(1),
          keyword: z.string().max(30).default(""),
          positionFamilyIds: z.array(z.union([z.string(), z.number()])).default([]),
          targetItems: z.number().int().positive(),
        }),
      )
      .min(1),
  })
  .strict();

export type TenantSourceConfig = z.infer<typeof tenantSourceConfigSchema>;

/** 输入是否为两层形式的租户配置。 */
export function isTenantSourceConfigShape(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === "tenant-1.0.0"
  );
}

function renderTarget(
  template: VendorSourceConfig["fetchTargets"][number],
  parameters: Readonly<Record<string, string>>,
) {
  const host = renderVendorTemplate(template.hostTemplate, parameters);
  const pathPrefix = renderVendorTemplate(template.pathTemplate, parameters);
  // 渲染后才校验：模板允许是占位符，渲染结果必须是绝对路径且主机不留占位符。
  if (!pathPrefix.startsWith("/")) {
    throw new Error(`VENDOR_TEMPLATE_PATH_NOT_ABSOLUTE:${pathPrefix}`);
  }
  if (host.includes("{") || pathPrefix.includes("{")) {
    throw new Error(`VENDOR_TEMPLATE_UNRESOLVED:${host}${pathPrefix}`);
  }
  return {
    method: template.method,
    scheme: "https" as const,
    host,
    port: 443,
    pathPrefix,
    allowRedirects: false,
    allowedQueryParameters: template.allowedQueryParameters,
  };
}

function renderRequestDefaults(
  defaults: Readonly<Record<string, unknown>>,
  parameters: Readonly<Record<string, string>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      typeof value === "string" ? renderVendorTemplate(value, parameters) : value,
    ]),
  );
}

/**
 * 把租户配置与厂商配置展开成既有 `rawSourceConfigSchema` 的形状。
 *
 * 刻意产出 raw 形状而不是归一化形状：归一化的 `superRefine` 边界校验（浏览器来源不得开探针、
 * 公众号来源约束、访问政策证据完整性等）必须同样作用在两层形式上，绕过它就等于给新格式开后门。
 */
export function expandTenantSourceConfig(input: {
  tenant: unknown;
  vendor: unknown;
}): Record<string, unknown> {
  const tenant = tenantSourceConfigSchema.parse(input.tenant);
  const vendor = vendorSourceConfigSchema.parse(input.vendor);
  if (tenant.vendor !== vendor.vendorKey) {
    throw new Error(`VENDOR_KEY_MISMATCH:${tenant.vendor}:${vendor.vendorKey}`);
  }

  const profileKey = tenant.profile ?? vendor.defaultProfile;
  const profile = vendor.profiles[profileKey];
  if (!profile) {
    throw new Error(`VENDOR_PROFILE_UNKNOWN:${vendor.vendorKey}:${profileKey}`);
  }

  const parameters = tenant.tenantParameters;
  const fetchTargets = vendor.fetchTargets.map((template) => renderTarget(template, parameters));
  const applyTargets = vendor.applyTargets.map((template) => renderTarget(template, parameters));
  const primaryApply = applyTargets[0];
  if (!primaryApply) throw new Error("VENDOR_APPLY_TARGET_MISSING");
  const entrypointUrl =
    tenant.candidate.entrypointUrl ?? `https://${primaryApply.host}${primaryApply.pathPrefix}`;

  const inherited = vendor.inheritedGates;
  return {
    schemaVersion: "1.0.0",
    sourceKey: tenant.sourceKey,
    sourceType: profile.sourceType,
    catalogRole: tenant.overrides.catalogRole ?? vendor.defaults.catalogRole,
    runtimeScope: tenant.overrides.runtimeScope ?? vendor.defaults.runtimeScope,
    organization: tenant.organization,
    candidate: {
      name: tenant.candidate.name,
      entrypointUrl,
      provenanceLevel: profile.provenanceLevel,
      acquisitionMode: vendor.defaults.acquisitionMode,
      candidateStatus: "local_probe_only",
      assessor: tenant.candidate.assessor,
      hardGates: {
        officialIdentity: tenant.candidate.gates.officialIdentity,
        targetSupply: tenant.candidate.gates.targetSupply,
        stableIdentityAndFields: tenant.candidate.gates.stableIdentityAndFields,
        // 厂商级结论继承。证据引用并入门槛说明，使继承来源在单份租户配置里仍然可见。
        noAuthBypass: {
          status: inherited.noAuthBypass.status,
          note: `${inherited.noAuthBypass.note}（厂商层 ${vendor.vendorKey} 评估，证据：${inherited.noAuthBypass.evidenceRefs.join("；")}）`,
        },
        officialApplyLink: {
          status: inherited.officialApplyLink.status,
          note: `${inherited.officialApplyLink.note}（厂商层 ${vendor.vendorKey} 评估，证据：${inherited.officialApplyLink.evidenceRefs.join("；")}）`,
        },
        accessPolicyAccepted: {
          status: inherited.accessPolicyAccepted.status,
          note: `${inherited.accessPolicyAccepted.note}（厂商层 ${vendor.vendorKey} 评估，证据：${inherited.accessPolicyAccepted.evidenceRefs.join("；")}）`,
        },
      },
      scores: {
        targetSupply: tenant.candidate.scores.targetSupply,
        policyAccess: vendor.inheritedScores.policyAccess,
        structure: profile.structureScore,
        freshnessMaintenance: tenant.candidate.scores.freshnessMaintenance,
        diversity: tenant.candidate.scores.diversity,
      },
      evidenceNotes: tenant.candidate.evidenceNotes,
    },
    policy: {
      version: tenant.policy.version,
      status: tenant.policy.status,
      adapterKey: vendor.adapterKey,
      adapterVersion: vendor.adapterVersion,
      entrypoints: [entrypointUrl],
      crawlInterval: {
        enabled: tenant.policy.crawlIntervalEnabled,
        minimumHours: vendor.defaults.crawlIntervalMinimumHours,
      },
      refreshCoverage: profile.refreshCoverage,
      absencePolicy: profile.absencePolicy,
      reviewedAt: tenant.policy.reviewedAt,
      policyNotes: [...vendor.policyNotes, ...tenant.policy.policyNotes],
      ...(tenant.policy.accessPolicyEvidence === undefined
        ? {}
        : { accessPolicyEvidence: tenant.policy.accessPolicyEvidence }),
      fetchTargets,
      applyTargets,
    },
    localProbe: {
      enabled: tenant.overrides.localProbeEnabled ?? true,
      environment: "local",
      requestBudget: vendor.defaults.requestBudget,
      completion: "partial",
      requestDefaults: renderRequestDefaults(vendor.requestDefaults, parameters),
      queryStreams: tenant.queryStreams,
    },
  };
}
