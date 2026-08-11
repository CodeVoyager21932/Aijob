import { randomUUID } from "node:crypto";
import type { ApplicationCaseEventReadModel } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import {
  canRecordManualApplication,
  manualApplicationStatusCopy,
  toApplicationCaseEventView,
} from "./application-event-view";

describe("Case application timeline view", () => {
  it("only allows an explicit application record before the applied stage", () => {
    expect(canRecordManualApplication("interested")).toBe(true);
    expect(canRecordManualApplication("preparing")).toBe(true);
    expect(canRecordManualApplication("applied")).toBe(false);
    expect(canRecordManualApplication("interviewing")).toBe(false);
    expect(canRecordManualApplication("resolved")).toBe(false);
    expect(manualApplicationStatusCopy("applied")).toContain("已经由你确认");
  });

  it("labels manual application records as user-confirmed rather than link-derived", () => {
    const event: ApplicationCaseEventReadModel = {
      id: randomUUID(),
      caseId: randomUUID(),
      sequence: 2,
      eventType: "manual_application_recorded",
      actorType: "owner",
      eventData: {
        schemaVersion: "case-event-v1",
        fromStage: "preparing",
        toStage: "applied",
        reasonCode: null,
      },
      createdAt: "2026-08-11T08:00:00.000Z",
    };
    expect(toApplicationCaseEventView(event)).toEqual({
      title: "确认完成投递",
      detail: "准备投递 → 已投递；由用户手动确认。",
      legacyReadOnly: false,
    });
  });

  it("renders both historical and current requirement evidence event shapes", () => {
    const common = {
      id: randomUUID(),
      caseId: randomUUID(),
      sequence: 2,
      eventType: "requirement_evidence_changed" as const,
      actorType: "owner" as const,
      createdAt: "2026-08-11T08:00:00.000Z",
    };
    const historical: ApplicationCaseEventReadModel = {
      ...common,
      eventData: {
        schemaVersion: "case-event-v1",
        requirementSetId: randomUUID(),
        requirementId: "requirement-1",
        evidenceRevisionId: randomUUID(),
        evidenceIds: ["evidence-1"],
        action: "linked",
      },
    };
    const current: ApplicationCaseEventReadModel = {
      ...common,
      id: randomUUID(),
      eventData: {
        schemaVersion: "case-event-v2",
        requirementSetId: randomUUID(),
        requirementId: "requirement-1",
        evidenceRevisionId: randomUUID(),
        linkedEvidenceIds: [],
        removedEvidenceIds: ["evidence-1"],
      },
    };

    expect(toApplicationCaseEventView(historical).detail).toContain("新增 1 条，移除 0 条");
    expect(toApplicationCaseEventView(current).detail).toContain("新增 0 条，移除 1 条");
  });

  it("keeps legacy timeline rows explicitly read-only", () => {
    const event: ApplicationCaseEventReadModel = {
      id: randomUUID(),
      caseId: randomUUID(),
      sequence: 1,
      eventType: "stage_transitioned",
      actorType: "system",
      eventData: { old: "payload" },
      createdAt: "2026-08-11T08:00:00.000Z",
      legacyReadOnly: true,
    };
    expect(toApplicationCaseEventView(event)).toMatchObject({
      title: "历史求职记录",
      legacyReadOnly: true,
    });
  });
});
