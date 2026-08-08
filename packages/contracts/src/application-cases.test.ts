import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ApplicationCaseCursorSchema,
  ApplicationCaseEventSchema,
  ApplicationCaseSchema,
  ApplicationCaseWithJobContextSchema,
  CaseOutcomeSchema,
  CaseQuestionSchema,
  CaseRequirementEvidenceLinkSchema,
  CaseRequirementStateSchema,
  CaseStageSchema,
  CreateApplicationCaseRequestSchema,
  CreateApplicationCaseResponseSchema,
  CreateApplicationCaseWithJobContextRequestSchema,
  CreateCaseQuestionRequestSchema,
  InterviewModeSchema,
  JobContextSchema,
  LegacyApplicationCaseEventSchema,
  ListApplicationCasesResponseSchema,
  PrivateJobSnapshotSchema,
  PrivateRequirementContextSchema,
  PublicJobReferenceSchema,
  PublicRequirementContextSchema,
  PutCaseRequirementEvidenceLinksRequestSchema,
  RequirementContextSchema,
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
  snapshot: randomUUID(),
  event: randomUUID(),
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
    expect(ApplicationCaseSchema.safeParse({ ...activeCase, outcome: "offer" }).success).toBe(
      false,
    );
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

  it("keeps public and private job contexts mutually exclusive", () => {
    expect(
      PublicJobReferenceSchema.safeParse({
        kind: "public",
        publishedJobId: ids.job,
        publishedJobVersionId: ids.version,
        requirementSetId: ids.requirementSet,
        officialUrl: "https://careers.example.com/jobs/1",
      }).success,
    ).toBe(true);
    expect(
      PrivateJobSnapshotSchema.safeParse({
        kind: "private",
        snapshotId: ids.snapshot,
        ownerId: ids.owner,
        title: "产品实习生",
        companyName: null,
        sourceLabel: "用户粘贴",
        contentRevision: 1,
        requirementSetRevision: 1,
        sourceProvided: false,
      }).success,
    ).toBe(true);
    expect(
      JobContextSchema.safeParse({
        kind: "private",
        snapshotId: ids.snapshot,
        ownerId: ids.owner,
        title: "产品实习生",
        companyName: null,
        sourceLabel: "用户粘贴",
        contentRevision: 1,
        requirementSetRevision: 1,
        sourceProvided: false,
        publishedJobId: ids.job,
      }).success,
    ).toBe(false);
  });

  it("keeps public and private requirement contexts strict and mutually exclusive", () => {
    expect(
      PublicRequirementContextSchema.safeParse({
        kind: "public",
        requirementSetId: ids.requirementSet,
      }).success,
    ).toBe(true);
    expect(
      PrivateRequirementContextSchema.safeParse({
        kind: "private",
        requirementSetRevision: 2,
      }).success,
    ).toBe(true);
    expect(
      RequirementContextSchema.safeParse({
        kind: "private",
        requirementSetRevision: 2,
        requirementSetId: ids.requirementSet,
      }).success,
    ).toBe(false);
  });

  it("accepts long-lived private cases without exposing server-owned create fields", () => {
    expect(
      ApplicationCaseWithJobContextSchema.safeParse({
        id: ids.case,
        ownerId: ids.owner,
        ownerEpoch: 1,
        jobContext: {
          kind: "private",
          snapshotId: ids.snapshot,
          ownerId: ids.owner,
          title: "算法工程实习生",
          companyName: "示例公司",
          sourceLabel: "用户粘贴",
          contentRevision: 2,
          requirementSetRevision: 1,
          sourceProvided: false,
        },
        stage: "interested",
        outcome: null,
        revision: 1,
        endedAt: null,
        deletedAt: null,
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      CreateApplicationCaseWithJobContextRequestSchema.safeParse({
        jobContext: {
          kind: "private",
          snapshotId: ids.snapshot,
          contentRevision: 2,
          ownerId: ids.owner,
          publicVisibility: true,
        },
      }).success,
    ).toBe(false);
    expect(
      CreateApplicationCaseWithJobContextRequestSchema.safeParse({
        jobContext: {
          kind: "public",
          publishedJobId: ids.job,
          publishedJobVersionId: ids.version,
        },
        publishedJobId: ids.job,
      }).success,
    ).toBe(false);
  });

  it("keeps list and create responses explicit and strict", () => {
    const applicationCase = {
      id: ids.case,
      ownerId: ids.owner,
      ownerEpoch: 1,
      jobContext: {
        kind: "public" as const,
        publishedJobId: ids.job,
        publishedJobVersionId: ids.version,
        requirementSetId: ids.requirementSet,
        officialUrl: "https://careers.example.com/jobs/1/apply",
      },
      stage: "interested" as const,
      outcome: null,
      revision: 1,
      endedAt: null,
      deletedAt: null,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };

    expect(
      ListApplicationCasesResponseSchema.safeParse({
        items: [applicationCase],
        nextCursor: "opaque-cursor",
      }).success,
    ).toBe(true);
    expect(
      CreateApplicationCaseResponseSchema.safeParse({
        applicationCase,
        created: true,
      }).success,
    ).toBe(true);
    expect(
      CreateApplicationCaseResponseSchema.safeParse({
        applicationCase,
        created: true,
        idempotencyKey: "must-not-leak",
      }).success,
    ).toBe(false);
  });

  it("validates new event payloads by event type and rejects body leakage", () => {
    const event = {
      id: ids.event,
      caseId: ids.case,
      sequence: 1,
      eventType: "stage_transitioned" as const,
      actorType: "owner" as const,
      eventData: {
        schemaVersion: "case-event-v1" as const,
        fromStage: "interested" as const,
        toStage: "preparing" as const,
        outcome: null,
        reasonCode: "USER_CONFIRMED",
      },
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    expect(ApplicationCaseEventSchema.safeParse(event).success).toBe(true);
    for (const leakedField of ["jdText", "resumeText", "answer", "modelInput"]) {
      expect(
        ApplicationCaseEventSchema.safeParse({
          ...event,
          eventData: { ...event.eventData, [leakedField]: "不应进入事件的数据" },
        }).success,
      ).toBe(false);
    }
    expect(
      ApplicationCaseEventSchema.safeParse({
        ...event,
        eventType: "question_added",
      }).success,
    ).toBe(false);
  });

  it("accepts exact public and private requirement events without weakening public v1", () => {
    const eventBase = {
      id: ids.event,
      caseId: ids.case,
      sequence: 2,
      actorType: "owner" as const,
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    const publicEvent = {
      ...eventBase,
      eventType: "requirement_state_changed" as const,
      eventData: {
        schemaVersion: "case-event-v1" as const,
        requirementSetId: ids.requirementSet,
        requirementId: "requirement-1",
        fromState: null,
        toState: "unconfirmed" as const,
        reasonCode: null,
      },
    };
    const privateEvent = {
      ...eventBase,
      eventType: "requirement_evidence_changed" as const,
      eventData: {
        schemaVersion: "case-event-v1" as const,
        requirementContextKind: "private" as const,
        requirementSetRevision: 3,
        requirementId: "requirement-1",
        evidenceRevisionId: randomUUID(),
        evidenceIds: ["evidence-1"],
        action: "linked" as const,
      },
    };
    expect(ApplicationCaseEventSchema.safeParse(publicEvent).success).toBe(true);
    expect(ApplicationCaseEventSchema.safeParse(privateEvent).success).toBe(true);
    expect(
      ApplicationCaseEventSchema.safeParse({
        ...privateEvent,
        eventData: { ...privateEvent.eventData, requirementSetId: ids.requirementSet },
      }).success,
    ).toBe(false);
    expect(
      ApplicationCaseEventSchema.safeParse({
        ...publicEvent,
        eventData: { ...publicEvent.eventData, requirementContextKind: "public" },
      }).success,
    ).toBe(false);
  });

  it("uses one requirement context shape across states, evidence links and questions", () => {
    const common = {
      caseId: ids.case,
      requirementContext: { kind: "private" as const, requirementSetRevision: 1 },
      requirementId: "requirement-1",
    };
    expect(
      CaseRequirementStateSchema.safeParse({
        id: randomUUID(),
        ...common,
        state: "needs_work",
        userNote: null,
        revision: 1,
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      CaseRequirementEvidenceLinkSchema.safeParse({
        id: randomUUID(),
        requirementStateId: randomUUID(),
        ...common,
        evidenceRevisionId: randomUUID(),
        evidenceId: "evidence-1",
        revision: 1,
        linkedAt: "2026-08-06T00:00:00.000Z",
        removedAt: null,
      }).success,
    ).toBe(true);
    expect(
      CaseQuestionSchema.safeParse({
        id: randomUUID(),
        requirementStateId: randomUUID(),
        ...common,
        question: "该要求需要怎样的项目证据？",
        answer: null,
        status: "open",
        revision: 1,
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      CaseQuestionSchema.safeParse({
        id: randomUUID(),
        caseId: ids.case,
        requirementStateId: null,
        requirementContext: null,
        requirementId: "orphan-requirement",
        question: "不允许孤立要求引用",
        answer: null,
        status: "open",
        revision: 1,
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires an explicit read-only marker for untyped legacy events", () => {
    expect(
      LegacyApplicationCaseEventSchema.safeParse({
        id: ids.event,
        caseId: ids.case,
        sequence: 1,
        eventType: "case_created",
        actorType: "system",
        eventData: { historicalField: "preserved without write-back" },
        legacyReadOnly: true,
        createdAt: "2026-08-05T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      LegacyApplicationCaseEventSchema.safeParse({
        id: ids.event,
        caseId: ids.case,
        sequence: 1,
        eventType: "case_created",
        actorType: "system",
        eventData: { historicalField: "not safe for a new write" },
        createdAt: "2026-08-05T00:00:00.000Z",
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
