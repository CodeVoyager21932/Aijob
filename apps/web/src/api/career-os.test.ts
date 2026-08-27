import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applicationBoardPath,
  applicationCaseEventsPath,
  applicationCaseListPath,
  applicationCaseTransitionPath,
  careerOsQueryKeys,
  caseDebriefConfirmationPath,
  caseDebriefPath,
  createCaseMatchRun,
  getApplicationCaseRequirements,
  getCareerDataScope,
  getCurrentResumeReview,
  getInterviewSession,
  interviewSessionListPath,
  listApplicationCaseEvents,
  resumeDocumentDocxPath,
  resumeDocumentListPath,
} from "./career-os";

describe("Career OS API paths", () => {
  it("loads at most one hundred Cases and preserves an opaque cursor", () => {
    expect(applicationCaseListPath()).toBe("/v1/application-cases?limit=100");
    expect(
      applicationCaseListPath({
        limit: 20,
        stage: "preparing",
        city: "上海",
        sort: "deadline",
        cursor: "opaque+/=",
      }),
    ).toBe(
      "/v1/application-cases?limit=20&stage=preparing&city=%E4%B8%8A%E6%B5%B7&sort=deadline&cursor=opaque%2B%2F%3D",
    );
  });

  it("keeps the board snapshot and stage command on canonical Case routes", () => {
    expect(applicationBoardPath()).toBe(
      "/v1/application-cases/board?sort=updated&limitPerStage=20",
    );
    expect(applicationBoardPath({ city: "深圳", sort: "deadline", limitPerStage: 12 })).toBe(
      "/v1/application-cases/board?city=%E6%B7%B1%E5%9C%B3&sort=deadline&limitPerStage=12",
    );
    const caseId = randomUUID();
    expect(applicationCaseTransitionPath(caseId)).toBe(
      `/v1/application-cases/${caseId}/transitions`,
    );
  });

  it("keeps Case matching inputs server-derived", async () => {
    const caseId = randomUUID();
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: unknown }> = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { cookie: "aijob_csrf=test-token" },
    });
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        JSON.stringify({
          schemaVersion: "case-match-state-v1",
          caseId,
          caseRevision: 4,
          status: "not_run",
          input: {
            publishedJobVersionId: randomUUID(),
            requirementSetId: randomUUID(),
            profileFactRevisionId: randomUUID(),
            preferenceRevisionId: randomUUID(),
            evidenceRevisionId: randomUUID(),
          },
          catalogState: "current",
          missingInputs: [],
          staleReasons: [],
          run: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      await createCaseMatchRun(caseId, 4, "case-match:test");
      expect(requests).toEqual([
        {
          url: `/v1/application-cases/${caseId}/match-runs`,
          body: { expectedCaseRevision: 4 },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      Reflect.deleteProperty(globalThis, "document");
    }
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

  it("keeps deterministic feedback and debrief under the selected Case", () => {
    const caseId = randomUUID();
    expect(caseDebriefPath(caseId)).toBe(`/v1/application-cases/${caseId}/debrief`);
    expect(caseDebriefConfirmationPath(caseId)).toBe(
      `/v1/application-cases/${caseId}/debrief/confirmations`,
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
    expect(resumeDocumentListPath({ kind: "case_derived" })).toBe(
      "/v1/resume-documents?limit=100&kind=case_derived",
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

  it("rejects a malformed Review v2 response at the runtime boundary", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ review: null, requirements: "not-an-array" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      await expect(getCurrentResumeReview(randomUUID())).rejects.toMatchObject({
        status: 502,
        code: "INVALID_API_RESPONSE",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects malformed OS-6 timeline, interview and data-scope responses", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ malformed: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      const caseId = randomUUID();
      await expect(listApplicationCaseEvents(caseId)).rejects.toMatchObject({
        status: 502,
        code: "INVALID_API_RESPONSE",
      });
      await expect(getInterviewSession(caseId, randomUUID())).rejects.toMatchObject({
        status: 502,
        code: "INVALID_API_RESPONSE",
      });
      await expect(getCareerDataScope()).rejects.toMatchObject({
        status: 502,
        code: "INVALID_API_RESPONSE",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a malformed Requirements response instead of trusting an OS-4 payload", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ requirements: "not-an-array" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      await expect(getApplicationCaseRequirements(randomUUID())).rejects.toMatchObject({
        status: 502,
        code: "INVALID_API_RESPONSE",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the complete data scope under the owner profile namespace", () => {
    expect(careerOsQueryKeys.dataScope).toEqual(["career-os", "profile", "data-scope"]);
  });
});
