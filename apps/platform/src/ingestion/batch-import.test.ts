import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { normalizeBatchSourceKeys, runBatchImport } from "./batch-import.js";
import type { ProbeResult, ProbeRuntimeConfig } from "./probe.js";

const runtime: ProbeRuntimeConfig = {
  appEnv: "local",
  enableSourceProbe: true,
  snapshotDir: ".data/job-snapshots",
  probeRequestIntervalMs: 2_000,
};

const db = {} as Kysely<Database>;

function probeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    reused: false,
    taskId: "task",
    runId: "run",
    completion: "partial",
    discoveredCount: 2,
    normalizedCount: 2,
    rejectedCount: 0,
    errors: [],
    ...overrides,
  };
}

describe("batch source import", () => {
  it("normalizes and sorts distinct source keys", () => {
    expect(
      normalizeBatchSourceKeys([
        " zhaopin-wuhan-internships ",
        "guanggu-venture-internships",
        "zhaopin-wuhan-internships",
      ]),
    ).toEqual(["guanggu-venture-internships", "zhaopin-wuhan-internships"]);
  });

  it("requires explicit live approval before touching a source", async () => {
    await expect(
      runBatchImport({
        db,
        runtime,
        sourceKeys: ["guanggu-venture-internships"],
      }),
    ).rejects.toThrow("SOURCE_BATCH_LIVE_APPROVAL_REQUIRED");
  });

  it("runs deterministic sources with each source budget and materializes once", async () => {
    const calls: Array<[string, number]> = [];
    const result = await runBatchImport({
      db,
      runtime,
      enableLocalMvp: true,
      sourceKeys: ["zhaopin-wuhan-internships", "guanggu-venture-internships"],
      liveProbeApproved: true,
      dependencies: {
        runProbe: async ({ sourceKey, limit }) => {
          calls.push([sourceKey, limit]);
          return probeResult({ normalizedCount: limit, discoveredCount: limit });
        },
        materialize: async () => ({
          materializedRevisions: 6,
          createdVersions: 2,
          createdRequirementSets: 2,
          suspectedDuplicatePairs: 0,
          quotaSelectedJobs: 2,
          quotaSuppressedJobs: 0,
        }),
      },
    });

    expect(calls).toEqual([
      ["guanggu-venture-internships", 2],
      ["zhaopin-wuhan-internships", 4],
    ]);
    expect(result.normalizedCount).toBe(6);
    expect(result.items.map((item) => item.state)).toEqual(["ran", "ran"]);
    expect(result.materialization?.createdVersions).toBe(2);
  });

  it("keeps browser and paused sources out of the automatic lane", async () => {
    let calls = 0;
    const result = await runBatchImport({
      db,
      runtime,
      enableLocalMvp: false,
      sourceKeys: ["bytedance-campus-manual", "byfunds-internships"],
      liveProbeApproved: true,
      dependencies: {
        runProbe: async () => {
          calls += 1;
          return probeResult();
        },
      },
    });

    expect(calls).toBe(0);
    expect(Object.fromEntries(result.items.map((item) => [item.sourceKey, item.reason]))).toEqual({
      "byfunds-internships": "SOURCE_POLICY_NOT_PROBE_AUTHORIZED",
      "bytedance-campus-manual": "BROWSER_FALLBACK_REQUIRED",
    });
  });

  it("opens the batch circuit after three independent transport failures", async () => {
    const attempted: string[] = [];
    const result = await runBatchImport({
      db,
      runtime,
      enableLocalMvp: false,
      sourceKeys: [
        "guanggu-venture-internships",
        "xiaoyong-zju-internships",
        "zhaopin-wuhan-internships",
        "supvan-info-internships",
      ],
      liveProbeApproved: true,
      dependencies: {
        runProbe: async ({ sourceKey }) => {
          attempted.push(sourceKey);
          return probeResult({
            completion: "failed",
            normalizedCount: 0,
            errors: [{ code: "ECONNRESET", message: "reset" }],
          });
        },
      },
    });

    expect(attempted).toHaveLength(3);
    expect(result.stoppedByTransportCircuit).toBe(true);
    expect(result.items.at(-1)).toMatchObject({
      sourceKey: "zhaopin-wuhan-internships",
      state: "skipped",
      reason: "GLOBAL_TRANSPORT_CIRCUIT_OPEN",
    });
  });
});
