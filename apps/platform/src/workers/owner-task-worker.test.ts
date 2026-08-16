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
    expect(
      workerTaskPayloadSchemas.resume_review_v2.parse(
        ownerTaskPayload("resume_review_v2", "review-v2-1"),
      ),
    ).toEqual({ runId: "review-v2-1" });
  });

  it("rejects a payload from another task type", () => {
    expect(() => workerTaskPayloadSchemas.resume_export.parse({ runId: "wrong" })).toThrow();
  });

  it("accepts only the bounded Case-pinned match execution context", () => {
    const payload = {
      runId: "29c2564c-cb60-4af0-8fae-e72ef7a85e16",
      executionContext: {
        kind: "case_pinned",
        caseId: "37d74c6f-8ee7-4e1c-85d5-79439c5671ef",
        expectedCaseRevision: 3,
        publishedJobVersionId: "a61df389-c9a0-4655-913d-c0edb0241301",
        requirementSetId: "6dccae42-d573-4925-a4d6-6a5a33cf2c18",
      },
    };
    expect(workerTaskPayloadSchemas.match_run.parse(payload)).toEqual(payload);
    expect(() =>
      workerTaskPayloadSchemas.match_run.parse({
        ...payload,
        executionContext: { ...payload.executionContext, ownerId: "must-not-be-client-owned" },
      }),
    ).toThrow();
  });
});
