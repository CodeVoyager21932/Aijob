import { describe, expect, it } from "vitest";

import {
  ConfirmCaseDebriefRequestSchema,
  ConfirmCaseDebriefResponseSchema,
  CreateInterviewSessionRequestSchema,
  CreateInterviewSessionResponseSchema,
  DebriefConfirmationSchema,
  DebriefSchema,
  DeleteDebriefRequestSchema,
  DeleteDebriefResponseSchema,
  DeleteInterviewSessionRequestSchema,
  DeleteInterviewSessionResponseSchema,
  GetCaseDebriefResponseSchema,
  InterviewFeedbackSchema,
  InterviewSessionDetailSchema,
  InterviewSessionSchema,
  InterviewTurnSchema,
  KnowledgeClipCaseLinkSchema,
  KnowledgeClipSchema,
  ListInterviewSessionsQuerySchema,
  PrepareCaseDebriefRequestSchema,
  PrepareCaseDebriefResponseSchema,
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
    const confirmation = DebriefConfirmationSchema.parse({
      schemaVersion: "debrief-confirmation-v1",
      id: ids.item,
      ownerId: ids.owner,
      ownerEpoch: 1,
      debriefId: ids.debrief,
      basedOnDebriefRevision: 1,
      idempotencyKeyHash: "a".repeat(64),
      decisionMode: "whole_only",
      confirmedAt: timestamp,
    });
    expect(confirmation.basedOnDebriefRevision).toBe(1);
    expect(
      GetCaseDebriefResponseSchema.parse({
        feedback: null,
        debrief,
        itemDecisions: [],
        confirmation,
      }).confirmation?.decisionMode,
    ).toBe("whole_only");
  });

  it("requires one explicit decision per actionable Debrief item before confirmation", () => {
    const debrief = DebriefSchema.parse({
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
      evidenceGaps: [
        { id: ids.link, description: "The evidence link needs confirmation.", requirementIds: [] },
      ],
      practicePlan: [{ id: ids.clip, action: "Practice a concise STAR answer.", targetDate: null }],
      status: "confirmed",
      revision: 2,
      confirmedAt: timestamp,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const itemDecisions = [
      {
        schemaVersion: "debrief-item-decision-v1" as const,
        id: ids.session,
        ownerId: ids.owner,
        ownerEpoch: 1,
        debriefId: ids.debrief,
        basedOnDebriefRevision: 1,
        itemKind: "expression_issue" as const,
        itemId: ids.item,
        decision: "edited" as const,
        editedText: "先说明情境，再说明本人行动与真实结果。",
        createdAt: timestamp,
      },
      {
        schemaVersion: "debrief-item-decision-v1" as const,
        id: ids.evidenceRevision,
        ownerId: ids.owner,
        ownerEpoch: 1,
        debriefId: ids.debrief,
        basedOnDebriefRevision: 1,
        itemKind: "evidence_gap" as const,
        itemId: ids.link,
        decision: "deferred" as const,
        editedText: null,
        createdAt: timestamp,
      },
    ];
    const confirmation = DebriefConfirmationSchema.parse({
      schemaVersion: "debrief-confirmation-v1",
      id: ids.otherOwner,
      ownerId: ids.owner,
      ownerEpoch: 1,
      debriefId: ids.debrief,
      basedOnDebriefRevision: 1,
      idempotencyKeyHash: "a".repeat(64),
      decisionMode: "itemized_v1",
      confirmedAt: timestamp,
    });

    expect(
      ConfirmCaseDebriefRequestSchema.parse({
        expectedDebriefRevision: 1,
        itemDecisions: itemDecisions.map(({ itemKind, itemId, decision, editedText }) => ({
          itemKind,
          itemId,
          decision,
          editedText,
        })),
      }).itemDecisions,
    ).toHaveLength(2);
    expect(
      ConfirmCaseDebriefResponseSchema.parse({
        created: true,
        debrief,
        itemDecisions,
        confirmation,
      }).debrief.status,
    ).toBe("confirmed");
    expect(
      ConfirmCaseDebriefRequestSchema.safeParse({
        expectedDebriefRevision: 1,
        itemDecisions: [
          {
            itemKind: "expression_issue",
            itemId: ids.item,
            decision: "accepted",
            editedText: "Accepted decisions cannot smuggle edited text.",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ConfirmCaseDebriefResponseSchema.safeParse({
        created: true,
        debrief,
        itemDecisions: itemDecisions.slice(0, 1),
        confirmation,
      }).success,
    ).toBe(false);
  });

  it("prepares one Session-bound draft feedback and debrief without implicit confirmation", () => {
    const feedback = InterviewFeedbackSchema.parse({
      schemaVersion: "interview-feedback-record-v1",
      id: ids.item,
      ownerId: ids.owner,
      ownerEpoch: 1,
      interviewSessionId: ids.session,
      revision: 1,
      generatorMode: "template",
      feedback: {
        schemaVersion: "interview-feedback-v1",
        summary: "模板只检查可观察的表达结构与显式证据关联。",
        strengths: ["已完成全部模板问题"],
        items: [],
        practicePriorities: ["使用真实经历练习结构化表达"],
      },
      createdAt: timestamp,
    });
    const debrief = DebriefSchema.parse({
      schemaVersion: "debrief-v1",
      id: ids.debrief,
      ownerId: ids.owner,
      ownerEpoch: 1,
      caseId: ids.case,
      detachedFromCaseId: null,
      jobContext: privateJobContext,
      interviewSessionId: ids.session,
      evidenceRevisionId: ids.evidenceRevision,
      expressionIssues: [],
      evidenceGaps: [],
      practicePlan: [{ id: ids.clip, action: "再次练习并保持真实、具体。", targetDate: null }],
      status: "draft",
      revision: 1,
      confirmedAt: null,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(
      PrepareCaseDebriefRequestSchema.parse({
        interviewSessionId: ids.session,
        expectedSessionRevision: 3,
      }),
    ).toEqual({ interviewSessionId: ids.session, expectedSessionRevision: 3 });
    expect(
      PrepareCaseDebriefResponseSchema.parse({ created: true, feedback, debrief }).debrief.status,
    ).toBe("draft");
    expect(
      GetCaseDebriefResponseSchema.parse({
        feedback: null,
        debrief: null,
        itemDecisions: [],
        confirmation: null,
      }),
    ).toEqual({ feedback: null, debrief: null, itemDecisions: [], confirmation: null });
    expect(
      GetCaseDebriefResponseSchema.safeParse({
        feedback,
        debrief: null,
        itemDecisions: [],
        confirmation: null,
      }).success,
    ).toBe(false);
    expect(
      PrepareCaseDebriefResponseSchema.safeParse({
        created: true,
        feedback,
        debrief: { ...debrief, interviewSessionId: ids.otherOwner },
      }).success,
    ).toBe(false);
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

  it("revision-guards individual Interview and Debrief deletion", () => {
    expect(DeleteInterviewSessionRequestSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
    });
    expect(DeleteDebriefRequestSchema.parse({ expectedRevision: 1 })).toEqual({
      expectedRevision: 1,
    });
    expect(
      DeleteInterviewSessionResponseSchema.safeParse({
        sessionId: ids.session,
        revision: 3,
        deletedAt: timestamp,
      }).success,
    ).toBe(true);
    expect(
      DeleteDebriefResponseSchema.safeParse({
        debriefId: ids.debrief,
        revision: 2,
        deletedAt: timestamp,
      }).success,
    ).toBe(true);
    expect(
      DeleteDebriefRequestSchema.safeParse({ expectedRevision: 1, deleteSession: true }).success,
    ).toBe(false);
  });
});
