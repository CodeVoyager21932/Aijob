import type { JobSearchQuery } from "@aijob/contracts";
import { JobSearchQuerySchema, ProblemDetailsSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { FastifyPluginAsync } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { InvalidCatalogCursorError } from "./filtering.js";
import { type CatalogRepository, createCatalogRepository } from "./repository.js";

const JobParamsSchema = z.object({
  jobId: z.string().trim().min(1),
});

type RawQuery = Record<string, unknown>;

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function stringValue(value: unknown): string | undefined {
  const candidate = first(value);
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function listValue(value: unknown): string[] | undefined {
  const source = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const values = source
    .flatMap((item) => (typeof item === "string" ? item.split(",") : []))
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function numberValue(value: unknown): number | undefined {
  const candidate = stringValue(value);
  if (candidate === undefined) return undefined;
  return Number(candidate);
}

function booleanValue(value: unknown): boolean | undefined | string {
  const candidate = stringValue(value);
  if (candidate === undefined) return undefined;
  if (candidate === "true") return true;
  if (candidate === "false") return false;
  return candidate;
}

export function parseJobSearchQuery(raw: RawQuery): JobSearchQuery {
  return JobSearchQuerySchema.parse({
    keyword: stringValue(raw.keyword),
    companies: listValue(raw.companies),
    cities: listValue(raw.cities),
    jobFamilies: listValue(raw.jobFamilies),
    recruitmentBatches: listValue(raw.recruitmentBatches),
    availableWeeklyAttendanceDays: numberValue(raw.availableWeeklyAttendanceDays),
    availableDurationMonths: numberValue(raw.availableDurationMonths),
    latestStartDate: stringValue(raw.latestStartDate),
    graduationYears: listValue(raw.graduationYears)?.map(Number),
    educationLevels: listValue(raw.educationLevels),
    majors: listValue(raw.majors),
    minimumSalary: numberValue(raw.minimumSalary),
    salaryPeriods: listValue(raw.salaryPeriods),
    workModes: listValue(raw.workModes),
    sources: listValue(raw.sources),
    sourceTypes: listValue(raw.sourceTypes),
    freshness: stringValue(raw.freshness),
    includeUnknownHardConditions: booleanValue(raw.includeUnknownHardConditions),
    cursor: stringValue(raw.cursor),
    limit: numberValue(raw.limit),
  });
}

function problem(input: {
  status: number;
  code: string;
  title: string;
  correlationId: string;
  detail: string;
  instance: string;
}) {
  return ProblemDetailsSchema.parse({
    type: `https://aijob.local/problems/${input.code.toLowerCase()}`,
    ...input,
  });
}

export interface CatalogRoutesOptions {
  db: Kysely<Database>;
  enableLocalMvp: boolean;
  repository?: CatalogRepository;
}

export const catalogRoutes: FastifyPluginAsync<CatalogRoutesOptions> = async (app, options) => {
  const repository =
    options.repository ??
    createCatalogRepository({
      db: options.db,
      enableLocalMvp: options.enableLocalMvp,
    });

  app.get("/v1/jobs", async (request, reply) => {
    const query = parseJobSearchQuery(request.query as RawQuery);
    try {
      const result = await repository.search(query);
      reply.header("Cache-Control", options.enableLocalMvp ? "no-store" : "public, max-age=60");
      return reply.send(result);
    } catch (error) {
      if (!(error instanceof InvalidCatalogCursorError)) throw error;
      return reply
        .code(400)
        .type("application/problem+json")
        .send(
          problem({
            status: 400,
            code: "INVALID_JOB_CURSOR",
            title: "岗位列表游标无效",
            detail: "请从第一页重新加载；游标不能跨筛选条件复用。",
            correlationId: request.id,
            instance: request.url,
          }),
        );
    }
  });

  app.get("/v1/jobs/:jobId", async (request, reply) => {
    const { jobId } = JobParamsSchema.parse(request.params);
    const result = await repository.get(jobId);
    if (!result) {
      return reply
        .code(404)
        .type("application/problem+json")
        .send(
          problem({
            status: 404,
            code: "JOB_NOT_FOUND",
            title: "没有找到该岗位",
            detail: "该岗位不存在，或不在当前服务端固定的目录范围内。",
            correlationId: request.id,
            instance: `/v1/jobs/${jobId}`,
          }),
        );
    }
    reply.header("Cache-Control", options.enableLocalMvp ? "no-store" : "public, max-age=60");
    return reply.send(result);
  });
};
