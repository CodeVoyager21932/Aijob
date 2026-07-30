import { ProblemDetailsSchema } from "@aijob/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiProblem";
  }
}

export function sendApiProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  error: Pick<ApiProblem, "status" | "code" | "title" | "detail">,
) {
  reply.type("application/problem+json");
  return reply.code(error.status).send(
    ProblemDetailsSchema.parse({
      type: `https://aijob.local/problems/${error.code.toLowerCase()}`,
      status: error.status,
      code: error.code,
      title: error.title,
      detail: error.detail,
      correlationId: request.id,
      instance: request.url,
    }),
  );
}

export function isApiProblem(error: unknown): error is ApiProblem {
  return error instanceof ApiProblem;
}
