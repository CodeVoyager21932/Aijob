/** Source selection + legacy migration services on the restored, isolated fixture database. No network. */
import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { LocalRuntime } from "../src/runtime.mjs";
import { readProtectedFile, writeProtectedFile } from "../src/protected-store.mjs";
import { inspectLegacy, createLegacyBackup, bindRestoredOwner } from "../src/legacy-import.mjs";
const root = path.resolve(import.meta.dirname, "../../.."),
  out = path.join(root, ".data/local-productization-20261013");
const previous = JSON.parse(await readFile(path.join(out, "backup-smoke.json"), "utf8"));
assert.ok(previous.dataRoot.startsWith(path.join(root, ".data/desktop-smoke-restored-")));
const active = JSON.parse(
  await readFile(path.join(previous.dataRoot, "active-workspace.json"), "utf8"),
);
const resourceRoot = path.join(root, ".data/desktop-bundle-20261013");
function runtimeAt(dataRoot) {
  const file = path.join(dataRoot, "credentials.dpapi");
  return new LocalRuntime({
    dataRoot,
    resourceRoot,
    readSecret: () => readProtectedFile(file),
    writeSecret: (v) => writeProtectedFile(file, v),
  });
}
const original = runtimeAt(active.directory),
  fixtureRoot = path.join(root, ".data/desktop-legacy-fixture-" + Date.now()),
  candidate = runtimeAt(path.join(fixtureRoot, "restored"));
await mkdir(fixtureRoot, { recursive: true });
try {
  await original.startDatabaseOnly();
  const catalog = await original.sources(),
    sourceKeys = catalog.sources.map((s) => s.sourceKey);
  assert.equal(sourceKeys.length, 2);
  const enabled = await original.sources({ sourceKeys, enabled: true, confirmed: true });
  assert.equal(enabled.enabled, true);
  assert.deepEqual(enabled.selected, sourceKeys);
  await original.sources({ sourceKeys, enabled: false, confirmed: true });
  await mkdir(path.join(fixtureRoot, ".data"), { recursive: true });
  await cp(path.join(resourceRoot, "config"), path.join(fixtureRoot, "config"), {
    recursive: true,
  });
  await writeFile(
    path.join(fixtureRoot, ".env"),
    `DATABASE_URL=${original.url("aijob_admin")}\nRESUME_ENCRYPTION_KEY=${original.secret.masterKey}\n`,
  );
  const legacy = await inspectLegacy(original, fixtureRoot),
    owner = legacy.owners.find((o) => o.resumes > 0);
  assert.ok(owner);
  const backup = path.join(fixtureRoot, "backup");
  await createLegacyBackup(original, legacy, backup, owner.id, writeProtectedFile);
  const key = await readProtectedFile(path.join(backup, "key.dpapi"));
  assert.equal(key.legacyOwnerId, owner.id);
  await candidate.start({
    restore: { ...key, dump: path.join(backup, "aijob.dump") },
    startServices: false,
  });
  await bindRestoredOwner(candidate, owner.id);
  await candidate.startWeb();
  const restored = await candidate.identity({ credential: candidate.secret.deviceCredential });
  assert.equal(restored.session.context.ownerId, owner.id);
  const counts = await candidate.pgCommand("psql", [
    "-At",
    "-c",
    `SELECT count(*)::int FROM profile.resume_documents WHERE owner_id='${owner.id}'::uuid AND deleted_at IS NULL`,
  ]);
  assert.equal(Number(counts.trim()), owner.resumes);
  assert.equal(candidate.secret.masterKey, original.secret.masterKey);
  await writeFile(
    path.join(out, "legacy-smoke.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        reviewedSourceSelection: true,
        sourceCount: 2,
        networkRequests: 0,
        legacyReadAndBackup: true,
        restoredOwner: true,
        resumeCount: owner.resumes,
        masterKeyPreserved: true,
        originalDatabasePreserved: true,
      },
      null,
      2,
    ),
  );
  console.info("LEGACY_AND_SOURCE_SELECTION_OK");
} finally {
  await candidate.stop().catch(() => {});
  await original.stop().catch(() => {});
  await rm(path.join(fixtureRoot, ".env"), { force: true });
}
