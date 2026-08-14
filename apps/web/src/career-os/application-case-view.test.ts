import { randomUUID } from "node:crypto";
import type { ApplicationCaseWithJobContext } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { compareCaseDeadline, toApplicationCaseView } from "./application-case-view";

function privateCase(): ApplicationCaseWithJobContext {
  const ownerId = randomUUID();
  return {
    id: randomUUID(),
    ownerId,
    ownerEpoch: 1,
    jobContext: {
      kind: "private",
      snapshotId: randomUUID(),
      ownerId,
      title: "用户私有岗位",
      companyName: null,
      sourceLabel: "来源未提供，请自行核验",
      contentRevision: 1,
      requirementSetRevision: 1,
      sourceProvided: false,
    },
    jobDisplay: {
      title: "用户私有岗位",
      companyName: null,
      locations: { state: "unknown", reason: "source_not_stated" },
      workMode: { state: "unknown", reason: "source_not_stated" },
      deadlineAt: { state: "unknown", reason: "source_not_stated" },
      source: {
        kind: "owner_private",
        displayName: "来源未提供，请自行核验",
        sourceProvided: false,
        verified: false,
      },
    },
    stage: "interested",
    outcome: null,
    revision: 1,
    endedAt: null,
    deletedAt: null,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

describe("Career OS application Case view model", () => {
  it("keeps private unknown fields and provenance honest", () => {
    expect(toApplicationCaseView(privateCase())).toMatchObject({
      companyName: "公司未说明",
      locationLabel: "未说明",
      locationValues: [],
      workModeLabel: "未说明",
      deadlineAt: null,
      deadlineLabel: "未说明",
      sourceLabel: "来源未提供，请自行核验",
      sourceKind: "owner_private",
      externalUrl: null,
      externalUrlVerified: false,
      outcome: null,
      revision: 1,
    });
  });

  it("sorts unknown deadlines after known deadlines", () => {
    const unknown = toApplicationCaseView(privateCase());
    const known = {
      ...unknown,
      id: randomUUID(),
      deadlineAt: "2026-08-18T00:00:00.000Z",
      deadlineLabel: "2026-08-18",
    };
    expect([unknown, known].sort(compareCaseDeadline).map((item) => item.id)).toEqual([
      known.id,
      unknown.id,
    ]);
  });
});
