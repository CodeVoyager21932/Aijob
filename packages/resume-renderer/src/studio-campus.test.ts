import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createNativeResumeDocument, newNativeItem } from "@aijob/resume-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, it } from "vitest";
import { renderNativePdfArtifactIsolated } from "../dist/isolated.mjs";

it("keeps a photo, structured roles, supplemental fields and clickable links in the graduate PDF", async () => {
  const document = createNativeResumeDocument();
  document.data.basics.name = "中文校招同学";
  document.data.picture.hidden = false;
  document.data.picture.url = `data:image/png;base64,${(await readFile(resolve("../../apps/web/public/resume-templates/sample-photo.png"))).toString("base64")}`;
  document.data.sections.experience.items = [
    {
      ...newNativeItem("experience", "intern"),
      company: "校园服务中心",
      position: "活动助理",
      location: "上海",
      period: "大三暑期",
      roles: [
        {
          id: "role",
          position: "协作负责人",
          period: "2026年夏",
          description: "<p>整理活动回访记录。</p>",
        },
      ],
      description: '<p>记录报名流程与<a href="https://example.com/report">复盘报告</a>。</p>',
    },
  ];
  document.data.sections.projects.items = [
    {
      ...newNativeItem("projects", "project"),
      name: "课程调研",
      role: "调研员",
      unit: "课程小组",
      method: "访谈与问卷",
      period: "本学期",
    },
  ];
  const before = JSON.stringify(document);
  const result = await renderNativePdfArtifactIsolated(
    document,
    resolve("../../apps/web/public/fonts"),
  );
  const task = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: false });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const actual = (await page.getTextContent()).items
      .flatMap((item) => ("str" in item ? [item.str] : []))
      .join("")
      .replace(/\s/g, "");
    for (const value of [
      "校园服务中心",
      "活动助理",
      "上海",
      "大三暑期",
      "协作负责人",
      "2026年夏",
      "整理活动回访记录。",
      "访谈与问卷",
      "调研员",
      "课程小组",
      "复盘报告",
    ])
      expect(actual).toContain(value);
    expect(
      (await page.getAnnotations()).some((item) => item.url === "https://example.com/report"),
    ).toBe(true);
    expect(pdf.numPages).toBe(1);
    expect(result.diagnostics).toEqual([]);
    expect(result.anchors.some((item) => item.id === "intern")).toBe(true);
    expect(JSON.stringify(document)).toBe(before);
  } finally {
    await task.destroy();
  }
}, 60000);

it("reports overflow at the readable limit and retains the final long-content item", async () => {
  const document = createNativeResumeDocument();
  document.data.basics.name = "长材料校招同学";
  document.data.sections.projects.items = Array.from({ length: 28 }, (_, index) => ({
    ...newNativeItem("projects", `long-${index}`),
    name: `调研任务 ${index}`,
    description: `<p>这是一段必须完整保留的中文经历说明，记录调研背景、个人职责、协作过程和实际结果；超过单页容量时仍然保留全部文字。第 ${index} 条结束。</p>`,
  }));
  const result = await renderNativePdfArtifactIsolated(
    document,
    resolve("../../apps/web/public/fonts"),
  );
  expect(result.fit?.level).toBe(2);
  expect(result.fit?.bodyFontSize).toBeGreaterThanOrEqual(9.5);
  expect(result.fit?.pageCount).toBeGreaterThan(1);
  expect(result.fit?.overflowItemIds.length).toBeGreaterThan(0);
  const task = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: false });
  try {
    const pdf = await task.promise;
    const last = await pdf.getPage(pdf.numPages);
    const text = (await last.getTextContent()).items
      .flatMap((item) => ("str" in item ? [item.str] : []))
      .join("")
      .replace(/\s/g, "");
    expect(text).toContain("第27条结束。");
  } finally {
    await task.destroy();
  }
}, 60000);
