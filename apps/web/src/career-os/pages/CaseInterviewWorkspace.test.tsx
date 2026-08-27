import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  applyInterviewAnswerResult,
  InterviewAnswerConflictRecovery,
} from "./CaseInterviewWorkspace";

describe("Interview answer conflict recovery", () => {
  it("keeps a stale local draft visible until the user explicitly discards it", () => {
    const html = renderToStaticMarkup(
      <InterviewAnswerConflictRecovery
        draft="冲突草稿必须保留"
        onDiscard={() => undefined}
      />,
    );

    expect(html).toContain("服务器已有更新，本地草稿仍保留且没有重新提交");
    expect(html).toContain("冲突草稿必须保留");
    expect(html).toContain("readOnly");
    expect(html).toContain("放弃本地草稿，采用服务器进度");
  });

  it("applies the successful answer before canonical background queries finish", () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const timestamp = "2026-08-27T00:00:00.000Z";
    const question = {
      schemaVersion: "interview-turn-v1" as const,
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: "33333333-3333-4333-8333-333333333333",
      ownerEpoch: 1,
      interviewSessionId: sessionId,
      sequence: 1,
      kind: "question" as const,
      content: "请回答。",
      requirementIds: [],
      evidenceIds: [],
      createdAt: timestamp,
    };
    const detail = {
      session: { id: sessionId, revision: 1 },
      turns: [question],
    } as unknown as Parameters<typeof applyInterviewAnswerResult>[0];
    const answer = {
      ...question,
      id: "44444444-4444-4444-8444-444444444444",
      sequence: 2,
      kind: "answer" as const,
      content: "合成回答。",
    };

    const updated = applyInterviewAnswerResult(detail, {
      answer,
      nextQuestion: null,
      appliedRevision: 2,
      completed: true,
    });

    expect(updated?.session.revision).toBe(2);
    expect(updated?.turns.map((turn) => turn.kind)).toEqual(["question", "answer"]);
  });
});
