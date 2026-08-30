import { z } from "zod";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";
import {
  known,
  type NormalizedOfficialJob,
  semanticRevisionValue,
  unknown,
} from "./normalized-official-job.js";
import { scopeOfficialDutyText } from "./official-job-body-scope.js";

export const BEISEN_ZHIYE_ADAPTER_VERSION = "0.1.3";
export const BEISEN_ZHIYE_NORMALIZER_VERSION = "0.1.3";

/**
 * 北森智业（zhiye.com）招聘门户共享适配器。
 *
 * 每个企业租户使用独立子域名和固定的 PortalId；PortalId 内嵌于门户入口 HTML 的
 * 站点配置中，在结构核验时人工读取并冻结在这里。Category 是官方业务类型：
 * "1"=社会招聘、"2"=校园招聘、"3"=实习。列表接口在请求体带 DisplayFields
 * （必须含 LocId 才会填充 LocNames）时一次返回职责、要求、城市与发布时间，
 * 因此探测不需要逐岗详情请求。
 *
 * 官方逐岗详情深链（/campus/detail、/intern/detail?jobAdId=N）在 2026-07-26
 * 的三家租户实测中均因官方 GetJobAdInfo 接口返回“参数错误”而无法直接打开；
 * 官方交互是在职位列表页内联展示详情并投递，因此申请链接指向租户职位列表页。
 */
export interface BeisenZhiyeTenant {
  sourceKey: string;
  companyName: string;
  host: string;
  portalId: string;
  category: "1" | "2" | "3";
  categoryLabel: string;
  jobsPagePath: "/campus/jobs" | "/intern/jobs";
  reportedTotalKey: string;
}

export const BeisenZhiyeAdapterOptionsSchema = z
  .object({
    category: z.enum(["1", "2", "3"]),
    pageIndex: z.number().int().nonnegative(),
    pageSize: z.number().int().min(1).max(100),
    portalId: z.string().uuid().optional(),
    jobsPagePath: z.enum(["/campus/jobs", "/intern/jobs"]).optional(),
    companyDisplayName: z.string().trim().min(1).optional(),
    categoryLabel: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((options, context) => {
    if (Boolean(options.portalId) !== Boolean(options.jobsPagePath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "portalId and jobsPagePath must be configured together",
      });
    }
  });

interface ConfiguredBeisenSource {
  sourceKey: string;
  organization: { name: string };
  policy: {
    adapterOptions: Record<string, unknown>;
    entrypoints: string[];
  };
}

const beisenZhiyeTenantList: BeisenZhiyeTenant[] = [
  {
    sourceKey: "huice-campus-internships",
    companyName: "慧策",
    host: "huicecom.zhiye.com",
    portalId: "28997adc-b9fc-471b-a080-afb251781603",
    category: "2",
    categoryLabel: "校园招聘",
    jobsPagePath: "/campus/jobs",
    reportedTotalKey: "campus-jobads",
  },
  {
    sourceKey: "adaps-photonics-internships",
    companyName: "灵明光子",
    host: "adaps-ph.zhiye.com",
    portalId: "03fe4eee-30f3-47b4-a9e5-89ef3b6b4871",
    category: "3",
    categoryLabel: "实习",
    jobsPagePath: "/intern/jobs",
    reportedTotalKey: "intern-jobads",
  },
  {
    sourceKey: "pudutech-internships",
    companyName: "普渡机器人",
    host: "pudutech.zhiye.com",
    portalId: "01fb2482-2cdb-41ee-8ec2-dabe83de23e3",
    category: "3",
    categoryLabel: "实习",
    jobsPagePath: "/intern/jobs",
    reportedTotalKey: "intern-jobads",
  },
  {
    sourceKey: "shining3d-internships",
    companyName: "先临三维",
    host: "shining3d.zhiye.com",
    portalId: "957a969f-e192-4ab2-ae07-44c35064f1ab",
    category: "3",
    categoryLabel: "实习",
    jobsPagePath: "/intern/jobs",
    reportedTotalKey: "intern-jobads",
  },
  {
    sourceKey: "onerobotics-internships",
    companyName: "卧安机器人",
    host: "woanhome.zhiye.com",
    portalId: "8db50333-7ab7-4960-8f87-ddd9468f4766",
    category: "3",
    categoryLabel: "实习",
    jobsPagePath: "/intern/jobs",
    reportedTotalKey: "intern-jobads",
  },
];

export const BEISEN_ZHIYE_DISPLAY_FIELDS = [
  "JobAdName",
  "Duty",
  "Require",
  "Kind",
  "LocId",
  "LocNames",
  "PostDate",
  "EndTime",
  "ChangeDate",
] as const;

export function resolveBeisenZhiyeTenant(
  input: string | ConfiguredBeisenSource,
): BeisenZhiyeTenant {
  const sourceKey = typeof input === "string" ? input : input.sourceKey;
  if (typeof input !== "string") {
    const options = BeisenZhiyeAdapterOptionsSchema.parse(input.policy.adapterOptions);
    if (options.portalId && options.jobsPagePath) {
      const entrypoint = input.policy.entrypoints[0];
      if (!entrypoint) throw new Error("BEISEN_ENTRYPOINT_NOT_CONFIGURED");
      return {
        sourceKey,
        companyName: options.companyDisplayName ?? input.organization.name,
        host: new URL(entrypoint).hostname,
        portalId: options.portalId,
        category: options.category,
        categoryLabel:
          options.categoryLabel ??
          (options.category === "3"
            ? "实习"
            : options.category === "2"
              ? "校园招聘"
              : "社会招聘"),
        jobsPagePath: options.jobsPagePath,
        reportedTotalKey:
          options.jobsPagePath === "/intern/jobs" ? "intern-jobads" : "campus-jobads",
      };
    }
  }
  const tenant = beisenZhiyeTenantList.find((entry) => entry.sourceKey === sourceKey);
  if (!tenant) throw new Error("BEISEN_TENANT_NOT_CONFIGURED");
  return tenant;
}

export function listBeisenZhiyeTenants(): readonly BeisenZhiyeTenant[] {
  return beisenZhiyeTenantList;
}

export function buildBeisenZhiyeListUrl(tenant: BeisenZhiyeTenant): string {
  return `https://${tenant.host}/api/Jobad/GetJobAdPageList`;
}

export function buildBeisenZhiyeListRequest(input: {
  tenant: BeisenZhiyeTenant;
  pageIndex: number;
  pageSize: number;
}): Record<string, unknown> {
  return {
    // 官方门户前端使用 0 起分页。
    PageIndex: z.number().int().nonnegative().parse(input.pageIndex),
    PageSize: z.number().int().min(1).max(30).parse(input.pageSize),
    KeyWords: "",
    SpecialType: 0,
    PortalId: input.tenant.portalId,
    Category: input.tenant.category,
    // 不带 DisplayFields 时服务端只回最小字段集；必须含 LocId 才会填充 LocNames。
    DisplayFields: [...BEISEN_ZHIYE_DISPLAY_FIELDS],
  };
}

const beisenJobAdSchema = z
  .object({
    JobAdId: z.number().int().positive(),
    JobAdName: z.string().trim().min(1),
    CategoryId: z.string().trim().nullish(),
    Kind: z.string().trim().nullish(),
    LocNames: z
      .array(z.string())
      .nullish()
      .transform((value) => value ?? []),
    Duty: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    Require: z
      .string()
      .nullish()
      .transform((value) => value ?? ""),
    PostDate: z.string().nullish(),
    ChangeDate: z.string().nullish(),
    EndTime: z.string().nullish(),
    Status: z.number().int().nullish(),
  })
  .passthrough();

const beisenListResponseSchema = z
  .object({
    Code: z.literal(200),
    Count: z.number().int().nonnegative(),
    Data: z.array(beisenJobAdSchema),
  })
  .passthrough();

export type BeisenJobAd = z.infer<typeof beisenJobAdSchema>;

export interface BeisenZhiyeListPage {
  jobs: BeisenJobAd[];
  total: number;
}

export function parseBeisenZhiyeListPage(value: unknown): BeisenZhiyeListPage {
  const parsed = beisenListResponseSchema.parse(value);
  if (parsed.Data.length > parsed.Count) {
    throw new Error("BEISEN_LIST_COUNT_INCONSISTENT");
  }
  if (new Set(parsed.Data.map((job) => job.JobAdId)).size !== parsed.Data.length) {
    throw new Error("BEISEN_DUPLICATE_JOBAD_ID");
  }
  return { jobs: parsed.Data, total: parsed.Count };
}

/**
 * ADR-0035 第一条：保留为**观察函数**，不再作为准入过滤器。
 *
 * 供给单位已从「实习岗位」改为「在校生可投岗位」，校招、应届生与管培生同样纳入。标题是否
 * 含「实习」字样只是一个粗糙代理，判定改由资格层的 `catalog.job_reachability_verdict`
 * 逐岗位完成——适配器只负责忠实解析，不负责裁剪供给范围。
 */
export function isBeisenExplicitInternship(job: BeisenJobAd): boolean {
  return job.JobAdName.normalize("NFKC").includes("实习");
}

export function buildBeisenZhiyeApplyUrl(tenant: BeisenZhiyeTenant): string {
  // 逐岗深链在官方侧不可用（GetJobAdInfo 参数错误），官方交互是列表页内联详情+投递。
  return `https://${tenant.host}${tenant.jobsPagePath}`;
}

function captureMinimum(value: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

const unsetBeisenDate = /^(?:0001-01-01|2222-02-02)/;

function beisenDateOnly(value: string | null | undefined): string | undefined {
  if (!value || unsetBeisenDate.test(value)) return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T/);
  return match?.[1];
}

// 官方地区名形如“广东省·深圳市”或“北京市”；取最末一级并去掉行政后缀“市”。
export function normalizeBeisenLocation(value: string): string {
  const segments = value
    .normalize("NFKC")
    .split("·")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const last = segments.at(-1) ?? "";
  return last.length > 2 && last.endsWith("市") ? last.slice(0, -1) : last;
}

export function normalizeBeisenZhiyeJobAd(input: {
  tenant: BeisenZhiyeTenant;
  job: BeisenJobAd;
  listItemIndex: number;
  pageEvidenceRef: string;
}): NormalizedOfficialJob {
  const { tenant, job, listItemIndex, pageEvidenceRef } = input;
  // ADR-0035 第一条：此处原有 `BEISEN_NOT_EXPLICIT_INTERNSHIP`，标题不含「实习」即整条丢弃。
  // 慧策租户请求的是 category="2"（校园招聘），抓回来后被这条过滤全部拒绝——校招岗位被
  // 取回后被扔掉了，而目标用户临近毕业时校招才是主场。筛选已上移到资格层。
  const pointer = `/Data/${listItemIndex}`;
  const family = classifyOfficialJobFamily({
    title: job.JobAdName,
    sourceLabels: [],
    sourceEvidenceRef: pageEvidenceRef,
    titleEvidenceRef: pageEvidenceRef,
  });
  const locations = [...new Set(job.LocNames.map(normalizeBeisenLocation).filter(Boolean))];
  const requirementText = job.Require.trim();
  const publishedAt = beisenDateOnly(job.PostDate);
  const durationMonths = captureMinimum(requirementText, [
    /(?:至少|不少于|连续实习)\s*(\d+)\s*个?月/u,
    /(\d+)\s*个?月(?:以上|及以上)/u,
  ]);
  const weeklyAttendanceDays = captureMinimum(requirementText, [
    /每周(?:至少|不少于|可实习|到岗)?\s*(\d+)\s*天/u,
    /一周(?:至少|不少于|可实习|到岗)?\s*(\d+)\s*天/u,
  ]);
  const deadline = beisenDateOnly(job.EndTime);
  const applyUrl = buildBeisenZhiyeApplyUrl(tenant);
  const qualityFlags: NormalizedOfficialJob["qualityFlags"] = [];
  const reviewReasons: NormalizedOfficialJob["reviewReasons"] = [
    { code: "SOURCE_POLICY_PENDING", details: { source: tenant.sourceKey } },
  ];
  if (family.requiresManualReview) {
    qualityFlags.push({ code: "JOB_FAMILY_REVIEW_REQUIRED", detail: job.JobAdName });
    reviewReasons.push({
      code: "JOB_FAMILY_REVIEW_REQUIRED",
      details: { title: job.JobAdName },
    });
  }
  const kind = job.Kind?.normalize("NFKC").trim();
  if (kind && kind !== "实习") {
    // 官方 `Kind` 不是「实习」仍然**记录**，但不再产出 `SOURCE_KIND_CONFLICT` 复核项。
    //
    // 该复核项属 `BLOCKING_REVIEW_OPEN`，连本机 `local_mvp` 都进不去。它原本表达「标题说实习、
    // 官方字段说全职，需要人工确认这条是否在范围内」——在供给单位是「实习」时成立。ADR-0035
    // 把单位改为「在校生可投岗位」后全职校招本身在范围内，`Kind` 不再决定准入。实测代价：
    // 慧策租户请求 category="2"（校园招聘），30 条历史岗位 29 条命中该项，来源随之被暂停。
    qualityFlags.push({ code: "OFFICIAL_EMPLOYMENT_TYPE_NOT_INTERNSHIP", detail: kind });
  }
  for (const [field, value] of [
    ["responsibilities", job.Duty],
    ["requirements", job.Require],
  ] as const) {
    if (!value.trim()) qualityFlags.push({ code: "SOURCE_FIELD_EMPTY", detail: field });
  }
  if (locations.length === 0) {
    qualityFlags.push({ code: "SOURCE_FIELD_EMPTY", detail: "locations" });
  }

  const normalizedWithoutHash = {
    sourceJobId: String(job.JobAdId),
    companyName: tenant.companyName,
    title: job.JobAdName,
    jobFamily: family.value,
    locations: locations.length > 0 ? known(locations, [pageEvidenceRef]) : unknown<string[]>(),
    businessGroups: [],
    entryScope: "实习生",
    sourceProjectName: null,
    recruitLabelName: tenant.categoryLabel,
    recruitmentType: known(tenant.categoryLabel, [pageEvidenceRef]),
    // 部分租户把公司简介与福利文案塞进 Duty 字段，按 ADR-0033 的 D1 裁剪到职责范围。
    responsibilities: scopeOfficialDutyText(job.Duty),
    requirements: requirementText,
    structuredFields: {
      arrivalTime: unknown<string>(),
      weeklyAttendanceDays:
        weeklyAttendanceDays === undefined
          ? unknown<number>()
          : known(weeklyAttendanceDays, [pageEvidenceRef]),
      durationMonths:
        durationMonths === undefined ? unknown<number>() : known(durationMonths, [pageEvidenceRef]),
      graduationYears: unknown<number[]>(),
      recruitmentBatch: known(tenant.categoryLabel, [pageEvidenceRef]),
      publishedAt:
        publishedAt === undefined ? unknown<string>() : known(publishedAt, [pageEvidenceRef]),
      deadline: deadline === undefined ? unknown<string>() : known(deadline, [pageEvidenceRef]),
    },
    ingestionState: "validated" as const,
    publicationState: "review" as const,
    activityState: "active" as const,
    sourceUrl: applyUrl,
    applyUrl,
    qualityFlags,
    reviewReasons,
  };
  const evidenceFields: Array<[string, string, string]> = [
    ["title", `${pointer}/JobAdName`, job.JobAdName],
    ["locations", `${pointer}/LocNames`, job.LocNames.join(",")],
    ["recruitmentType", `${pointer}/CategoryId`, job.CategoryId ?? ""],
    ["responsibilities", `${pointer}/Duty`, job.Duty],
    ["requirements", `${pointer}/Require`, job.Require],
    ["publishedAt", `${pointer}/PostDate`, job.PostDate ?? ""],
    ["deadline", `${pointer}/EndTime`, job.EndTime ?? ""],
    ["applyUrl", `${pointer}/JobAdId`, String(job.JobAdId)],
  ];
  const evidence: NormalizedOfficialJob["evidence"] = evidenceFields.map(
    ([fieldName, jsonPointer, rawValue]) => ({
      role: "list" as const,
      fieldName,
      jsonPointer,
      rawValueHash: sha256(rawValue),
    }),
  );

  return {
    ...normalizedWithoutHash,
    revisionContentHash: hashCanonicalJson({
      normalized: semanticRevisionValue(normalizedWithoutHash),
      adapterVersion: BEISEN_ZHIYE_ADAPTER_VERSION,
      normalizerVersion: BEISEN_ZHIYE_NORMALIZER_VERSION,
    }),
    evidence,
  };
}
