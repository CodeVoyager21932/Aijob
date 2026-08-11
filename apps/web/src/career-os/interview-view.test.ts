import type { InterviewSessionDetail } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  debriefActionItems,
  debriefBackflowPath,
  debriefConfirmationReady,
  debriefDecisionKey,
  caseDebriefSessionState,
  currentInterviewQuestion,
  interviewFeedbackCategoryLabels,
  interviewFeedbackSeverityLabels,
  interviewStatusLabels,
  interviewTurnLabel,
} from "./interview-view";

const timestamp = "2026-08-11T08:00:00.000Z";
const sessionId = "11111111-1111-4111-8111-111111111111";
const detail = {
  session: {
    schemaVersion: "interview-session-v1",
    id: sessionId,
    ownerId: "22222222-2222-4222-8222-222222222222",
    ownerEpoch: 1,
    caseId: "33333333-3333-4333-8333-333333333333",
    detachedFromCaseId: null,
    jobContext: {
      kind: "private",
      snapshotId: "44444444-4444-4444-8444-444444444444",
      ownerId: "22222222-2222-4222-8222-222222222222",
      title: "合成岗位",
      companyName: null,
      sourceLabel: "来源未提供，请自行核验",
      contentRevision: 1,
      requirementSetRevision: 1,
      sourceProvided: false,
    },
    evidenceRevisionId: "55555555-5555-4555-8555-555555555555",
    resumeDocumentId: "66666666-6666-4666-8666-666666666666",
    resumeContentRevisionId: "77777777-7777-4777-8777-777777777777",
    mode: "template",
    status: "active",
    templateVersion: "deterministic-zh-cn-v1",
    promptVersion: null,
    providerAdapter: null,
    model: null,
    revision: 1,
    completedAt: null,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  turns: [
    {
      schemaVersion: "interview-turn-v1",
      id: "88888888-8888-4888-8888-888888888888",
      ownerId: "22222222-2222-4222-8222-222222222222",
      ownerEpoch: 1,
      interviewSessionId: sessionId,
      sequence: 1,
      kind: "question",
      content: "请基于真实经历回答。",
      requirementIds: [],
      evidenceIds: [],
      createdAt: timestamp,
    },
  ],
} satisfies InterviewSessionDetail;

describe("interview view model", () => {
  it("returns only the active unanswered question", () => {
    const firstTurn = detail.turns[0];
    if (!firstTurn) throw new Error("INTERVIEW_QUESTION_FIXTURE_MISSING");
    expect(currentInterviewQuestion(detail)?.sequence).toBe(1);
    expect(
      currentInterviewQuestion({
        ...detail,
        session: { ...detail.session, status: "completed", completedAt: timestamp },
      }),
    ).toBeNull();
    expect(
      currentInterviewQuestion({
        ...detail,
        turns: [...detail.turns, { ...firstTurn, id: sessionId, sequence: 2, kind: "answer" }],
      }),
    ).toBeNull();
  });

  it("uses restrained labels without scores or AI claims", () => {
    expect(interviewStatusLabels.active).toBe("进行中");
    expect(interviewTurnLabel("question")).toBe("模板问题");
    expect(interviewTurnLabel("answer")).toBe("你的回答");
    expect(interviewFeedbackCategoryLabels.evidence).toBe("证据关联");
    expect(interviewFeedbackSeverityLabels.warning).toBe("建议核对");
  });

  it("distinguishes the selected Session debrief from another Case debrief", () => {
    expect(caseDebriefSessionState(undefined, sessionId)).toBe("empty");
    expect(caseDebriefSessionState({ debrief: null }, sessionId)).toBe("empty");
    expect(caseDebriefSessionState({ debrief: { interviewSessionId: sessionId } }, sessionId)).toBe(
      "selected",
    );
    expect(
      caseDebriefSessionState(
        { debrief: { interviewSessionId: "99999999-9999-4999-8999-999999999999" } },
        sessionId,
      ),
    ).toBe("other");
  });

  it("requires one local choice per actionable item and returns only controlled backflow paths", () => {
    const debrief = {
      schemaVersion: "debrief-v1" as const,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ownerId: detail.session.ownerId,
      ownerEpoch: 1,
      caseId: detail.session.caseId,
      detachedFromCaseId: null,
      jobContext: detail.session.jobContext,
      interviewSessionId: sessionId,
      evidenceRevisionId: detail.session.evidenceRevisionId,
      expressionIssues: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          description: "表达需要更具体。",
          turnIds: [],
        },
      ],
      evidenceGaps: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          description: "证据关联仍待核对。",
          requirementIds: ["requirement-1"],
        },
      ],
      practicePlan: [],
      status: "draft" as const,
      revision: 1,
      confirmedAt: null,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const items = debriefActionItems(debrief);
    const first = items[0];
    const second = items[1];
    if (!first || !second || !debrief.caseId) throw new Error("DEBRIEF_ITEM_FIXTURE_MISSING");
    const drafts = {
      [debriefDecisionKey(first)]: {
        itemKind: first.kind,
        itemId: first.id,
        decision: "accepted" as const,
        editedText: null,
      },
      [debriefDecisionKey(second)]: {
        itemKind: second.kind,
        itemId: second.id,
        decision: "edited" as const,
        editedText: "补充真实结果的来源说明。",
      },
    };
    expect(debriefConfirmationReady(debrief, {})).toBe(false);
    expect(debriefConfirmationReady(debrief, drafts)).toBe(true);
    expect(debriefBackflowPath(debrief.caseId, first)).toBe(
      `/applications/${debrief.caseId}/resume`,
    );
    expect(debriefBackflowPath(debrief.caseId, second)).toBe(
      `/applications/${debrief.caseId}/requirements?requirement=requirement-1`,
    );
  });
});
