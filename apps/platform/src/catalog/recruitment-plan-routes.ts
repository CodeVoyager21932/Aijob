import type { FastifyInstance } from "fastify";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { getJobRecruitmentPlan, getCaseRecruitmentPlan } from "./recruitment-plans.js";
export function registerRecruitmentPlanRoutes(
  app: FastifyInstance,
  input: { db: Kysely<Database>; local: boolean },
) {
  app.get("/v1/jobs/:jobId/recruitment-plan", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    return reply
      .header("Cache-Control", "no-store")
      .send(await getJobRecruitmentPlan({ ...input, jobId }));
  });
  app.get("/v1/application-cases/:caseId/recruitment-plan", async (request, reply) => {
    const { caseId } = z.object({ caseId: z.string().uuid() }).parse(request.params);
    return reply
      .header("Cache-Control", "no-store")
      .send(
        await getCaseRecruitmentPlan({ db: input.db, caseId, owner: requireOwnerContext(request) }),
      );
  });
}
