import type { Database } from "@aijob/database";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import {
  disableLocalSourceRefresh,
  enableLocalSourceRefresh,
  getLocalSourceRefreshStatus,
  requestLocalSourceRefresh,
  runLocalSourceRefreshOnce,
} from "./source-refresh-operations.js";

const db = {} as Kysely<Database>;

describe("local source refresh operations", () => {
  it("waits for the collector barrier after disabling the local switch", async () => {
    const events: string[] = [];
    const control = await disableLocalSourceRefresh({
      db,
      appEnv: "local",
      workspaceRoot: "C:/workspace",
      now: new Date("2026-08-01T00:00:00.000Z"),
      dependencies: {
        writeLocalRefreshControl: (input) => {
          events.push(input.enabled ? "enable" : "disable");
          return {
            version: 1,
            enabled: input.enabled,
            updatedAt: "2026-08-01T00:00:00.000Z",
          };
        },
        waitForCollectorIdle: async () => {
          events.push("idle");
        },
      },
    });

    expect(events).toEqual(["disable", "idle"]);
    expect(control.enabled).toBe(false);
  });

  it("keeps the switch disabled when any enabled source fails to register", async () => {
    const events: string[] = [];
    const writeControl = vi.fn((input: { enabled: boolean }) => {
      events.push(input.enabled ? "enable" : "disable");
      return {
        version: 1 as const,
        enabled: input.enabled,
        updatedAt: "2026-08-01T00:00:00.000Z",
      };
    });

    await expect(
      enableLocalSourceRefresh({
        db,
        appEnv: "local",
        workspaceRoot: "C:/workspace",
        dependencies: {
          listSourceKeys: async () => ["shining3d-internships", "onerobotics-internships"],
          waitForCollectorIdle: async () => {
            events.push("idle");
          },
          registerSourceConfig: async (_db, config) => {
            events.push(config.sourceKey);
            if (config.sourceKey === "onerobotics-internships") {
              throw new Error("REGISTRATION_FAILED");
            }
            return {
              organizationId: "organization",
              sourceCandidateId: "candidate",
              sourceId: "source",
              policyVersion: config.policy.version,
            };
          },
          writeLocalRefreshControl: writeControl,
        },
      }),
    ).rejects.toThrow("REGISTRATION_FAILED");

    expect(events).toEqual(["disable", "idle", "shining3d-internships", "onerobotics-internships"]);
    expect(writeControl).toHaveBeenCalledOnce();
    expect(writeControl).toHaveBeenCalledWith({
      rootDirectory: "C:/workspace",
      enabled: false,
    });
  });

  it("stably spreads due deterministic sources before enabling the local switch", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const events: string[] = [];
    const staggerDue = vi.fn(async () => {
      events.push("stagger");
      return [
        {
          sourceKey: "shining3d-internships",
          offsetMilliseconds: 1_000,
          nextDueAt: "2026-08-01T00:00:01.000Z",
        },
      ];
    });

    const result = await enableLocalSourceRefresh({
      db,
      appEnv: "local",
      workspaceRoot: "C:/workspace",
      staggerHours: 24,
      now,
      dependencies: {
        listSourceKeys: async () => [
          "shining3d-internships",
          "onerobotics-internships",
          "bytedance-campus-manual",
        ],
        waitForCollectorIdle: async () => {
          events.push("idle");
        },
        registerSourceConfig: async (_db, config) => {
          events.push(config.sourceKey);
          return {
            organizationId: `${config.sourceKey}-organization`,
            sourceCandidateId: `${config.sourceKey}-candidate`,
            sourceId: `${config.sourceKey}-source`,
            policyVersion: config.policy.version,
          };
        },
        staggerDueSourceRefreshes: staggerDue,
        writeLocalRefreshControl: (input) => {
          events.push(input.enabled ? "enable" : "disable");
          return { version: 1, enabled: input.enabled, updatedAt: now.toISOString() };
        },
      },
    });

    expect(staggerDue).toHaveBeenCalledWith({
      db,
      staggerHours: 24,
      now,
      sources: [
        {
          sourceId: "shining3d-internships-source",
          sourceKey: "shining3d-internships",
          policyVersion: 3,
          refreshCoverage: "full_scope",
        },
        {
          sourceId: "onerobotics-internships-source",
          sourceKey: "onerobotics-internships",
          policyVersion: 2,
          refreshCoverage: "full_scope",
        },
      ],
    });
    expect(events[0]).toBe("disable");
    expect(events[1]).toBe("idle");
    expect(events.at(-2)).toBe("stagger");
    expect(events.at(-1)).toBe("enable");
    expect(result).toMatchObject({
      staggerHours: 24,
      staggeredSources: [{ sourceKey: "shining3d-internships" }],
    });
  });

  it("rejects an invalid stagger window before registering sources", async () => {
    const listKeys = vi.fn();
    await expect(
      enableLocalSourceRefresh({
        db,
        appEnv: "local",
        workspaceRoot: "C:/workspace",
        staggerHours: 25,
        dependencies: { listSourceKeys: listKeys },
      }),
    ).rejects.toThrow("SOURCE_REFRESH_STAGGER_HOURS_OUT_OF_RANGE");
    expect(listKeys).not.toHaveBeenCalled();
  });

  it("does not schedule an immediate run while the local switch is disabled", async () => {
    const request = vi.fn();
    await expect(
      requestLocalSourceRefresh({
        db,
        appEnv: "local",
        workspaceRoot: "C:/workspace",
        sourceKey: "shining3d-internships",
        dependencies: {
          readLocalRefreshControl: () => ({
            version: 1,
            enabled: false,
            updatedAt: "1970-01-01T00:00:00.000Z",
          }),
          requestImmediateSourceRefresh: request,
        },
      }),
    ).rejects.toThrow("SOURCE_REFRESH_DISABLED");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not bypass a source automation pause", async () => {
    const request = vi.fn(async () => {
      throw new Error("SOURCE_AUTOMATION_PAUSED");
    });
    await expect(
      requestLocalSourceRefresh({
        db,
        appEnv: "local",
        workspaceRoot: "C:/workspace",
        sourceKey: "shining3d-internships",
        dependencies: {
          readLocalRefreshControl: () => ({
            version: 1,
            enabled: true,
            updatedAt: "2026-08-01T00:00:00.000Z",
          }),
          requestImmediateSourceRefresh: request,
        },
      }),
    ).rejects.toThrow("SOURCE_AUTOMATION_PAUSED");
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not schedule a source disabled by the current configuration", async () => {
    const request = vi.fn();
    await expect(
      requestLocalSourceRefresh({
        db,
        appEnv: "local",
        workspaceRoot: "C:/workspace",
        sourceKey: "allwinner-gdut-internships",
        dependencies: {
          readLocalRefreshControl: () => ({
            version: 1,
            enabled: true,
            updatedAt: "2026-08-01T00:00:00.000Z",
          }),
          requestImmediateSourceRefresh: request,
        },
      }),
    ).rejects.toThrow("SOURCE_SCHEDULED_REFRESH_NOT_AUTHORIZED");
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps status read-only and includes the local control state", async () => {
    const status = await getLocalSourceRefreshStatus({
      db,
      appEnv: "local",
      workspaceRoot: "C:/workspace",
      dependencies: {
        listSourceKeys: async () => ["manual-source"],
        readLocalRefreshControl: () => ({
          version: 1,
          enabled: true,
          updatedAt: "2026-08-01T00:00:00.000Z",
        }),
        loadSourceRefreshStatus: async (_db, _sourceKeys) => ({
          scheduler: {
            enabledDeterministicSources: 0,
            maximumSourceStartsPerHour: 3,
            mode: "legacy",
          },
          circuit: { openUntil: null, reason: null },
          sources: [
            {
              sourceKey: "manual-source",
              policyStatus: "pending_review",
              refreshCoverage: "manual_snapshot",
              crawlInterval: "168h",
              freshnessState: "due",
              automationPaused: false,
              automationPauseReason: null,
              manualSnapshotRequired: true,
              lastSuccessfulRunAt: null,
              nextDueAt: "2026-08-01T00:00:00.000Z",
              jobCount: 2,
              lastCompletion: "partial",
              lastErrorCode: null,
            },
          ],
        }),
        // ADR-0035 第三条：状态报告一并报出 `stableIdentityAndFields` 的达标进度，因此这里也要
        // 打桩。判据本身在 `source-contract-stability.test.ts` 覆盖。
        loadSourceContractStability: async (_db, _sourceKeys) => ({
          sources: [
            {
              sourceKey: "manual-source",
              status: "pending" as const,
              acceptedRunCount: 1,
              qualifyingRunCount: 1,
              observationSpanHours: null,
              shortfalls: ["needs_2_more_qualifying_refreshes"],
            },
          ],
          persistence: {
            status: "pending" as const,
            persistentSourceCount: 0,
            persistentSourceKeys: [],
            shortfalls: ["needs_3_more_persistent_sources"],
          },
        }),
      },
    });

    expect(status.scheduler.enabledDeterministicSources).toBe(0);
    expect(status.control.enabled).toBe(true);
    expect(status.sources[0]).toMatchObject({
      jobCount: 2,
      manualSnapshotRequired: true,
    });
    expect(status.contractStability.sources[0]).toMatchObject({
      sourceKey: "manual-source",
      status: "pending",
      shortfalls: ["needs_2_more_qualifying_refreshes"],
    });
    expect(status.contractStability.persistence.status).toBe("pending");
  });

  it("requires explicit live confirmation for a synchronous refresh", async () => {
    const loadSourceConfig = vi.fn();
    await expect(
      runLocalSourceRefreshOnce({
        db,
        appEnv: "local",
        workspaceRoot: "C:/workspace",
        sourceKey: "shining3d-internships",
        liveProbeApproved: false,
        workerConfig: {
          appEnv: "local",
          enableSourceProbe: true,
          snapshotDir: "C:/workspace/.data/snapshots",
          probeRequestIntervalMs: 2_000,
          workspaceRoot: "C:/workspace",
        },
        dependencies: { loadSourceConfig },
      }),
    ).rejects.toThrow("SOURCE_REFRESH_LIVE_CONFIRMATION_REQUIRED");
    expect(loadSourceConfig).not.toHaveBeenCalled();
  });

  it("temporarily opens only the local gate and runs the requested source once", async () => {
    const events: string[] = [];
    const result = await runLocalSourceRefreshOnce({
      db,
      appEnv: "local",
      workspaceRoot: "C:/workspace",
      sourceKey: "shining3d-internships",
      liveProbeApproved: true,
      now: new Date("2026-08-03T08:00:00.000Z"),
      workerConfig: {
        appEnv: "local",
        enableSourceProbe: true,
        snapshotDir: "C:/workspace/.data/snapshots",
        probeRequestIntervalMs: 2_000,
        workspaceRoot: "C:/workspace",
      },
      dependencies: {
        readLocalRefreshControl: () => ({
          version: 1,
          enabled: false,
          updatedAt: "2026-08-03T07:00:00.000Z",
        }),
        writeLocalRefreshControl: (input) => {
          events.push(input.enabled ? "enable" : "disable");
          return {
            version: 1,
            enabled: input.enabled,
            updatedAt: "2026-08-03T08:00:00.000Z",
          };
        },
        waitForCollectorIdle: async () => {
          events.push("idle");
        },
        registerSourceConfig: async (_db, config) => {
          events.push(`register:${config.sourceKey}`);
          return {
            organizationId: "organization",
            sourceCandidateId: "candidate",
            sourceId: "source",
            policyVersion: config.policy.version,
          };
        },
        requestImmediateSourceRefresh: async ({ sourceKey }) => {
          events.push(`request:${sourceKey}`);
          return { sourceKey, scheduled: true, manualSnapshotRequired: false };
        },
        runOneCollectorCycle: async (input) => {
          events.push(`cycle:${input.sourceKeys?.join(",")}`);
          return { state: "ran", sourceKey: "shining3d-internships" };
        },
      },
    });

    expect(result).toMatchObject({ state: "ran", sourceKey: "shining3d-internships" });
    expect(events).toEqual([
      "register:shining3d-internships",
      "disable",
      "idle",
      "request:shining3d-internships",
      "enable",
      "cycle:shining3d-internships",
      "disable",
      "idle",
    ]);
  });
});
