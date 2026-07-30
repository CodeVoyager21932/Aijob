import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { storeSnapshot } from "./snapshot-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("snapshot store", () => {
  it("uses a deterministic content-addressed key and verifies repeat writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aijob-snapshot-"));
    temporaryDirectories.push(directory);
    const body = new TextEncoder().encode('{"status":0,"data":{"count":1}}');

    const first = await storeSnapshot(directory, "tencent-campus", body, "application/json");
    const second = await storeSnapshot(directory, "tencent-campus", body, "application/json");

    expect(second.contentHash).toBe(first.contentHash);
    expect(second.objectKey).toBe(first.objectKey);
    expect(second.storedByteSize).toBe(first.storedByteSize);
    expect((await readFile(first.absolutePath)).byteLength).toBe(first.storedByteSize);
  });
});
