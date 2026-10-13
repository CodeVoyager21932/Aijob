import { BulkCaseProgressResultSchema, type BulkCaseProgressRequest } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import type { OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { recordManualApplication, transitionApplicationCase } from "./service.js";
/** Each selected case owns its existing transaction and retry receipt. A stale case cannot undo other successes. */
export async function bulkCaseProgress(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  request: BulkCaseProgressRequest;
  idempotencyKey: string;
}) {
  const items = [];
  for (const item of input.request.items) {
    const context = {
      db: input.db,
      owner: input.owner,
      caseId: item.caseId,
      idempotencyKey: `bulk:${hashCanonicalJson({ key: input.idempotencyKey, caseId: item.caseId })}`,
    };
    try {
      const result =
        input.request.action.kind === "manual_application"
          ? await recordManualApplication({
              ...context,
              request: { expectedRevision: item.expectedRevision },
            })
          : await transitionApplicationCase({
              ...context,
              request: { ...input.request.action.request, expectedRevision: item.expectedRevision },
            });
      items.push({
        caseId: item.caseId,
        status: "succeeded" as const,
        revision: result.event.sequence,
      });
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      items.push({
        caseId: item.caseId,
        status: "failed" as const,
        code: error.code,
        message: error.message,
      });
    }
  }
  return BulkCaseProgressResultSchema.parse({ items });
}
