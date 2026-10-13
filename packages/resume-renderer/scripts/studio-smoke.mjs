import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyNativeTemplate, createNativeResumeDocument, newNativeItem } from "@aijob/resume-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderNativePdfArtifactIsolated } from "../dist/isolated.mjs";

const document = applyNativeTemplate(createNativeResumeDocument(), "studio-clear-cn");
document.data.basics.name = "中文跨页验证";
document.data.basics.headline = "人工夹具 · 不含个人资料";
document.data.basics.email = "fixture@example.com";
document.data.sections.skills.items = [
  {
    ...newNativeItem("skills", "skill-1"),
    name: "资料处理",
    proficiency: "熟练",
    keywords: ["Python", "中文检索"],
  },
];
document.data.sections.languages.items = [
  { ...newNativeItem("languages", "language-1"), language: "英语", fluency: "可工作沟通" },
];
document.data.summary.content = "<p>验证内容导入后仍然可编辑，版式变更不改变事实。</p>";
document.data.sections.projects.items = Array.from({ length: 12 }, (_, i) => ({
  id: `project-${i}`,
  hidden: false,
  name: `项目编号_${String(i).padStart(2, "0")}`,
  period: "大三暑期 — 至今",
  role: "项目负责人",
  unit: "联合实验室",
  method: "访谈与对照实验",
  website: { label: "项目报告", url: `https://example.com/project/${i}`, inlineLink: false },
  description: `<p>完成需求分析与中文资料整理，保留事实与证据来源。该段跨页时保持可读，不裁掉正文。</p><ul><li>独立完成方法论与结果复盘。TOKEN_${i}_A</li><li>改进协作流程并检查导出。TOKEN_${i}_B<ul><li>嵌套证据条目。TOKEN_${i}_C</li></ul></li></ul>`,
}));
document.data.sections.publications.items = [
  {
    id: "paper-1",
    hidden: false,
    title: "中文排版研究",
    publisher: "测试期刊",
    date: "2026年秋",
    authors: "张三、李四",
    authorPosition: "共同第一作者",
    status: "已录用",
    website: { label: "论文", url: "https://example.com/paper", inlineLink: false },
    description: "<p>论文扩展字段应完整保留。</p>",
  },
];
const before = JSON.stringify(document);
const ids = process.argv.includes("--all")
  ? ["studio-clear-cn", "studio-compact-cn", "studio-main-cn", "studio-research-cn"]
  : ["studio-clear-cn"];
const output = resolve("../../.data/renderer-studio-smoke");
await mkdir(output, { recursive: true });
const empty = createNativeResumeDocument();
empty.data.basics.name = "预览同学";
const emptyArtifact = await renderNativePdfArtifactIsolated(
  empty,
  resolve("../../apps/web/public/fonts"),
);
assert.ok(emptyArtifact.bytes.length > 1000, "name-only draft must render");
console.log(
  JSON.stringify({
    id: "name-only",
    bytes: emptyArtifact.bytes.length,
    diagnostics: emptyArtifact.diagnostics,
  }),
);
for (const id of ids) {
  const candidate = applyNativeTemplate(document, id);
  const artifact = await renderNativePdfArtifactIsolated(
    candidate,
    resolve("../../apps/web/public/fonts"),
  );
  const task = getDocument({ data: new Uint8Array(artifact.bytes) });
  const pdf = await task.promise;
  let text = "",
    links = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    for (const item of (await page.getTextContent()).items)
      if ("str" in item && item.str.trim()) {
        assert.ok(
          item.transform[4] >= -1 && item.transform[4] + item.width <= viewport.width + 1,
          `text outside page ${n}: ${item.str}`,
        );
        assert.ok(
          item.transform[5] >= 0 && item.transform[5] <= viewport.height,
          `text outside page ${n}`,
        );
      }
    text += (await page.getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join("");
    links.push(...(await page.getAnnotations()).flatMap((x) => (x.url ? [x.url] : [])));
  }
  const normalized = text.replace(/\s+/g, "");
  for (const value of [
    "中文跨页验证",
    "大三暑期 — 至今",
    "联合实验室",
    "访谈与对照实验",
    "张三、李四",
    "共同第一作者",
    "已录用",
    "2026年秋",
  ])
    assert.ok(normalized.includes(value.replace(/\s+/g, "")), `missing ${value}`);
  for (let i = 0; i < 12; i++)
    for (const suffix of ["A", "B", "C"])
      assert.equal(normalized.split(`TOKEN_${i}_${suffix}`).length - 1, 1, `token ${i}${suffix}`);
  assert.equal(new Set(links).size, 13);
  assert.ok(pdf.numPages >= 2 && pdf.numPages < 10);
  assert.equal(new Set(artifact.anchors.map((x) => x.id)).size, 16);
  assert.ok(artifact.anchors.every((x) => Number.isFinite(x.y) && x.y >= 0 && x.y < 842));
  await writeFile(resolve(output, `${id}.pdf`), artifact.bytes);
  console.log(
    JSON.stringify({
      id,
      pages: pdf.numPages,
      bytes: artifact.bytes.length,
      anchors: artifact.anchors.length,
      diagnostics: artifact.diagnostics,
    }),
  );
  await task.destroy();
}
assert.equal(JSON.stringify(document), before, "input document mutated");
if (process.argv.includes("--edge")) {
  const long = applyNativeTemplate(createNativeResumeDocument(), "studio-clear-cn");
  long.data.basics.name = "超长条目夹具";
  long.data.picture.url =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=";
  long.data.picture.hidden = false;
  long.data.sections.projects.items = [
    {
      ...newNativeItem("projects", "long-entry"),
      name: "一条超过一页的经历",
      description: `<ol start="3"><li>有序事实甲</li><li>有序事实乙</li></ol>${Array.from(
        { length: 90 },
        (_, i) => `<p>超长正文保留原始中文与数字，LONG_${String(i).padStart(3, "0")}</p>`,
      ).join("")}`,
    },
  ];
  const artifact = await renderNativePdfArtifactIsolated(
    long,
    resolve("../../apps/web/public/fonts"),
  );
  const task = getDocument({ data: new Uint8Array(artifact.bytes) }),
    pdf = await task.promise;
  let all = "";
  for (let n = 1; n <= pdf.numPages; n++)
    all += (await (await pdf.getPage(n)).getTextContent()).items
      .map((x) => ("str" in x ? x.str : ""))
      .join("");
  for (let i = 0; i < 90; i++)
    assert.equal(all.split(`LONG_${String(i).padStart(3, "0")}`).length - 1, 1);
  assert.ok(all.replace(/\s+/g, "").includes("3.有序事实甲"));
  assert.ok(all.replace(/\s+/g, "").includes("4.有序事实乙"));
  assert.ok(pdf.numPages > 1 && pdf.numPages < 6);
  assert.ok(
    new Set(artifact.anchors.filter((x) => x.id === "long-entry").map((x) => x.page)).size > 1,
  );
  await writeFile(resolve(output, "long-entry.pdf"), artifact.bytes);
  console.log(
    JSON.stringify({
      id: "long-entry",
      pages: pdf.numPages,
      bytes: artifact.bytes.length,
      diagnostics: artifact.diagnostics,
    }),
  );
  await task.destroy();
}
