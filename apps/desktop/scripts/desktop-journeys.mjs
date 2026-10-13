import { createRequire } from "node:module";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readProtectedFile } from "../src/protected-store.mjs";
const run = promisify(execFile),
  root = path.resolve(import.meta.dirname, "../../.."),
  require = createRequire(path.join(root, "apps/platform/package.json"));
const { _electron } = require("playwright-core"),
  out = path.join(root, ".data/local-productization-20261013"),
  dataRoot = path.join(root, ".data/desktop-smoke-20261013");
const instance = await _electron.launch({
  executablePath: path.join(root, "apps/desktop/node_modules/electron/dist/electron.exe"),
  args: [path.join(root, "apps/desktop")],
  env: {
    ...process.env,
    PATH: path.join(process.env.SystemRoot, "System32"),
    AIJOB_DESKTOP_DATA_ROOT: dataRoot,
    AIJOB_DESKTOP_TEST_HIDDEN: "1",
  },
  timeout: 120000,
});
try {
  const page = await instance.firstWindow();
  await page.waitForURL(/\/(today|settings\/ai)$/, { timeout: 120000 });
  const credentialFile = path.join(dataRoot, "credentials.dpapi");
  const encrypted = await readFile(credentialFile);
  const secret = {
    settings: JSON.parse(await readFile(path.join(dataRoot, "runtime.json"), "utf8")),
    key: encrypted.subarray(0, 14).toString().startsWith("AIJOB-DPAPI-1")
      ? await readProtectedFile(credentialFile)
      : await instance.evaluate(
          ({ safeStorage }, encrypted) =>
            JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, "base64"))),
          encrypted.toString("base64"),
        ),
  };
  const storage = path.join(out, "journey-cookies.json");
  await page.context().storageState({ path: storage });
  const env = {
    ...process.env,
    AIJOB_BROWSER_ORIGIN: new URL(page.url()).origin,
    AIJOB_BROWSER_EXECUTABLE: path.join(
      root,
      ".data/desktop-browsers/chromium-1243/chrome-win64/chrome.exe",
    ),
    AIJOB_BROWSER_STORAGE: storage,
    AIJOB_TEST_DESKTOP_DATA_ROOT: dataRoot,
    AIJOB_TEST_DATABASE_URL: `postgresql://aijob_admin:${secret.key.postgres}@127.0.0.1:${secret.settings.pgPort}/aijob`,
  };
  try {
    for (const [script, directory] of [
      ["browser-system-upgrade.mjs", "desktop-docx"],
      ["browser-opportunity-journey.mjs", "desktop-pdf-case"],
    ]) {
      if (process.env.AIJOB_JOURNEY_ONLY && process.env.AIJOB_JOURNEY_ONLY !== directory) continue;
      await mkdir(path.join(out, directory), { recursive: true });
      try {
        const result = await run(
          process.execPath,
          [path.join(root, "tools/resume-native", script)],
          {
            cwd: root,
            env: { ...env, AIJOB_BROWSER_OUTPUT: path.join(out, directory) },
            windowsHide: true,
            timeout: 240000,
            maxBuffer: 500000,
          },
        );
        await writeFile(path.join(out, directory, "run.log"), result.stdout + result.stderr);
        console.info(directory, result.stdout.trim().slice(-400));
      } catch (error) {
        await writeFile(
          path.join(out, directory, "run.log"),
          String(error.stdout) + String(error.stderr),
        );
        console.error(directory, "FAILED; see local run.log");
        throw Error("DESKTOP_JOURNEY_FAILED");
      }
    }
  } finally {
    await rm(storage, { force: true });
  }
} finally {
  const stopped = instance.waitForEvent("close", { timeout: 60000 });
  await instance.evaluate(({ app }) => app.quit());
  await stopped;
}
