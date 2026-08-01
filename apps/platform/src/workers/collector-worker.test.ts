import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { runCollectorWorker } from "./collector-worker.js";

describe("collector worker catalog reconciliation", () => {
  it("reconciles once per Shanghai date while disabled without a network run", async () => {
    const controller = new AbortController();
    const dates = [
      new Date("2026-08-01T15:59:59.000Z"),
      new Date("2026-08-01T16:00:00.000Z"),
      new Date("2026-08-01T16:00:01.000Z"),
    ];
    let dateIndex = 0;
    const materializeCatalog = vi.fn(async () => undefined);
    const cycleStates: string[] = [];
    const runCycle = vi.fn(async () => {
      if (runCycle.mock.calls.length === 3) controller.abort();
      return { state: "disabled" as const };
    });
    const onCycle = vi.fn((result: { state: string }) => {
      cycleStates.push(result.state);
    });

    await runCollectorWorker({
      db: {} as Kysely<Database>,
      config: {
        appEnv: "local",
        enableSourceProbe: true,
        snapshotDir: ".data/test-snapshots",
        probeRequestIntervalMs: 2_000,
        workspaceRoot: ".",
      },
      signal: controller.signal,
      scanIntervalMs: 0,
      onCycle,
      dependencies: {
        now: () => dates[Math.min(dateIndex++, dates.length - 1)] as Date,
        materializeCatalog,
        runCycle,
      },
    });

    expect(materializeCatalog).toHaveBeenCalledTimes(2);
    expect(runCycle).toHaveBeenCalledTimes(3);
    expect(onCycle).toHaveBeenCalledTimes(3);
    expect(cycleStates).toEqual(["disabled", "disabled", "disabled"]);
    expect(runCycle).toHaveBeenNthCalledWith(1, expect.objectContaining({ now: dates[0] }));
    expect(runCycle).toHaveBeenNthCalledWith(2, expect.objectContaining({ now: dates[1] }));
  });
});
