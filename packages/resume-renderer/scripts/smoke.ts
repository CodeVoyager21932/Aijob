import { nativeOutputFixture } from "../../../tools/resume-native/fixtures.mts";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyNativeTemplate,
  createNativeResumeDocument,
  ensureNativeResearchSection,
  nativeTemplateCatalog,
  newNativeItem,
  parseNativeResumeDocument,
} from "@aijob/resume-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  installLocalFontCatalog,
  nativeResumeSemanticTree,
  renderNativeResumePdf,
} from "../src/server.js";

const root = resolve(import.meta.dirname, "../../..");
const directory = resolve(root, ".data/resume-native-k0-20260911/output");
await mkdir(directory, { recursive: true });
const fontDirectory = resolve(root, "apps/web/public/fonts");
const manifest = JSON.parse(await readFile(resolve(fontDirectory, "font-set-v3.json"), "utf8")) as {
  files: { file: string; sha256: string }[];
};
const catalog = [];
for (const [family, source] of [
  ["Noto Sans SC", "Sans"],
  ["Noto Serif SC", "Serif"],
]) {
  const files: Record<string, string> = {};
  for (const [weight, style] of [
    ["400", "Regular"],
    ["700", "Bold"],
  ]) {
    const filename = `AijobV3${source}${style}.woff2`;
    const bytes = await readFile(resolve(fontDirectory, filename));
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      manifest.files.find((file) => file.file === filename)?.sha256
    )
      throw new Error("FONT_HASH_MISMATCH");
    files[weight] = `data:font/woff2;base64,${bytes.toString("base64")}`;
  }
  catalog.push({
    type: "web" as const,
    category: source === "Sans" ? ("sans-serif" as const) : ("serif" as const),
    family,
    weights: ["400", "700"] as ("400" | "700")[],
    preview: files["400"],
    files,
  });
}
installLocalFontCatalog(catalog);
const doc = nativeOutputFixture();
await writeFile(resolve(directory, "native-document.json"), JSON.stringify(doc, null, 2));
const reopened = parseNativeResumeDocument(
  JSON.parse(await readFile(resolve(directory, "native-document.json"), "utf8")),
);
await writeFile(
  resolve(directory, "native-interaction-tree.json"),
  JSON.stringify(nativeResumeSemanticTree(reopened), null, 2),
);
// Rendering is deliberately denied all network access: fonts must already be local bytes.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (!String(input).startsWith("data:")) throw new Error("NATIVE_SMOKE_NETWORK_FORBIDDEN");
  return originalFetch(input, init);
};
try {
  const results = [];
  for (const template of nativeTemplateCatalog) {
    for (const length of ["short", "complete", "long"] as const) {
      const candidate = applyNativeTemplate(reopened, template.id);
      if(length === "short") {
        for(const id of ["publications","skills","certifications","awards"] as const) candidate.data.sections[id].items=[];
        candidate.data.customSections=[];
        candidate.data.sections.projects.items=candidate.data.sections.projects.items.slice(0,1);
      }
      const markers =
        length === "long" ? Array.from({ length: 70 }, (_, index) => `研究记录${index + 1}号`) : [];
      if (length === "long")
        candidate.data.sections.projects.items[0]!.description = markers
          .map(
            (marker) =>
              `<p>${marker}：整理访谈记录，比较不同回答，完成研究报告。保留具体行动、过程与结果，不自动缩小字号。</p>`,
          )
          .join("");
      const start = performance.now();
      const buffer = await renderNativeResumePdf(candidate);
      await writeFile(resolve(directory, `native-${template.id}-${length}.pdf`), buffer);
      const loadingTask = getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: false,
        isEvalSupported: false,
      });
      const pdf = await loadingTask.promise;
      let text = "";
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        text += content.items.map((item) => ("str" in item ? item.str : "")).join("");
      }
      const required = [
        "林知夏",
        "lin@example.com",
        "示例大学",
        "信息管理",
        "GPA3.66",
        "教育校区上海",
        "示例科技",
        "18",
        "2",
        "用户访谈",
        "可用性测试",
        "校园访谈项目",
        "研究报告",
        "尚未填写标题的真实项目正文",
        "实验方法研究",
        "示例学报",
        "访谈与研究整理", "校级研究小组", "半结构化访谈", "林知夏、陈同学", "第二作者", "已录用",
        "SQL",
        "完成留存统计",
        "英语六级",
        "校级奖学金",
        "跨学科研究课题", "自动化实验室", "实验设计", "对照实验", "记录实验过程与结果",
      ];
      const shortRequired=["林知夏","lin@example.com","示例大学","信息管理","GPA3.66","教育校区上海","示例科技","用户访谈","可用性测试","校园访谈项目","研究报告","访谈与研究整理"];
      const missing = [...(length === "short" ? shortRequired : required), ...markers].filter(
        (value) => !text.replace(/\s/g, "").includes(value),
      );
      const result = {
        nativeEngine: "react-pdf",
        template: template.id,
        length,
        pages: pdf.numPages,
        bytes: buffer.length,
        elapsedMs: performance.now() - start,
        missing,
        stage: "isolated-native-render-not-business-integration",
      };
      await writeFile(
        resolve(directory, `smoke-${template.id}-${length}.json`),
        JSON.stringify(result, null, 2),
      );
      await loadingTask.destroy();
      if (missing.length || (length === "short" ? result.pages !== 1 : length === "long" ? result.pages < 2 : result.pages < 1))
        throw new Error(`NATIVE_SMOKE_FAILED: ${JSON.stringify(result)}`);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  await writeFile(
    resolve(directory, "native-template-results.json"),
    JSON.stringify(results, null, 2),
  );
} finally {
  globalThis.fetch = originalFetch;
}
