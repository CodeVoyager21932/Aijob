import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(path.join(root, "apps/platform/package.json"));
const { _electron: electron } = require("playwright-core");
const evidence = path.join(root, ".data/local-productization-20261013");
await mkdir(evidence, { recursive: true });
const dataRoot = path.resolve(
  process.env.AIJOB_SMOKE_DATA_ROOT ?? path.join(root, ".data/desktop-smoke-20261013"),
);
assert.ok(
  dataRoot.startsWith(path.join(root, ".data/desktop-smoke-")),
  "Isolated desktop fixture directory required",
);
const packaged = process.env.AIJOB_SMOKE_EXECUTABLE;
const executablePath =
  packaged ?? path.join(root, "apps/desktop/node_modules/electron/dist/electron.exe");
let startupErrors = "";
const launch = async () => {
  const instance = await electron.launch({
    executablePath,
    args: packaged ? [] : [path.join(root, "apps/desktop")],
    env: {
      ...process.env,
      PATH: path.join(process.env.SystemRoot, "System32"),
      AIJOB_DESKTOP_DATA_ROOT: dataRoot,
      AIJOB_DESKTOP_TEST_HIDDEN: "1",
    },
    timeout: 180000,
  });
  instance.process().stderr.on("data", (chunk) => {
    startupErrors = (startupErrors + chunk.toString())
      .replace(/postgres(?:ql)?:\/\/\S+/g, "[database]")
      .replace(/[a-f0-9]{64}/gi, "[secret]")
      .slice(-4000);
  });
  return instance;
};
async function ready(instance) {
  const page = await instance.firstWindow();
  await page.waitForURL(/\/(settings\/ai|today)$/, { timeout: 180000 });
  await page.waitForLoadState("networkidle");
  return page;
}
async function quit(instance) {
  const closed = instance.waitForEvent("close", { timeout: 60000 });
  await instance.evaluate(({ app }) => {
    app.quit();
  });
  await closed;
}
let instance;
try {
  instance = await launch();
  const page = await ready(instance);
  await page.goto(new URL("/settings/ai", page.url()).href);
  await page.getByRole("heading", { name: "连接与运行", exact: true }).waitFor();
  console.info((await page.locator("main").innerText()).slice(0, 3800));
  const first = await page.evaluate(async () => {
    const response = await fetch("/v1/session");
    return response.json();
  });
  assert(first.authenticated);
  const state = await page.evaluate(() => window.aijobDesktop.status());
  assert.equal(state.phase, "ready");
  assert.equal(state.autostart, false);
  const catalog = await page.evaluate(() => window.aijobDesktop.sources());
  assert.equal(catalog.sources.length, 2);
  assert.equal(catalog.enabled, false);
  await page.context().clearCookies();
  await instance.evaluate(async ({ session }) => {
    await session.defaultSession.cookies.flushStore();
  });
  await quit(instance);
  instance = null;
  const pgPath = path.join(root, ".data/desktop-bundle-20261013/postgresql/bin/pg_ctl.exe");
  let stopped = false;
  try {
    execFileSync(pgPath, ["status", "-D", path.join(dataRoot, "postgres")], {
      windowsHide: true,
      stdio: "pipe",
    });
  } catch {
    stopped = true;
  }
  assert(stopped);
  instance = await launch();
  const reopened = await ready(instance);
  const second = await reopened.evaluate(async () => {
    const response = await fetch("/v1/session");
    return response.json();
  });
  assert.equal(second.owner.id, first.owner.id);
  const config = JSON.parse(await readFile(path.join(dataRoot, "runtime.json"), "utf8"));
  await writeFile(
    path.join(evidence, packaged ? "installed-desktop-smoke.json" : "desktop-smoke.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        packaged: !!packaged,
        ready: true,
        sameOwnerAfterCookieLoss: true,
        postgresStoppedOnQuit: stopped,
        systemRuntimePathRemoved: true,
        apiPort: config.apiPort,
        sourceCatalogSize: catalog.sources.length,
      },
      null,
      2,
    ),
  );
  console.info("DESKTOP_SMOKE_PASSED");
} catch (error) {
  console.error(startupErrors);
  throw error;
} finally {
  if (instance) await quit(instance).catch(() => instance.close());
}
