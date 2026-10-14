import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  acquireOperationLock,
  identifyRoles,
  missingRoles,
  ownedProcesses,
} from "./local-workspace.mjs";

const workspace = "C:\\Users\\coco\\Aijob";
const process = (pid, roles, created = "2026-10-14T01:00:00Z") => ({ pid, roles, created });
test("combined dev and individually started services are both reused", () => {
  const combined = identifyRoles(
    'node "C:\\Users\\coco\\Aijob\\node_modules\\tsx\\dist\\cli.mjs" watch src/dev.ts',
    workspace,
  );
  assert.deepEqual(combined, ["api", "match", "collector"]);
  assert.deepEqual(
    missingRoles({ processes: [process(1, combined)], ports: [{ port: 3000, pid: 1 }] }),
    ["web"],
  );
  assert.deepEqual(
    missingRoles({
      processes: [process(1, ["web"]), process(2, ["api"]), process(3, ["match"])],
      ports: [{ port: 5173, pid: 1 }],
    }),
    ["collector"],
  );
  assert.deepEqual(missingRoles({ processes: [process(1, [...combined, "web"])], ports: [] }), []);
  assert.deepEqual(missingRoles({ processes: [], ports: [] }), [
    "api",
    "match",
    "collector",
    "web",
  ]);
});
test("another checkout or foreign port cannot be adopted as this workspace", () => {
  assert.deepEqual(
    identifyRoles("node C:/other/Aijob/node_modules/tsx/dist/cli.mjs src/dev.ts", workspace),
    [],
  );
  assert.deepEqual(
    identifyRoles(
      "node C:/Users/coco/Aijob-copy/node_modules/tsx/dist/cli.mjs src/dev.ts",
      workspace,
    ),
    [],
  );
  assert.throws(
    () => missingRoles({ processes: [process(99, [])], ports: [{ port: 3000, pid: 99 }] }),
    /端口 3000/,
  );
});
test("stop only selects saved process identities, not reused PIDs or external workers", () => {
  const records = [
    { pid: 1, role: "match", created: "old" },
    { pid: 2, role: "web", created: "same" },
  ];
  assert.deepEqual(
    ownedProcesses(records, [
      process(1, ["match"], "new"),
      process(2, ["web"], "same"),
      process(3, ["collector"]),
    ]),
    [records[1]],
  );
});

test("concurrent launch is refused and a lock from an exited process can be recovered", () => {
  const directory = mkdtempSync(join(tmpdir(), "aijob-launcher-lock-"));
  const lock = join(directory, "operation.lock");
  try {
    const release = acquireOperationLock(lock);
    assert.throws(() => acquireOperationLock(lock), /另一项启动\/停止操作/);
    release();
    assert.equal(existsSync(lock), false);
    writeFileSync(lock, "12345");
    const releaseRecovered = acquireOperationLock(lock, () => {
      throw Object.assign(new Error("fixture process has exited"), { code: "ESRCH" });
    });
    releaseRecovered();
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
