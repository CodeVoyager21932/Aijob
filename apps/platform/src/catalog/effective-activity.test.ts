import type { JsonValue } from "@aijob/database";
import { describe, expect, it } from "vitest";
import { isDeadlineClosed, resolveEffectiveActivity } from "./effective-activity.js";

function knownDeadline(value: string): JsonValue {
  return {
    state: "known",
    value,
    evidenceRefs: ["revision#deadline"],
  };
}

describe("effective job activity", () => {
  it("keeps a Shanghai date-only deadline active through its final local day", () => {
    const deadline = knownDeadline("2026-07-31");

    expect(isDeadlineClosed(deadline, new Date("2026-07-31T15:59:59.999Z"))).toBe(false);
    expect(isDeadlineClosed(deadline, new Date("2026-07-31T16:00:00.000Z"))).toBe(true);
  });

  it("derives the Shanghai calendar day from an offset timestamp", () => {
    const deadline = knownDeadline("2026-07-31T20:00:00-04:00");

    expect(isDeadlineClosed(deadline, new Date("2026-08-01T15:59:59.999Z"))).toBe(false);
    expect(isDeadlineClosed(deadline, new Date("2026-08-01T16:00:00.000Z"))).toBe(true);
  });

  it("applies closed-state precedence in the required order", () => {
    expect(
      resolveEffectiveActivity({
        sourceRevisionState: "closed",
        absenceState: "closed",
        deadline: knownDeadline("2026-07-30"),
        now: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).toEqual({ state: "closed", reason: "source_revision_closed" });

    expect(
      resolveEffectiveActivity({
        sourceRevisionState: "uncertain",
        absenceState: "closed",
        deadline: knownDeadline("2026-07-30"),
        now: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).toEqual({ state: "closed", reason: "deadline_elapsed" });

    expect(
      resolveEffectiveActivity({
        sourceRevisionState: "uncertain",
        absenceState: "closed",
        deadline: knownDeadline("2026-08-02"),
        now: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).toEqual({ state: "closed", reason: "absence_closed" });
  });

  it("returns uncertain when either non-closed projection is uncertain", () => {
    expect(
      resolveEffectiveActivity({
        sourceRevisionState: "uncertain",
        absenceState: "active",
        now: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).toEqual({ state: "uncertain", reason: "source_or_absence_uncertain" });

    expect(
      resolveEffectiveActivity({
        sourceRevisionState: "active",
        absenceState: "uncertain",
        now: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).toEqual({ state: "uncertain", reason: "source_or_absence_uncertain" });
  });

  it("ignores unknown, conflicting, and invalid deadline fields", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const deadlines: JsonValue[] = [
      { state: "unknown", reason: "source_not_stated" },
      { state: "conflict", rawValues: ["2026-07-30", "2026-07-31"], evidenceRefs: [] },
      knownDeadline("2026-02-30"),
      knownDeadline("2026-07-31T23:59:59"),
    ];

    for (const deadline of deadlines) {
      expect(
        resolveEffectiveActivity({
          sourceRevisionState: "active",
          absenceState: "active",
          deadline,
          now,
        }),
      ).toEqual({ state: "active", reason: "active" });
    }
  });
});
