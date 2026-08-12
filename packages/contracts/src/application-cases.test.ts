import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ApplicationCaseCommandResponseSchema,
  ApplicationCaseCursorSchema,
  ApplicationCaseEventSchema,
  ApplicationCaseJobDisplaySchema,
  ApplicationCaseJobVersionDiffResponseSchema,
  ApplicationCaseMutationResponseSchema,
  ApplicationCaseRequirementsSchema,
  ApplicationCaseSchema,
  ApplicationCaseWithJobContextSchema,
  CaseOutcomeSchema,
  CaseQuestionSchema,
  CaseRequirementEvidenceLinkSchema,
  CaseRequirementStateReadModelSchema,
  CaseRequirementStateSchema,
  CaseStageSchema,
  CreateApplicationCaseRequestSchema,
  CreateApplicationCaseResponseSchema,
  CreateApplicationCaseWithJobContextRequestSchema,
  CreateCaseQuestionRequestSchema,
  DeleteApplicationCaseRequestSchema,
  DeleteApplicationCaseResponseSchema,
  InterviewModeSchema,
  JobContextSchema,
  LegacyApplicationCaseEventSchema,
  ListApplicationCaseEventsQuerySchema,
  ListApplicationCaseEventsResponseSchema,
  ListApplicationCasesResponseSchema,
  PrivateJobSnapshotSchema,
  PrivateRequirementContextSchema,
  PublicJobReferenceSchema,
  PublicRequirementContextSchema,
  PutCaseRequirementEvidenceLinksRequestSchema,
  RecordManualApplicationRequestSchema,
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

const publicJobDisplay = {
  title: "产品实习生",
  companyName: "示例公司",
  locations: {
    state: "known" as const,
    value: ["上海"],
    evidenceRefs: ["source-job-revision:example:field:locations"],
  },
  workMode: { state: "unknown" as const, reason: "source_not_stated" as const },
  deadlineAt: { state: "unknown" as const, reason: "source_not_stated" as const },
  source: {
    kind: "catalog" as const,
    displayName: "示例公司招聘官网",
    policyStatus: "approved" as const,
    provenanceLevel: "organization_owned" as const,
    lastVerifiedAt: "2026-08-06T00:00:00.000Z",
  },
};

const privateJobDisplay = {
  title: "算法工程实习生",
  companyName: "示例公司",
  locations: { state: "unknown" as const, reason: "source_not_stated" as const },
  workMode: { state: "unknown" as const, reason: "source_not_stated" as const },
  deadlineAt: { state: "unknown" as const, reason: "source_not_stated" as const },
  source: {
    kind: "owner_private" as const,
    displayName: "来源未提供，请自行核验",
    sourceProvided: false,
    verified: false as const,
  },
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
        jobDisplay: privateJobDisplay,
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

  it("accepts only explicit catalog or owner-private job display provenance", () => {
    expect(ApplicationCaseJobDisplaySchema.safeParse(publicJobDisplay).success).toBe(true);
    expect(ApplicationCaseJobDisplaySchema.safeParse(privateJobDisplay).success).toBe(true);
    expect(
      ApplicationCaseJobDisplaySchema.safeParse({
        ...privateJobDisplay,
        source: { ...privateJobDisplay.source, verified: true },
      }).success,
    ).toBe(false);
    expect(
      ApplicationCaseJobDisplaySchema.safeParse({
        ...publicJobDisplay,
        source: { ...publicJobDisplay.source, official: true },
      }).success,
    ).toBe(false);
  });

  it("validates private JD input without accepting owner or visibility fields", () => {
    expect(
      CreateApplicationCaseWithJobContextRequestSchema.parse({
        jobContext: {
          kind: "private_input",
          title: "产品实习生",
          companyName: null,
          contentText: "岗位职责\r\n负责用户研究",
          source: { kind: "unspecified" },
        },
      }).jobContext,
    ).toMatchObject({ kind: "private_input", duplicateHandling: "reuse" });
    expect(
      CreateApplicationCaseWithJobContextRequestSchema.safeParse({
        jobContext: {
          kind: "private_input",
          title: "产品实习生",
          companyName: null,
          contentText: "负责用户研究",
          source: { kind: "provided_url", url: "http://example.com/job" },
          duplicateHandling: "reuse",
        },
      }).success,
    ).toBe(false);
    expect(
      CreateApplicationCaseWithJobContextRequestSchema.safeParse({
        jobContext: {
          kind: "private_input",
          title: "产品实习生",
          companyName: null,
          contentText: "负责用户研究",
          source: { kind: "referral" },
          duplicateHandling: "create_separate",
          ownerId: ids.owner,
          publicVisibility: true,
        },
      }).success,
    ).toBe(false);
    expect(
      CreateApplicationCaseWithJobContextRequestSchema.safeParse({
        jobContext: {
          kind: "private_input",
          title: "产品实习生",
          companyName: null,
          contentText: "x".repeat(200_001),
          source: { kind: "unspecified" },
          duplicateHandling: "reuse",
        },
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
      jobDisplay: publicJobDisplay,
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

  it("supports atomic v2 requirement and question mutations without leaking text", () => {
    const eventBase = {
      id: randomUUID(),
      caseId: ids.case,
      sequence: 3,
      actorType: "owner" as const,
      createdAt: "2026-08-09T00:00:00.000Z",
    };
    const stateEvent = {
      ...eventBase,
      eventType: "requirement_state_changed" as const,
      eventData: {
        schemaVersion: "case-event-v2" as const,
        requirementSetId: ids.requirementSet,
        requirementId: "requirement-1",
        fromState: "unconfirmed" as const,
        toState: "unconfirmed" as const,
        noteChanged: true,
        reasonCode: "USER_UPDATED",
      },
    };
    const evidenceEvent = {
      ...eventBase,
      eventType: "requirement_evidence_changed" as const,
      eventData: {
        schemaVersion: "case-event-v2" as const,
        requirementContextKind: "private" as const,
        requirementSetRevision: 2,
        requirementId: "requirement-1",
        evidenceRevisionId: randomUUID(),
        linkedEvidenceIds: ["evidence-2"],
        removedEvidenceIds: ["evidence-1"],
      },
    };
    const questionEvent = {
      ...eventBase,
      eventType: "question_updated" as const,
      eventData: {
        schemaVersion: "case-event-v2" as const,
        questionId: randomUUID(),
        fromStatus: "answered" as const,
        toStatus: "answered" as const,
        answerChanged: true,
      },
    };

    expect(ApplicationCaseEventSchema.safeParse(stateEvent).success).toBe(true);
    expect(ApplicationCaseEventSchema.safeParse(evidenceEvent).success).toBe(true);
    expect(ApplicationCaseEventSchema.safeParse(questionEvent).success).toBe(true);
    expect(
      ApplicationCaseEventSchema.safeParse({
        ...stateEvent,
        eventData: { ...stateEvent.eventData, noteChanged: false },
      }).success,
    ).toBe(false);
    expect(
      ApplicationCaseEventSchema.safeParse({
        ...evidenceEvent,
        eventData: {
          ...evidenceEvent.eventData,
          linkedEvidenceIds: ["evidence-1"],
        },
      }).success,
    ).toBe(false);
    expect(
      ApplicationCaseEventSchema.safeParse({
        ...questionEvent,
        eventData: { ...questionEvent.eventData, answerChanged: false },
      }).success,
    ).toBe(false);
  });

  it("represents fixed private requirements and virtual unconfirmed states honestly", () => {
    const requirementContext = { kind: "private" as const, requirementSetRevision: 2 };
    const virtualState = {
      id: null,
      caseId: ids.case,
      requirementContext,
      requirementId: "requirement-1",
      state: "unconfirmed" as const,
      userNote: null,
      revision: null,
      persisted: false,
      createdAt: null,
      updatedAt: null,
    };
    const requirements = {
      caseId: ids.case,
      requirementContext,
      revision: 2,
      requirements: [
        {
          id: "requirement-1",
          kind: "skill" as const,
          operator: "contains" as const,
          expectedValue: "SQL",
          sourceText: "熟悉 SQL",
          evidenceRefs: ["private-jd"],
          necessity: "required" as const,
          sourceSpan: null,
        },
      ],
      states: [virtualState],
      evidenceLinks: [],
      questions: [],
    };

    expect(CaseRequirementStateReadModelSchema.safeParse(virtualState).success).toBe(true);
    expect(ApplicationCaseRequirementsSchema.safeParse(requirements).success).toBe(true);
    expect(
      ApplicationCaseRequirementsSchema.safeParse({
        ...requirements,
        requirementSetId: ids.requirementSet,
      }).success,
    ).toBe(false);
    expect(
      CaseRequirementStateReadModelSchema.safeParse({
        ...virtualState,
        id: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      ApplicationCaseMutationResponseSchema.safeParse({ caseRevision: 2, event: null }).success,
    ).toBe(true);
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
    expect(
      TransitionApplicationCaseRequestSchema.safeParse({
        expectedRevision: 2,
        toStage: "preparing",
        reason: "USER_CONFIRMED",
      }).success,
    ).toBe(true);
    expect(
      TransitionApplicationCaseRequestSchema.safeParse({
        expectedRevision: 2,
        toStage: "preparing",
        reason: "用户填写的自由文本不能进入审计事件",
      }).success,
    ).toBe(false);
  });

  it("keeps manual application writes revisioned and event history paginated", () => {
    expect(RecordManualApplicationRequestSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
    });
    expect(RecordManualApplicationRequestSchema.safeParse({ expectedRevision: 0 }).success).toBe(
      false,
    );
    expect(
      RecordManualApplicationRequestSchema.safeParse({ expectedRevision: 2, applied: true })
        .success,
    ).toBe(false);

    expect(ListApplicationCaseEventsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(ListApplicationCaseEventsQuerySchema.parse({ limit: "100", cursor: "next" })).toEqual({
      limit: 100,
      cursor: "next",
    });
    expect(ListApplicationCaseEventsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);

    const event = {
      id: ids.event,
      caseId: ids.case,
      sequence: 3,
      eventType: "manual_application_recorded" as const,
      actorType: "owner" as const,
      eventData: {
        schemaVersion: "case-event-v1" as const,
        fromStage: "preparing" as const,
        toStage: "applied" as const,
        reasonCode: null,
      },
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    expect(
      ListApplicationCaseEventsResponseSchema.parse({ items: [event], nextCursor: "older" }),
    ).toEqual({ items: [event], nextCursor: "older" });
  });

  it("keeps command and deterministic job-version diff responses strict", () => {
    const event = {
      id: ids.event,
      caseId: ids.case,
      sequence: 2,
      eventType: "stage_transitioned" as const,
      actorType: "owner" as const,
      eventData: {
        schemaVersion: "case-event-v1" as const,
        fromStage: "interested" as const,
        toStage: "preparing" as const,
        outcome: null,
        reasonCode: "USER_CONFIRMED",
      },
      createdAt: "2026-08-08T00:00:00.000Z",
    };
    expect(ApplicationCaseCommandResponseSchema.safeParse({ event }).success).toBe(true);
    expect(
      ApplicationCaseCommandResponseSchema.safeParse({ event, requestHash: "must-not-leak" })
        .success,
    ).toBe(false);

    const targetVersionId = randomUUID();
    const targetRequirementSetId = randomUUID();
    const diff = {
      caseId: ids.case,
      publishedJobId: ids.job,
      pinnedPublishedJobVersionId: ids.version,
      pinnedRequirementSetId: ids.requirementSet,
      status: "update_available" as const,
      targetPublishedJobVersionId: targetVersionId,
      targetRequirementSetId,
      fieldChanges: [
        {
          field: "title" as const,
          fromValue: "产品实习生",
          toValue: "AI 产品实习生",
        },
      ],
      requirementChanges: {
        added: [
          {
            id: "requirement-skill-new",
            kind: "skill" as const,
            necessity: "required" as const,
            sourceText: "掌握 SQL",
          },
        ],
        removed: [],
        changed: [],
      },
    };
    expect(ApplicationCaseJobVersionDiffResponseSchema.safeParse(diff).success).toBe(true);
    expect(
      ApplicationCaseJobVersionDiffResponseSchema.safeParse({
        ...diff,
        status: "up_to_date",
      }).success,
    ).toBe(false);
    expect(
      ApplicationCaseJobVersionDiffResponseSchema.safeParse({
        ...diff,
        status: "target_unavailable",
        targetPublishedJobVersionId: null,
        targetRequirementSetId: null,
        fieldChanges: [],
        requirementChanges: { added: [], removed: [], changed: [] },
      }).success,
    ).toBe(true);
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

  it("keeps Case deletion choices explicit and its result non-overlapping", () => {
    expect(
      DeleteApplicationCaseRequestSchema.parse({
        expectedRevision: 4,
        resumeDocuments: "detach",
        interviewSessions: "delete",
        debriefs: "detach",
      }),
    ).toEqual({
      expectedRevision: 4,
      resumeDocuments: "detach",
      interviewSessions: "delete",
      debriefs: "detach",
    });
    expect(
      DeleteApplicationCaseRequestSchema.safeParse({
        expectedRevision: 4,
        resumeDocuments: "keep",
        interviewSessions: "delete",
        debriefs: "detach",
      }).success,
    ).toBe(false);

    const resumeDocumentId = randomUUID();
    expect(
      DeleteApplicationCaseResponseSchema.safeParse({
        caseId: ids.case,
        revision: 5,
        deletedAt: "2026-08-12T08:00:00.000Z",
        relatedAssets: {
          resumeDocuments: { deletedIds: [], detachedIds: [resumeDocumentId] },
          interviewSessions: { deletedIds: [randomUUID()], detachedIds: [] },
          debriefs: { deletedIds: [], detachedIds: [] },
        },
        privateJobSnapshotRetained: true,
      }).success,
    ).toBe(true);
    expect(
      DeleteApplicationCaseResponseSchema.safeParse({
        caseId: ids.case,
        revision: 5,
        deletedAt: "2026-08-12T08:00:00.000Z",
        relatedAssets: {
          resumeDocuments: {
            deletedIds: [resumeDocumentId],
            detachedIds: [resumeDocumentId],
          },
          interviewSessions: { deletedIds: [], detachedIds: [] },
          debriefs: { deletedIds: [], detachedIds: [] },
        },
        privateJobSnapshotRetained: false,
      }).success,
    ).toBe(false);
  });
});
