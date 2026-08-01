import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLocalRefreshControl, writeLocalRefreshControl } from "./local-refresh-control.js";

describe("local source refresh control", () => {
  it("defaults to disabled and persists explicit enable or disable", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "aijob-refresh-control-"));
    try {
      expect(readLocalRefreshControl(rootDirectory).enabled).toBe(false);

      const enabled = writeLocalRefreshControl({
        rootDirectory,
        enabled: true,
        now: new Date("2026-08-01T00:00:00.000Z"),
      });
      expect(readLocalRefreshControl(rootDirectory)).toEqual(enabled);

      const disabled = writeLocalRefreshControl({
        rootDirectory,
        enabled: false,
        now: new Date("2026-08-01T01:00:00.000Z"),
      });
      expect(readLocalRefreshControl(rootDirectory)).toEqual(disabled);
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});
