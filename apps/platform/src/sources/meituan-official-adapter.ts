import { z } from "zod";
import { hashCanonicalJson, sha256 } from "../lib/canonical-json.js";
import {
  type EvidenceField,
  known,
  type NormalizedOfficialJob,
  semanticRevisionValue,
  unknown,
} from "./normalized-official-job.js";

export const MEITUAN_ADAPTER_VERSION = "0.1.1";
export const MEITUAN_NORMALIZER_VERSION = "0.1.1";

const sourceIdentifier = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .transform(String);

const meituanNamedJobSchema = z
  .object({
    jobUnionId: sourceIdentifier,
    jobName: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (!value.jobName && !value.name) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "jobName or name is required",
      });
    }
  })
  .transform((value) => ({
    ...value,
    jobName: value.jobName ?? (value.name as string),
  }));

export const meituanListItemSchema = meituanNamedJobSchema;

const meituanPageSchema = z
  .object({
    pageNo: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
    totalPage: z.number().int().nonnegative(),
  })
  .passthrough();

const meituanListPayloadSchema = z
  .object({
    list: z.array(meituanListItemSchema),
    page: meituanPageSchema,
  })
  .passthrough();

export const meituanSearchResponseSchema = z.union([
  meituanListPayloadSchema,
  z.object({ data: meituanListPayloadSchema }).passthrough(),
]);

export const meituanDetailSchema = meituanNamedJobSchema;

export const meituanDetailResponseSchema = z.union([
  meituanDetailSchema,
  z.object({ data: meituanDetailSchema }).passthrough(),
]);

export type MeituanListItem = z.infer<typeof meituanListItemSchema>;
export type MeituanDetail = z.infer<typeof meituanDetailSchema>;

export interface MeituanSearchRequest {
  page: { pageNo: number; pageSize: number };
  jobShareType: "1";
  keywords: "";
  cityList: [];
  department: [];
  jfJgList: Array<{ code: "11002"; subCode: ["1100206"] }>;
  jobType: Array<{ code: "4"; subCode: ["2", "6"] }>;
  typeCode: ["2", "6"];
  specialCode: [];
}

export function buildMeituanSearchRequest(pageNo: number, pageSize: number): MeituanSearchRequest {
  if (
    !Number.isInteger(pageNo) ||
    pageNo < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 10
  ) {
    throw new Error("INVALID_MEITUAN_PAGE");
  }
  return {
    page: { pageNo, pageSize },
    jobShareType: "1",
    keywords: "",
    cityList: [],
    department: [],
    jfJgList: [{ code: "11002", subCode: ["1100206"] }],
    jobType: [{ code: "4", subCode: ["2", "6"] }],
    typeCode: ["2", "6"],
    specialCode: [],
  };
}

export function buildMeituanDetailRequest(jobUnionId: string): {
  jobUnionId: string;
  jobShareType: "1";
} {
  if (!/^\d+$/.test(jobUnionId)) throw new Error("INVALID_MEITUAN_JOB_ID");
  return { jobUnionId, jobShareType: "1" };
}

export function buildMeituanOfficialJobUrl(jobUnionId: string): string {
  if (!/^\d+$/.test(jobUnionId)) throw new Error("INVALID_MEITUAN_JOB_ID");
  const url = new URL("https://zhaopin.meituan.com/web/position/detail");
  url.searchParams.set("jobUnionId", jobUnionId);
  url.searchParams.set("jobShareType", "1");
  return url.toString();
}

export function meituanListPayload(
  response: z.infer<typeof meituanSearchResponseSchema>,
): z.infer<typeof meituanListPayloadSchema> {
  const nested = record(response).data;
  const nestedResult = meituanListPayloadSchema.safeParse(nested);
  return nestedResult.success ? nestedResult.data : meituanListPayloadSchema.parse(response);
}

export function meituanDetailPayload(
  response: z.infer<typeof meituanDetailResponseSchema>,
): MeituanDetail {
  const nested = record(response).data;
  const nestedResult = meituanDetailSchema.safeParse(nested);
  return nestedResult.success ? nestedResult.data : meituanDetailSchema.parse(response);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(objects: unknown[], keys: string[]): string | undefined {
  for (const object of objects) {
    const values = record(object);
    for (const key of keys) {
      const value = values[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function firstTimestamp(objects: unknown[], keys: string[]): string | undefined {
  for (const object of objects) {
    const values = record(object);
    for (const key of keys) {
      const value = values[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) {
        const timestamp = new Date(value);
        if (!Number.isNaN(timestamp.getTime())) return timestamp.toISOString();
      }
    }
  }
  return undefined;
}

function stringList(objects: unknown[], keys: string[]): string[] {
  for (const object of objects) {
    const values = record(object);
    for (const key of keys) {
      const value = values[key];
      if (Array.isArray(value)) {
        const strings = value
          .flatMap((item) => {
            if (typeof item === "string") return [item.trim()];
            const nested = record(item);
            return [nested.name, nested.cityName, nested.value]
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.trim());
          })
          .filter(Boolean);
        if (strings.length > 0) return [...new Set(strings)];
      }
      if (typeof value === "string" && value.trim()) {
        return [
          ...new Set(
            value
              .split(/[、,，/]/)
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ];
      }
    }
  }
  return [];
}

function knownOrUnknown(value: string | undefined, evidenceRef: string): EvidenceField<string> {
  return value ? known(value, [evidenceRef]) : unknown<string>();
}

export function normalizeMeituanJob(input: {
  list: MeituanListItem;
  detail: MeituanDetail;
  listItemIndex: number;
  listEvidenceRef: string;
  detailEvidenceRef: string;
}): NormalizedOfficialJob {
  const { list, detail, listEvidenceRef, detailEvidenceRef } = input;
  if (list.jobUnionId !== detail.jobUnionId) throw new Error("MEITUAN_JOB_ID_MISMATCH");

  const locations = stringList(
    [detail, list],
    ["workCityNameList", "workCityList", "workCity", "cityList"],
  );
  const businessGroups = stringList(
    [detail, list],
    ["departmentName", "department", "bgName", "businessGroupName"],
  );
  const responsibilities = firstString(
    [detail, list],
    [
      "jobDuty",
      "jobDescription",
      "responsibility",
      "responsibilities",
      "jobResponsibilities",
      "description",
    ],
  );
  const requirements = firstString(
    [detail, list],
    [
      "jobRequirement",
      "jobRequirements",
      "requirements",
      "qualification",
      "jobQualification",
      "request",
    ],
  );
  const recruitmentType = firstString(
    [detail, list],
    ["jobTypeName", "recruitmentTypeName", "hiringTypeName"],
  );
  const publishedAt = firstTimestamp(
    [detail, list],
    ["refreshTime", "updateTime", "publishTime", "firstPostTime", "postedAt"],
  );
  const deadline = firstTimestamp(
    [detail, list],
    ["expiredTime", "deadline", "deadlineAt", "endTime"],
  );
  const sourceUrl = buildMeituanOfficialJobUrl(detail.jobUnionId);
  const missingFields = [
    !responsibilities && "responsibilities",
    !requirements && "requirements",
    locations.length === 0 && "locations",
  ].filter((value): value is string => Boolean(value));

  const normalizedWithoutHash = {
    sourceJobId: detail.jobUnionId,
    companyName: "美团",
    title: detail.jobName,
    jobFamily: known<"product">("product", [listEvidenceRef]),
    locations: locations.length > 0 ? known(locations, [detailEvidenceRef]) : unknown<string[]>(),
    businessGroups,
    entryScope: "转正实习 / 日常实习",
    sourceProjectName: null,
    recruitLabelName: recruitmentType ?? null,
    recruitmentType: knownOrUnknown(recruitmentType, detailEvidenceRef),
    responsibilities: responsibilities ?? "",
    requirements: requirements ?? "",
    structuredFields: {
      arrivalTime: unknown<string>(),
      weeklyAttendanceDays: unknown<number>(),
      durationMonths: unknown<number>(),
      graduationYears: unknown<number[]>(),
      recruitmentBatch: unknown<string>(),
      publishedAt: knownOrUnknown(publishedAt, detailEvidenceRef),
      deadline: knownOrUnknown(deadline, detailEvidenceRef),
    },
    ingestionState: "validated" as const,
    publicationState: "review" as const,
    activityState: "active" as const,
    sourceUrl,
    applyUrl: sourceUrl,
    qualityFlags: missingFields.map((field) => ({
      code: "SOURCE_FIELD_NOT_STATED",
      detail: field,
    })),
    reviewReasons: [
      { code: "SOURCE_POLICY_PENDING", details: { source: "meituan-official" } },
      ...(missingFields.length > 0
        ? [{ code: "SOURCE_FIELDS_MISSING", details: { fields: missingFields } }]
        : []),
    ],
  };

  const listPointer = `/data/list/${input.listItemIndex}`;
  const evidence: NormalizedOfficialJob["evidence"] = [
    {
      role: "list",
      fieldName: "sourceJobId",
      jsonPointer: `${listPointer}/jobUnionId`,
      rawValueHash: sha256(list.jobUnionId),
    },
    {
      role: "list",
      fieldName: "jobFamily",
      jsonPointer: "/request/jfJgList/0/subCode/0",
      rawValueHash: sha256("1100206"),
    },
    {
      role: "detail",
      fieldName: "title",
      jsonPointer:
        "name" in detail && typeof detail.name === "string" ? "/data/name" : "/data/jobName",
      rawValueHash: sha256(detail.jobName),
    },
  ];

  return {
    ...normalizedWithoutHash,
    revisionContentHash: hashCanonicalJson({
      normalized: semanticRevisionValue(normalizedWithoutHash),
      adapterVersion: MEITUAN_ADAPTER_VERSION,
      normalizerVersion: MEITUAN_NORMALIZER_VERSION,
    }),
    evidence,
  };
}
