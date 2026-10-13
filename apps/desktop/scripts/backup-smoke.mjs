/** Exercise real backup/import IPC on fixture data, with only native dialogs supplied by the harness. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../.."),
  require = createRequire(path.join(root, "apps/platform/package.json"));
const { _electron } = require("playwright-core"),
  out = path.join(root, ".data/local-productization-20261013"),
  source = path.join(root, ".data/desktop-smoke-20261013"),
  target = path.join(root, ".data/desktop-smoke-restored-" + Date.now());
const backups = path.join(out, "backup-roundtrip");
await mkdir(backups, { recursive: true });
const fixture = JSON.parse(await readFile(path.join(out, "desktop-docx/result.json"), "utf8"));
const packaged = process.env.AIJOB_SMOKE_EXECUTABLE;
const launch = (dataRoot) =>
  _electron.launch({
    executablePath:
      packaged ?? path.join(root, "apps/desktop/node_modules/electron/dist/electron.exe"),
    args: packaged ? [] : [path.join(root, "apps/desktop")],
    env: {
      ...process.env,
      PATH: path.join(process.env.SystemRoot, "System32"),
      AIJOB_DESKTOP_DATA_ROOT: dataRoot,
      AIJOB_DESKTOP_TEST_HIDDEN: "1",
    },
    timeout: 180000,
  });
async function ready(instance) {
  const page = await instance.firstWindow();
  await page.waitForURL(/\/(today|settings\/ai)$/, { timeout: 180000 });
  return page;
}
async function snapshot(page) {
  return page.evaluate(async ({ documentId, artifactId }) => {
    const read = async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw Error(`Snapshot failed ${response.status}`);
      return response;
    };
    const session = await (await read("/v1/session")).json(),
      draft = await (await read(`/v2/resume-documents/${documentId}/native`)).json(),
      file = await (await read(`/v2/resume-exports/${artifactId}/file`)).arrayBuffer();
    return { owner: session.owner.id, draft, file: Array.from(new Uint8Array(file)) };
  }, fixture);
}
async function invokeAndClose(instance, page, method, directory) {
  await instance.evaluate(({ app, dialog }, directory) => {
    app.relaunch = () => {};
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    dialog.showMessageBox = async (_window, options) => {
      if (options.type === "error") throw Error(options.message + ": " + options.detail);
      return { response: 1, checkboxChecked: false };
    };
  }, directory);
  const closed = instance.waitForEvent("close", { timeout: 180000 });
  const invoked = page
    .evaluate((method) => window.aijobDesktop[method](), method)
    .catch((error) => {
      if (/closed|destroyed/i.test(error.message)) return closed;
      throw error;
    });
  await Promise.race([closed, invoked]);
  await closed;
}
let instance;
try {
  instance = await launch(source);
  const page = await ready(instance),
    before = await snapshot(page);
  await invokeAndClose(instance, page, "exportBackup", backups);
  instance = null;
  const entries = (await readdir(backups))
      .filter((name) => name.startsWith("Aijob-backup-"))
      .sort(),
    backup = path.join(backups, entries.at(-1));
  assert.ok((await readFile(path.join(backup, "key.dpapi"), "utf8")).startsWith("AIJOB-DPAPI-1\n"));
  instance = await launch(target);
  const empty = await ready(instance);
  await invokeAndClose(instance, empty, "importBackup", backup);
  instance = null;
  const active = JSON.parse(await readFile(path.join(target, "active-workspace.json"), "utf8"));
  assert.ok(active.directory.startsWith(path.join(target, "workspaces") + path.sep));
  instance = await launch(target);
  const restored = await ready(instance),
    after = await snapshot(restored);
  assert.equal(after.owner, before.owner);
  assert.deepEqual(after.draft, before.draft);
  assert.deepEqual(after.file, before.file);
  const evidence = {
    at: new Date().toISOString(),
    packaged: !!packaged,
    backupRestored: true,
    independentProfile: true,
    sameOwner: true,
    draftUnchanged: true,
    encryptedPdfReadable: true,
    fileSha256: createHash("sha256").update(Buffer.from(after.file)).digest("hex"),
    dataRoot: target,
  };
  await writeFile(path.join(out, "backup-smoke.json"), JSON.stringify(evidence, null, 2));
  console.info("BACKUP_RESTORE_SMOKE_OK");
} finally {
  if (instance) {
    const closed = instance.waitForEvent("close", { timeout: 60000 });
    await instance.evaluate(({ app }) => app.quit());
    await closed;
  }
}
