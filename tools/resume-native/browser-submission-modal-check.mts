/** Reopen only the existing isolated browser fixture's submitted material. No new material or journey. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertIsolatedTestDatabaseUrl,
  createDatabase,
} from "../../packages/database/src/index.ts";
import {
  issueOwnerSession,
  assertActiveOwnerEpoch,
} from "../../apps/platform/src/identity/session-repository.ts";
const require = createRequire(new URL("../../apps/platform/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const directory = resolve(
  import.meta.dirname,
  "../../.data/system-upgrade-20261012/opportunity-browser",
);
const fixture = JSON.parse(await readFile(resolve(directory, "result.json"), "utf8"));
const url = process.env.AIJOB_TEST_DATABASE_URL;
if (!url) throw new Error("Missing isolated database");
assertIsolatedTestDatabaseUrl(url);
const db = createDatabase(url);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const owner = await db
    .selectFrom("application.application_cases")
    .select(["owner_id", "owner_epoch"])
    .where("id", "=", fixture.caseId)
    .executeTakeFirstOrThrow();
  const credentials = await db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.owner_id, Number(owner.owner_epoch));
    return issueOwnerSession({
      db: tx,
      ownerId: owner.owner_id,
      ownerEpoch: Number(owner.owner_epoch),
      revokeExisting: false,
      ttlMs: 3600_000,
    });
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([
    {
      name: "aijob_session",
      value: credentials.sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
    },
    {
      name: "aijob_csrf",
      value: credentials.csrfToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:5194/applications/${fixture.caseId}/application`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "查看实际正文", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "实际投递正文" });
  await dialog
    .locator(".native-pdf-text")
    .filter({ hasText: "岗位稿已投递版本" })
    .first()
    .waitFor({ timeout: 60_000 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const dimensions = {
    host: await dialog
      .locator(".native-pages")
      .evaluate((element: Element) => element.getBoundingClientRect().toJSON()),
    canvas: await dialog
      .locator("canvas")
      .first()
      .evaluate((element: Element) => element.getBoundingClientRect().toJSON()),
    text: await dialog
      .locator(".native-pdf-text")
      .first()
      .evaluate((element: Element) => element.getBoundingClientRect().toJSON()),
    sheet: await dialog
      .locator(".native-pdf-sheet")
      .first()
      .evaluate((element: Element) => element.getBoundingClientRect().toJSON()),
    paper: await dialog
      .locator(".native-paper")
      .evaluate((element: Element) => element.getBoundingClientRect().toJSON()),
    dialog: await dialog.evaluate((element: Element) => element.getBoundingClientRect().toJSON()),
  };
  await page.screenshot({
    path: resolve(directory, "03-retained-submission-modal-fixed.png"),
    fullPage: false,
  });
  await writeFile(
    resolve(directory, "modal-dimensions.json"),
    JSON.stringify({ dimensions, pageErrors: errors }, null, 2),
  );
  assert(
    dimensions.host.height > 300 && dimensions.host.height < 800,
    "Preview requires a bounded modal height",
  );
  assert(dimensions.paper.height <= 651, "Preview paper exceeds the 65vh frame");
  assert(
    dimensions.canvas.x >= dimensions.host.x - 2 &&
      dimensions.canvas.right <= dimensions.host.right + 2,
    "PDF exceeds horizontal viewport",
  );
  assert(
    dimensions.canvas.y >= dimensions.host.y - 2 &&
      dimensions.canvas.bottom <= dimensions.host.bottom + 2,
    "Fit-page PDF exceeds vertical viewport",
  );
  assert.deepEqual(errors, []);
  console.log("SUBMISSION_MODAL_FIT_PAGE_OK");
} finally {
  await browser?.close();
  await db.destroy();
}
