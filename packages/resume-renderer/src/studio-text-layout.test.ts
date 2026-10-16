import { resolve } from "node:path";
import { applyNativeTemplate, createNativeResumeDocument, newNativeItem } from "@aijob/resume-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { renderNativePdfArtifactIsolated } from "../dist/isolated.mjs";
import { formatStudioRuns, prepareStudioText } from "./studio-text-layout.js";

const fontDirectory = resolve("../../apps/web/public/fonts");
const templates = [
  "studio-campus-cn",
  "studio-banner-cn",
  "studio-index-cn",
  "studio-sidebar-cn",
  "studio-layered-cn",
  "studio-cards-cn",
] as const;
const source = "完成课堂观察，整理阅读活动记录并提交活动报告。";
function fixture(template: (typeof templates)[number]) {
  const document = applyNativeTemplate(createNativeResumeDocument(), template);
  Object.assign(document.data.basics, {
    name: "周书宁",
    headline: "小学教育 · 教研与阅读活动助理",
    email: "shuning.zhou@example.com",
    phone: "138 0000 0000",
    location: "南京",
  });
  document.data.sections.projects.items = [
    {
      ...newNativeItem("projects", "practice"),
      name: "阅读活动实践",
      description:
        '<p><strong>完成课堂观察</strong>，整理阅读活动记录并提交<a href="https://example.com/report">活动报告</a>。</p>',
    },
  ];
  return document;
}

describe("six template local typography", () => {
  it("splits original runs while preserving bold, links and source offsets", () => {
    const runs = formatStudioRuns(
      [
        { content: "完成课堂观察", style: { fontWeight: 700 } },
        { content: "，提交", href: "https://example.com/report" },
      ],
      "完成课堂观察，提交",
      {
        sourceText: "完成课堂观察，提交",
        fontSize: 10.5,
        ranges: [{ start: 2, end: 6, fontSize: 12 }],
        lineMode: "manual",
        breakAfter: 7,
      },
    );
    expect(runs.map((run) => run.content).join("")).toBe("完成课堂观察，\n提交");
    expect(runs.find((run) => run.content === "课堂观察")?.style).toMatchObject({
      fontWeight: 700,
      fontSize: 12,
    });
    expect(runs.at(-1)?.href).toBe("https://example.com/report");
  });
  it("rejects a manual break inside a grapheme", () => {
    expect(() =>
      formatStudioRuns([{ content: "教研📚助理" }], "教研📚助理", {
        sourceText: "教研📚助理",
        lineMode: "manual",
        breakAfter: 3,
      }),
    ).toThrow("NATIVE_TEXT_BREAK_INVALID");
  });
  it("leaves obsolete source-bound settings unapplied", () => {
    const document = fixture("studio-banner-cn");
    document.textLayout = { "basics:name": { sourceText: "旧姓名", fontSize: 30 } };
    const node = {
      kind: { type: "Text", content: "周书宁" },
      style: { fontSize: 22 },
      sourceLocation: {
        file: `rr-node:page-1/local-text/${encodeURIComponent(JSON.stringify({ id: "basics:name", label: "姓名", text: "周书宁" }))}`,
        line: 1,
        column: 1,
      },
    };
    const prepared = prepareStudioText({ children: [node] }, document);
    expect(prepared.targets.get("basics:name")).toMatchObject({ stale: true, defaultFontSize: 22 });
    expect((prepared.document.children as (typeof node)[])[0]?.style.fontSize).toBe(22);
    expect(node.style.fontSize).toBe(22);
  });
  it.each(templates)(
    "renders actual selected-size, rich links and full text for %s",
    async (template) => {
      const document = fixture(template);
      document.textLayout = {
        "section:projects:heading": {
          sourceText: document.data.sections.projects.title,
          fontSize: 12,
          inset: 3,
          spaceAfter: 3,
        },
        "entry:practice:body:0": {
          sourceText: source,
          ranges: [{ start: 0, end: 6, fontSize: 12 }],
          lineMode: "manual",
          breakAfter: 7,
          inset: 4,
        },
        "basics:email": {
          sourceText: document.data.basics.email,
          fontSize: 10.5,
          lineMode: "single",
        },
        "basics:headline": {
          sourceText: document.data.basics.headline,
          fontSize: 11,
          lineMode: "manual",
          breakAfter: 7,
        },
      };
      if (template === "studio-sidebar-cn")
        document.fieldLayout = {
          headline: { fontSize: 9.5, lineMode: "single", position: "main" },
          email: { fontSize: 9.5, position: "main" },
        };
      const artifact = await renderNativePdfArtifactIsolated(document, fontDirectory);
      expect(artifact.fit?.pageCount).toBe(1);
      const body = artifact.anchors?.find(
        (anchor) => anchor.kind === "text" && anchor.id === "entry:practice:body:0",
      );
      expect(body?.text).toBe(source);
      expect(body?.lineBoxes?.at(-1)?.end).toBe(source.length);
      for (const id of [
        "basics:name",
        "basics:headline",
        "basics:phone",
        "basics:email",
        "basics:location",
        "section:projects:heading",
        "entry:practice:title",
      ])
        expect(artifact.anchors?.some((anchor) => anchor.kind === "text" && anchor.id === id)).toBe(
          true,
        );
      const task = getDocument({ data: new Uint8Array(artifact.bytes), useSystemFonts: false });
      try {
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const text = (await page.getTextContent()).items.filter((item) => "str" in item);
        expect(text.find((item) => item.str === "完成课堂观察")?.transform[0]).toBeCloseTo(12);
        expect(
          (await page.getAnnotations()).some(
            (annotation) => annotation.url === "https://example.com/report",
          ),
        ).toBe(true);
      } finally {
        await task.destroy();
      }
    },
    60000,
  );
  it("allows natural wrapping on both sides of a manual paragraph break, but rejects forced single-line overflow", async () => {
    const document = fixture("studio-banner-cn");
    const long = "整理访谈资料并编写活动记录，核对事实来源和活动反馈。".repeat(8);
    const project = document.data.sections.projects.items[0];
    if (!project) throw new Error("missing fixture");
    project.description = `<p>${long}</p>`;
    document.textLayout = {
      "entry:practice:body:0": {
        sourceText: long,
        lineMode: "manual",
        breakAfter: 61,
        fontSize: 12,
      },
    };
    const artifact = await renderNativePdfArtifactIsolated(document, fontDirectory);
    expect(
      artifact.anchors?.find((anchor) => anchor.id === "entry:practice:body:0")?.lineBoxes?.length,
    ).toBeGreaterThan(2);
    document.textLayout["entry:practice:body:0"] = {
      sourceText: long,
      lineMode: "single",
      fontSize: 12,
    };
    await expect(renderNativePdfArtifactIsolated(document, fontDirectory)).rejects.toThrow(
      "NATIVE_TEXT_LAYOUT_OVERFLOW",
    );
  }, 60000);
});
