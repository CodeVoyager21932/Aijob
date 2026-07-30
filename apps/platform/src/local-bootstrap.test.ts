import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalBootstrapManifest } from "./local-bootstrap.js";

describe("local bootstrap manifest", () => {
  it("preflights ignored browser snapshots before any mutable work", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "aijob-bootstrap-"));
    await mkdir(join(workspaceRoot, ".data", "browser-imports"), { recursive: true });
    await writeFile(join(workspaceRoot, ".data", "browser-imports", "snapshot.json"), "{}", "utf8");
    await writeFile(
      join(workspaceRoot, ".data", "local-bootstrap.json"),
      JSON.stringify({
        schemaVersion: "aijob-local-bootstrap-v1",
        sources: [
          {
            sourceKey: "spirit-ai-feishu-manual",
            mode: "browser_snapshot",
            file: ".data/browser-imports/snapshot.json",
          },
        ],
        expectedCatalog: {
          totalSupply: 1,
          visible: 1,
          companies: 1,
          publicJobs: 0,
        },
      }),
      "utf8",
    );

    await expect(
      loadLocalBootstrapManifest({
        workspaceRoot,
        manifestPath: ".data/local-bootstrap.json",
      }),
    ).resolves.toMatchObject({
      manifest: {
        schemaVersion: "aijob-local-bootstrap-v1",
      },
    });
  });

  it("fails closed for a missing or escaping browser snapshot", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "aijob-bootstrap-"));
    await mkdir(join(workspaceRoot, ".data"), { recursive: true });
    const manifestPath = join(workspaceRoot, ".data", "local-bootstrap.json");
    const manifest = {
      schemaVersion: "aijob-local-bootstrap-v1",
      sources: [
        {
          sourceKey: "spirit-ai-feishu-manual",
          mode: "browser_snapshot",
          file: ".data/browser-imports/missing.json",
        },
      ],
      expectedCatalog: {
        totalSupply: 1,
        visible: 1,
        companies: 1,
        publicJobs: 0,
      },
    };
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await expect(loadLocalBootstrapManifest({ workspaceRoot, manifestPath })).rejects.toThrow(
      "LOCAL_BOOTSTRAP_SNAPSHOT_MISSING",
    );

    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        sources: [{ ...manifest.sources[0], file: ".data/other.json" }],
      }),
      "utf8",
    );
    await expect(loadLocalBootstrapManifest({ workspaceRoot, manifestPath })).rejects.toThrow(
      "LOCAL_BOOTSTRAP_SNAPSHOT_OUTSIDE_BROWSER_IMPORTS",
    );
  });
});
