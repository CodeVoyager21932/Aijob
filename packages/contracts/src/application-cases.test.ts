import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ApplicationCaseCursorSchema,
  ApplicationCaseSchema,
  CaseOutcomeSchema,
  CaseStageSchema,
  CreateApplicationCaseRequestSchema,
  CreateCaseQuestionRequestSchema,
  InterviewModeSchema,
  PutCaseRequirementEvidenceLinksRequestSchema,
  RequirementEvidenceStateSchema,
  ResumeSuggestionDecisionSchema,
  TransitionApplicationCaseRequestSchema,
  UpdateCaseQuestionRequestSchema,
} from "./index.js";

const ids = {
  case: randomUUID(),
  owner: randomUUID(),
  job: randomUUID(),
  version: randomUUID(),
  requirementSet: randomUUID(),
};

const activeCase = {
  id: ids.case,
  ownerId: ids.owner,
  ownerEpoch: 1,
  publishedJobId: ids.job,
  publishedJobVersionId: ids.version,
  requirementSetId: ids.requirementSet,
  stage: "preparing" as const,
  outcome: null,
  revision: 2,
  expiresAt: "2026-09-04T00:00:00.000Z",
  endedAt: null,
  deletedAt: null,
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

describe("ApplicationCase contracts", () => {
  it("freezes the five public Career OS enums", () => {
    expect(CaseStageSchema.options).toEqual([
      "interested",
      "preparing",
      "applied",
      "interviewing",
      "resolved",
    ]);
    expect(CaseOutcomeSchema.options).toEqual([
      "offer",
      "rejected",
      "withdrawn",
      "expired",
      "unknown",
    ]);
    expect(RequirementEvidenceStateSchema.options).toEqual([
      "confirmed",
      "needs_work",
      "unconfirmed",
    ]);
    expect(ResumeSuggestionDecisionSchema.options).toEqual([
      "pending",
      "accepted",
      "edited",
      "rejected",
    ]);
    expect(InterviewModeSchema.options).toEqual(["template", "controlled_ai"]);
  });

  it("accepts only consistent stage, outcome and endedAt combinations", () => {
    expect(ApplicationCaseSchema.safeParse(activeCase).success).toBe(true);
    expect(
      ApplicationCaseSchema.safeParse({
        ...activeCase,
        stage: "resolved",
        outcome: "withdrawn",
        endedAt: "2026-08-05T01:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      ApplicationCaseSchema.safeParse({ ...activeCase, outcome: "offer" }).success,
    ).toBe(false);
    expect(
      ApplicationCaseSchema.safeParse({
        ...activeCase,
        stage: "resolved",
        outcome: null,
        endedAt: "2026-08-05T01:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("keeps create and update bodies strict and server-owned", () => {
    expect(
      CreateApplicationCaseRequestSchema.safeParse({
        publishedJobId: ids.job,
        publishedJobVersionId: ids.version,
      }).success,
    ).toBe(true);
    expect(
      CreateApplicationCaseRequestSchema.safeParse({
        publishedJobId: ids.job,
        publishedJobVersionId: ids.version,
        ownerId: ids.owner,
      }).success,
    ).toBe(false);
    expect(
      CreateCaseQuestionRequestSchema.safeParse({
        expectedRevision: 1,
        question: "岗位是否接受 2027 届学生？",
        expiresAt: "2026-09-04T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires a resolved transition to carry an outcome", () => {
    expect(
      TransitionApplicationCaseRequestSchema.safeParse({
        expectedRevision: 2,
        toStage: "resolved",
        outcome: "rejected",
      }).success,
    ).toBe(true);
    expect(
      TransitionApplicationCaseRequestSchema.safeParse({
        expectedRevision: 2,
        toStage: "resolved",
      }).success,
    ).toBe(false);
    expect(
      TransitionApplicationCaseRequestSchema.safeParse({
        expectedRevision: 2,
        toStage: "applied",
        outcome: "offer",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate evidence IDs and inconsistent question answers", () => {
    const evidenceRevisionId = randomUUID();
    expect(
      PutCaseRequirementEvidenceLinksRequestSchema.safeParse({
        expectedRevision: 3,
        evidenceRevisionId,
        evidenceIds: ["evidence-1", "evidence-1"],
      }).success,
    ).toBe(false);
    expect(
      UpdateCaseQuestionRequestSchema.safeParse({
        expectedRevision: 3,
        status: "answered",
      }).success,
    ).toBe(false);
    expect(
      UpdateCaseQuestionRequestSchema.safeParse({
        expectedRevision: 3,
        status: "dismissed",
        answer: "不应保留的回答",
      }).success,
    ).toBe(false);
  });

  it("requires every cursor sort column and rejects extra cursor fields", () => {
    expect(
      ApplicationCaseCursorSchema.safeParse({
        updatedAt: "2026-08-05T00:00:00.000Z",
        id: ids.case,
      }).success,
    ).toBe(true);
    expect(
      ApplicationCaseCursorSchema.safeParse({
        updatedAt: "2026-08-05T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      ApplicationCaseCursorSchema.safeParse({
        updatedAt: "2026-08-05T00:00:00.000Z",
        id: ids.case,
        ownerId: ids.owner,
      }).success,
    ).toBe(false);
  });
});
