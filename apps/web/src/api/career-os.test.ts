import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applicationCaseListPath, resumeDocumentListPath } from "./career-os";

describe("Career OS API paths", () => {
  it("loads at most one hundred Cases and preserves an opaque cursor", () => {
    expect(applicationCaseListPath()).toBe("/v1/application-cases?limit=100");
    expect(applicationCaseListPath({ limit: 20, cursor: "opaque+/=" })).toBe(
      "/v1/application-cases?limit=20&cursor=opaque%2B%2F%3D",
    );
  });

  it("signs resume list requests with their visible filters", () => {
    const caseId = randomUUID();
    expect(resumeDocumentListPath({ kind: "case_derived", caseId })).toBe(
      `/v1/resume-documents?limit=100&kind=case_derived&caseId=${caseId}`,
    );
    expect(resumeDocumentListPath({ kind: "base" })).toBe(
      "/v1/resume-documents?limit=100&kind=base",
    );
  });
});
