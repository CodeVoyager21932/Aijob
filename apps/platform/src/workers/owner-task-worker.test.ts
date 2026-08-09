import { describe, expect, it } from "vitest";
import { ownerTaskPayload, workerTaskPayloadSchemas } from "./owner-task-worker.js";

describe("owner task payload contracts", () => {
  it("keeps source tasks and owner tasks structurally separate", () => {
    expect(
      workerTaskPayloadSchemas.resume_analysis.parse(
        ownerTaskPayload("resume_analysis", "analysis-1"),
      ),
    ).toEqual({ analysisId: "analysis-1" });
    expect(
      workerTaskPayloadSchemas.owner_deletion.parse(
        ownerTaskPayload("owner_deletion", "deletion-1"),
      ),
    ).toEqual({ deletionId: "deletion-1" });
    expect(
      workerTaskPayloadSchemas.resume_review.parse(ownerTaskPayload("resume_review", "review-1")),
    ).toEqual({ runId: "review-1" });
  });

  it("rejects a payload from another task type", () => {
    expect(() => workerTaskPayloadSchemas.resume_export.parse({ runId: "wrong" })).toThrow();
  });
});
