import type { Database } from "@aijob/database";
import { sql, type Transaction } from "kysely";
import type { OwnerScope } from "../identity/session-repository.js";

/** The existing practice disposition also covers the unified assistant. */
export async function disposeCaseAssistantSessions(
  tx: Transaction<Database>, owner: OwnerScope, caseId: string,
  disposition: "delete" | "detach", now: Date,
) {
  if (disposition === "delete") {
    await sql`DELETE FROM profile.assistant_turns WHERE owner_id=${owner.ownerId}
      AND session_id IN (SELECT id FROM profile.assistant_sessions
        WHERE owner_id=${owner.ownerId} AND case_id=${caseId} AND deleted_at IS NULL)`.execute(tx);
    // Retain only a tombstone for deletion replay; remove all conversational material.
    await sql`UPDATE profile.assistant_sessions SET deleted_at=${now},updated_at=${now},
      revision=revision+1,title='已删除的练习',context='{}',snapshot='{}',options='{}',document_id=NULL
      WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}
        AND case_id=${caseId} AND deleted_at IS NULL`.execute(tx);
  } else {
    // The frozen snapshot survives independently of the Case and its live resume.
    await sql`UPDATE profile.assistant_sessions SET case_id=NULL,detached_from_case_id=${caseId},
      context=context-'caseId'-'documentId'-'contentRevisionId'-'layoutRevisionId',document_id=NULL,
      revision=revision+1,updated_at=${now}
      WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}
        AND case_id=${caseId} AND deleted_at IS NULL`.execute(tx);
  }
}
