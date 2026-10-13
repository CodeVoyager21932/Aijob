import { AssistantResultSchema } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  assistantFactSources,
  fixedAssistantHelp,
  validateAssistantGrounding,
} from "./assistant-strategies.js";
import { blockedPreparationChanges, runResumePreparation } from "./resume-preparation.js";

const personalFacts = { document: { content: { description: "整理 18 次访谈，未负责销售。" } } };
const draft = () =>
  AssistantResultSchema.parse({
    schemaVersion: "career-assistant-result-v1",
    kind: "draft",
    reply: "已起草一版",
    question: null,
    artifact: null,
    changes: [
      {
        id: "change-1",
        target: "entry_body",
        entryId: "source:item",
        sectionIds: [],
        text: "归纳 18 次访谈；未负责销售。",
        reason: "表达更清楚",
        sourceQuotes: ["整理 18 次访谈，未负责销售。"],
      },
    ],
    preparation: [],
    known: [],
    openQuestions: [],
  });

describe("bounded resume preparation", () => {
  it("separates JD evidence and numbers from personal facts, including ID digits", () => {
    const sources = assistantFactSources(
      {
        document: personalFacts.document,
        requirements: ["负责销售，提升 50%"],
        job: { salary: "15000" },
      },
      ["请按岗位调整"],
    );
    expect(sources.personalFacts).not.toHaveProperty("requirements");
    expect(() =>
      validateAssistantGrounding(
        {
          ...draft(),
          changes: [
            { ...draft().changes[0], text: "提升 50%", sourceQuotes: ["负责销售，提升 50%"] },
          ],
        },
        sources.personalFacts,
      ),
    ).toThrow("引用");
    expect(() =>
      validateAssistantGrounding(
        {
          ...draft(),
          changes: [
            {
              ...draft().changes[0],
              text: "提升 50%",
              sourceQuotes: ["整理 18 次访谈，未负责销售。"],
            },
          ],
        },
        sources.personalFacts,
      ),
    ).toThrow("数字");
    expect(() =>
      validateAssistantGrounding(
        { ...draft(), changes: [{ ...draft().changes[0], text: "负责 8 次访谈" }] },
        { ...personalFacts, id: "8" },
      ),
    ).toThrow("数字");
  });
  it("runs one draft and one review, retaining the draft before review and blocking unsupported suggestions", async () => {
    const calls: string[] = [];
    const result = await runResumePreparation({
      personalFacts,
      payload: { personalFacts, jobContext: { requirement: "岗位要求" } },
      complete: async ({ stage, payload }) => {
        calls.push(stage);
        if (stage === "draft") return draft();
        expect(payload).toHaveProperty("candidate");
        return {
          summary: "存在无依据的个人贡献",
          issues: [
            {
              changeId: "change-1",
              severity: "unsupported_fact",
              detail: "未负责销售不能改成负责销售。",
            },
          ],
        };
      },
      retainDraft: async (value) => {
        expect(value.changes).toEqual(draft().changes);
        calls.push("retained");
      },
    });
    expect(calls).toEqual(["draft", "retained", "review"]);
    expect(result.changes).toEqual(draft().changes);
    expect(result.preparationReview?.status).toBe("completed");
    expect([...blockedPreparationChanges(result)]).toEqual(["change-1"]);
  });
  it("retains a usable draft after review error and resumes an already retained draft without drafting again", async () => {
    const calls: string[] = [];
    const result = await runResumePreparation({
      personalFacts,
      payload: { personalFacts },
      savedDraft: draft(),
      complete: async ({ stage }) => {
        calls.push(stage);
        throw Object.assign(new Error("fixture"), { code: "AI_BUDGET_EXHAUSTED" });
      },
    });
    expect(calls).toEqual(["review"]);
    expect(result.changes).toEqual(draft().changes);
    expect(result.preparationReview).toMatchObject({
      status: "failed",
      failureCode: "AI_BUDGET_EXHAUSTED",
    });
    expect(blockedPreparationChanges(result).size).toBe(0);
  });
  it("does not count a model-provided self-review as an independent completed review", async () => {
    const fake = {
      ...draft(),
      preparationReview: {
        status: "completed",
        summary: "自称通过",
        issues: [],
        failureCode: null,
      },
    };
    const result = await runResumePreparation({
      personalFacts,
      payload: {},
      complete: async ({ stage }) => {
        if (stage === "draft") return fake;
        return {
          summary: "bad ids",
          issues: [{ changeId: "not-in-draft", severity: "attention", detail: "fixture" }],
        };
      },
    });
    expect(result.preparationReview?.status).toBe("failed");
    expect(result.changes).toEqual(draft().changes);
  });
  it("keeps a full fixed path available without pretending any API run occurred", () => {
    const result = fixedAssistantHelp("resume_review", true);
    expect(result.preparation).toHaveLength(4);
    expect(result.preparationReview?.status).toBe("fixed");
    expect(result.changes).toEqual([]);
    expect(result.artifact).toBeNull();
  });
});
