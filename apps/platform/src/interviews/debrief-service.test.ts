import { InterviewTurnSchema } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { buildDeterministicInterviewReview } from "./debrief-service.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-08-11T08:00:00.000Z";

function turn(input: {
  id: string;
  sequence: number;
  kind: "question" | "answer";
  content: string;
  requirementIds?: string[];
}) {
  return InterviewTurnSchema.parse({
    schemaVersion: "interview-turn-v1",
    id: input.id,
    ownerId,
    ownerEpoch: 1,
    interviewSessionId: sessionId,
    sequence: input.sequence,
    kind: input.kind,
    content: input.content,
    requirementIds: input.requirementIds ?? [],
    evidenceIds: [],
    createdAt: timestamp,
  });
}

describe("deterministic interview feedback and debrief", () => {
  it("reports only observable structure, length and explicit evidence-link gaps", () => {
    const review = buildDeterministicInterviewReview({
      sessionId,
      turns: [
        turn({
          id: "33333333-3333-4333-8333-333333333333",
          sequence: 1,
          kind: "question",
          content: "请说明如何满足 SQL 要求。",
          requirementIds: ["sql"],
        }),
        turn({
          id: "44444444-4444-4444-8444-444444444444",
          sequence: 2,
          kind: "answer",
          content: "暂无相关经历。",
          requirementIds: ["sql"],
        }),
        turn({
          id: "55555555-5555-4555-8555-555555555555",
          sequence: 3,
          kind: "question",
          content: "请说明一段真实项目经历。",
        }),
        turn({
          id: "66666666-6666-4666-8666-666666666666",
          sequence: 4,
          kind: "answer",
          content:
            "背景是一次合成课程项目，目标是按期完成数据整理。我负责拆分任务并与同学协作，首先核对字段，随后完成清洗和复查，最终按时完成交付并复盘了遗漏项。以上仅为合成测试回答。",
        }),
      ],
    });

    expect(review.feedback.items.map(({ category }) => category)).toEqual([
      "clarity",
      "structure",
      "evidence",
    ]);
    expect(review.feedback.items.at(-1)).toMatchObject({
      requirementIds: ["sql"],
      evidenceIds: [],
    });
    expect(review.expressionIssues).toHaveLength(2);
    expect(review.evidenceGaps).toHaveLength(1);
    expect(review.practicePlan.length).toBeGreaterThan(0);
    expect(JSON.stringify(review)).not.toMatch(/ats|录用概率|匹配分|score/i);
  });

  it("returns replay-stable IDs without inventing content from an unanswered fact", () => {
    const turns = [
      turn({
        id: "77777777-7777-4777-8777-777777777777",
        sequence: 1,
        kind: "question",
        content: "请基于真实经历回答。",
      }),
      turn({
        id: "88888888-8888-4888-8888-888888888888",
        sequence: 2,
        kind: "answer",
        content: "我没有相关经历。",
      }),
    ];
    const first = buildDeterministicInterviewReview({ sessionId, turns });
    const replay = buildDeterministicInterviewReview({ sessionId, turns });

    expect(replay).toEqual(first);
    expect(first.feedback.summary).toContain("可观察的表达结构与显式证据关联");
    expect(JSON.stringify(first)).not.toContain("拥有相关经历");
  });
});
