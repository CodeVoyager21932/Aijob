import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applicationCaseEventsPath,
  applicationCaseListPath,
  interviewSessionListPath,
  resumeDocumentDocxPath,
  resumeDocumentListPath,
} from "./career-os";

describe("Career OS API paths", () => {
  it("loads at most one hundred Cases and preserves an opaque cursor", () => {
    expect(applicationCaseListPath()).toBe("/v1/application-cases?limit=100");
    expect(applicationCaseListPath({ limit: 20, cursor: "opaque+/=" })).toBe(
      "/v1/application-cases?limit=20&cursor=opaque%2B%2F%3D",
    );
  });

  it("binds a Case timeline cursor to the selected Case path", () => {
    const caseId = randomUUID();
    expect(applicationCaseEventsPath(caseId)).toBe(
      `/v1/application-cases/${caseId}/events?limit=50`,
    );
    expect(applicationCaseEventsPath(caseId, { limit: 10, cursor: "older+/=" })).toBe(
      `/v1/application-cases/${caseId}/events?limit=10&cursor=older%2B%2F%3D`,
    );
  });

  it("binds interview history pagination to the selected Case", () => {
    const caseId = randomUUID();
    expect(interviewSessionListPath(caseId)).toBe(
      `/v1/application-cases/${caseId}/interview-sessions?limit=20`,
    );
    expect(interviewSessionListPath(caseId, { limit: 10, cursor: "older+/=" })).toBe(
      `/v1/application-cases/${caseId}/interview-sessions?limit=10&cursor=older%2B%2F%3D`,
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

  it("pins DOCX downloads to the content and layout shown in the editor", () => {
    const documentId = randomUUID();
    const contentRevisionId = randomUUID();
    const layoutRevisionId = randomUUID();
    expect(resumeDocumentDocxPath({ documentId, contentRevisionId, layoutRevisionId })).toBe(
      `/v1/resume-documents/${documentId}/docx?contentRevisionId=${contentRevisionId}&layoutRevisionId=${layoutRevisionId}`,
    );
  });
});
