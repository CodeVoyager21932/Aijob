import { describe, expect, it } from "vitest";

import {
  CreateInterviewSessionRequestSchema,
  CreateInterviewSessionResponseSchema,
  DebriefConfirmationSchema,
  DebriefSchema,
  InterviewSessionDetailSchema,
  InterviewFeedbackSchema,
  InterviewSessionSchema,
  InterviewTurnSchema,
  KnowledgeClipCaseLinkSchema,
  KnowledgeClipSchema,
  ListInterviewSessionsQuerySchema,
  SubmitInterviewAnswerRequestSchema,
  SubmitInterviewAnswerResponseSchema,
} from "./interview-debrief-knowledge.js";

const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  otherOwner: "22222222-2222-4222-8222-222222222222",
  case: "33333333-3333-4333-8333-333333333333",
  session: "44444444-4444-4444-8444-444444444444",
  evidenceRevision: "55555555-5555-4555-8555-555555555555",
  item: "66666666-6666-4666-8666-666666666666",
  debrief: "77777777-7777-4777-8777-777777777777",
  clip: "88888888-8888-4888-8888-888888888888",
  link: "99999999-9999-4999-8999-999999999999",
};
const timestamp = "2026-08-06T08:00:00.000Z";
const privateJobContext = {
  kind: "private" as const,
  snapshotId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ownerId: ids.owner,
  title: "Synthetic product internship",
  companyName: null,
  sourceLabel: "owner_pasted",
  contentRevision: 1,
  requirementSetRevision: 1,
  sourceProvided: false,
};

const validSession = {
  schemaVersion: "interview-session-v1" as const,
  id: ids.session,
  ownerId: ids.owner,
  ownerEpoch: 1,
  caseId: ids.case,
  detachedFromCaseId: null,
  jobContext: privateJobContext,
  evidenceRevisionId: ids.evidenceRevision,
  resumeDocumentId: null,
  resumeContentRevisionId: null,
  mode: "template" as const,
  status: "active" as const,
  templateVersion: "template-v1",
  promptVersion: null,
  providerAdapter: null,
  model: null,
  revision: 1,
  completedAt: null,
  deletedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("Interview, Debrief and Knowledge contracts", () => {
  it("pins an interview to one owner-scoped active or detached Case", () => {
    expect(InterviewSessionSchema.parse(validSession).caseId).toBe(ids.case);
    expect(
      InterviewSessionSchema.safeParse({
        ...validSession,
        caseId: null,
        detachedFromCaseId: null,
      }).success,
    ).toBe(false);
    expect(
      InterviewSessionSchema.safeParse({
        ...validSession,
        jobContext: { ...privateJobContext, ownerId: ids.otherOwner },
      }).success,
    ).toBe(false);
  });

  it("keeps provider metadata all-or-nothing and outside template mode", () => {
    expect(
      InterviewSessionSchema.safeParse({ ...validSession, providerAdapter: "provider" }).success,
    ).toBe(false);
    expect(
      InterviewSessionSchema.safeParse({
        ...validSession,
        mode: "controlled_ai",
        promptVersion: "prompt-v1",
        providerAdapter: "domestic-provider-v1",
        model: "model-v1",
      }).success,
    ).toBe(true);
  });

  it("requires Resume document and semantic revision references together", () => {
    expect(
      InterviewSessionSchema.safeParse({
        ...validSession,
        resumeContentRevisionId: ids.item,
      }).success,
    ).toBe(false);
  });

  it("keeps turns append-shaped and bounded to referenced IDs", () => {
    const turn = {
      schemaVersion: "interview-turn-v1",
      id: ids.item,
      ownerId: ids.owner,
      ownerEpoch: 1,
      interviewSessionId: ids.session,
      sequence: 1,
      kind: "answer",
      content: "Synthetic answer grounded in confirmed evidence.",
      requirementIds: ["requirement-1"],
      evidenceIds: ["evidence-1"],
      createdAt: timestamp,
    };
    expect(InterviewTurnSchema.parse(turn).sequence).toBe(1);
    expect(
      InterviewTurnSchema.safeParse({ ...turn, evidenceIds: ["evidence-1", "evidence-1"] }).success,
    ).toBe(false);
  });

  it("accepts only explicit template-session creation inputs", () => {
    expect(CreateInterviewSessionRequestSchema.parse({ expectedCaseRevision: 3 })).toEqual({
      expectedCaseRevision: 3,
    });
    expect(
      CreateInterviewSessionRequestSchema.safeParse({
        expectedCaseRevision: 3,
        mode: "controlled_ai",
      }).success,
    ).toBe(false);
    expect(ListInterviewSessionsQuerySchema.parse({}).limit).toBe(20);
  });

  it("keeps session detail contiguous and bound to one session", () => {
    const question = InterviewTurnSchema.parse({
      schemaVersion: "interview-turn-v1",
      id: ids.item,
      ownerId: ids.owner,
      ownerEpoch: 1,
      interviewSessionId: ids.session,
      sequence: 1,
      kind: "question",
      content: "请只使用真实经历作答。",
      requirementIds: [],
      evidenceIds: [],
      createdAt: timestamp,
    });
    expect(
      CreateInterviewSessionResponseSchema.parse({
        sessionId: ids.session,
        firstQuestion: question,
      }).sessionId,
    ).toBe(ids.session);
    expect(
      InterviewSessionDetailSchema.parse({ session: validSession, turns: [question] }).turns,
    ).toHaveLength(1);
    expect(
      InterviewSessionDetailSchema.safeParse({
        session: validSession,
        turns: [{ ...question, sequence: 2 }],
      }).success,
    ).toBe(false);
  });

  it("bounds answers and returns one replay-stable command result", () => {
    const request = SubmitInterviewAnswerRequestSchema.parse({
      expectedRevision: 1,
      answer: "  我会基于真实项目说明。  ",
    });
    expect(request.answer).toBe("我会基于真实项目说明。");

    const answer = InterviewTurnSchema.parse({
      schemaVersion: "interview-turn-v1",
      id: ids.item,
      ownerId: ids.owner,
      ownerEpoch: 1,
      interviewSessionId: ids.session,
      sequence: 2,
      kind: "answer",
      content: request.answer,
      requirementIds: [],
      evidenceIds: [],
      createdAt: timestamp,
    });
    expect(
      SubmitInterviewAnswerResponseSchema.parse({
        answer,
        nextQuestion: null,
        appliedRevision: 2,
        completed: true,
      }).completed,
    ).toBe(true);
    expect(
      SubmitInterviewAnswerResponseSchema.safeParse({
        answer,
        nextQuestion: null,
        appliedRevision: 2,
        completed: false,
      }).success,
    ).toBe(false);
  });

  it("keeps feedback structured and rejects ATS scores or invented-fact fields", () => {
    const feedback = {
      schemaVersion: "interview-feedback-record-v1",
      id: ids.item,
      ownerId: ids.owner,
      ownerEpoch: 1,
      interviewSessionId: ids.session,
      revision: 1,
      generatorMode: "template",
      feedback: {
        schemaVersion: "interview-feedback-v1",
        summary: "The answer needs a clearer evidence chain.",
        strengths: ["Direct response"],
        items: [
          {
            id: ids.debrief,
            category: "evidence",
            severity: "warning",
            message: "The result is not connected to the confirmed example.",
            improvement: "State the action and cite the confirmed result.",
            turnIds: [ids.item],
            requirementIds: ["requirement-1"],
            evidenceIds: ["evidence-1"],
          },
        ],
        practicePriorities: ["Evidence-first STAR answer"],
      },
      createdAt: timestamp,
    };
    expect(InterviewFeedbackSchema.parse(feedback).feedback.items).toHaveLength(1);
    expect(
      InterviewFeedbackSchema.safeParse({
        ...feedback,
        feedback: { ...feedback.feedback, atsScore: 98 },
      }).success,
    ).toBe(false);
  });

  it("separates a confirmed Debrief from its append-only confirmation", () => {
    const debrief = {
      schemaVersion: "debrief-v1",
      id: ids.debrief,
      ownerId: ids.owner,
      ownerEpoch: 1,
      caseId: ids.case,
      detachedFromCaseId: null,
      jobContext: privateJobContext,
      interviewSessionId: ids.session,
      evidenceRevisionId: ids.evidenceRevision,
      expressionIssues: [{ id: ids.item, description: "The answer was too broad.", turnIds: [] }],
      evidenceGaps: [],
      practicePlan: [{ id: ids.clip, action: "Practice a concise STAR answer.", targetDate: null }],
      status: "confirmed" as const,
      revision: 2,
      confirmedAt: timestamp,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(DebriefSchema.parse(debrief).status).toBe("confirmed");
    expect(DebriefSchema.safeParse({ ...debrief, confirmedAt: null }).success).toBe(false);
    expect(
      DebriefConfirmationSchema.parse({
        schemaVersion: "debrief-confirmation-v1",
        id: ids.item,
        ownerId: ids.owner,
        ownerEpoch: 1,
        debriefId: ids.debrief,
        basedOnDebriefRevision: 1,
        idempotencyKeyHash: "a".repeat(64),
        confirmedAt: timestamp,
      }).basedOnDebriefRevision,
    ).toBe(1);
  });

  it("keeps Knowledge clips as private HTTPS citations without captured bodies", () => {
    const clip = {
      schemaVersion: "knowledge-clip-v1",
      id: ids.clip,
      ownerId: ids.owner,
      ownerEpoch: 1,
      url: "https://example.test/interview-guide",
      title: "Interview guide",
      summary: "A short user-saved summary.",
      useCases: ["Product interview"],
      userNotes: null,
      verifiedAt: timestamp,
      revision: 1,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(KnowledgeClipSchema.parse(clip).url).toMatch(/^https:/);
    expect(KnowledgeClipSchema.safeParse({ ...clip, url: "http://example.test" }).success).toBe(
      false,
    );
    expect(KnowledgeClipSchema.safeParse({ ...clip, body: "captured article" }).success).toBe(
      false,
    );
  });

  it("links a private clip to a same-owner Case by IDs only", () => {
    expect(
      KnowledgeClipCaseLinkSchema.parse({
        schemaVersion: "knowledge-clip-case-link-v1",
        id: ids.link,
        ownerId: ids.owner,
        ownerEpoch: 1,
        knowledgeClipId: ids.clip,
        caseId: ids.case,
        createdAt: timestamp,
      }).knowledgeClipId,
    ).toBe(ids.clip);
  });
});
