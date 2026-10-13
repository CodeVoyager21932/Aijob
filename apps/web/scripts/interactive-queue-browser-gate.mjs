import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const require = createRequire(new URL("../../platform/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const out = new URL("../../../docs/evidence/interactive-queue-2026-09-09/", import.meta.url);
await mkdir(out, { recursive: true });
const now = new Date().toISOString();
const session = {
  id: randomUUID(),
  task: "experience",
  title: "排队体验夹具",
  pace: "guided",
  status: "active",
  revision: 1,
  context: { experienceIds: [], initialText: "课程项目：整理公开访谈资料。", direction: "" },
  createdAt: now,
  updatedAt: now,
  turns: [
    {
      id: randomUUID(),
      ordinal: 1,
      userMessage: "我整理了访谈记录。",
      intent: "continue",
      questionId: null,
      status: "queued",
      executionStatus: "waiting",
      result: null,
      failureCode: null,
      model: null,
      createdAt: now,
    },
  ],
};
const checks = [],
  errors = [];
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/*", (route) => {
  const u = new URL(route.request().url());
  if (u.hostname !== "127.0.0.1") return route.abort();
  if (u.pathname === "/v1/assistant/status")
    return route.fulfill({ json: { enabled: true, model: "ui-fixture", reason: null } });
  if (u.pathname === "/v1/assistant/sessions") return route.fulfill({ json: { items: [] } });
  if (u.pathname === `/v1/assistant/sessions/${session.id}`)
    return route.fulfill({ json: session });
  if (u.pathname === "/v1/session") return route.fulfill({ json: { authenticated: false } });
  if (u.pathname.startsWith("/v1/")) return route.fulfill({ json: { items: [] } });
  return route.continue();
});
try {
  await page.goto(`http://127.0.0.1:5190/assistant?sessionId=${session.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByText("回答已保存，正在排队等待处理。", { exact: false }).waitFor();
  const composer = page.getByRole("textbox", { name: "我的回答或补充", exact: true });
  await composer.fill("等待期间继续补充的内容。");
  checks.push("queued-state-and-editable-composer");
  for (const width of [1440, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 600) await page.getByRole("button", { name: "对话与练习", exact: true }).click();
    await page.getByText("回答已保存，正在排队等待处理。", { exact: false }).waitFor();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw Error(`overflow-${width}`);
    await page.screenshot({
      path: new URL(`queue-${width}.png`, out).pathname.replace(/^\/([A-Z]:)/, "$1"),
      fullPage: true,
    });
    checks.push(`queue-width-${width}`);
  }
  session.turns[0].executionStatus = "processing";
  await page.getByText("正在整理本轮材料并等待你的 API 返回…", { exact: true }).waitFor();
  if ((await composer.inputValue()) !== "等待期间继续补充的内容。")
    throw Error("processing-lost-input");
  checks.push("processing-poll-preserves-input");
  Object.assign(session.turns[0], {
    status: "completed",
    executionStatus: null,
    model: "ui-fixture",
    result: {
      schemaVersion: "career-assistant-result-v1",
      kind: "question",
      reply: "接下来整理你的具体做法。",
      question: "你怎样核对整理结果？",
      artifact: null,
      changes: [],
      preparation: [],
      known: [],
      openQuestions: [],
    },
  });
  session.revision = 2;
  await page.getByRole("heading", { name: "你怎样核对整理结果？", exact: true }).waitFor();
  if ((await composer.inputValue()) !== "等待期间继续补充的内容。")
    throw Error("completion-lost-input");
  if (!(await page.getByRole("button", { name: "发送给 AI", exact: true }).isEnabled()))
    throw Error("send-still-disabled");
  checks.push("completion-restores-send-without-losing-input");
  if (errors.length) throw Error(JSON.stringify(errors));
} catch (e) {
  errors.push(e.message);
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL("browser.json", out),
    JSON.stringify(
      { scope: "real Chromium with fixture HTTP responses; no actual model calls", checks, errors },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(JSON.stringify({ checks, errors }));
