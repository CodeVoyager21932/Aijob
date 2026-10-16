import { resolve } from "node:path";
import {
  applyNativeTemplate,
  createNativeResumeDocument,
  type NativeFieldLayout,
  newNativeItem,
} from "@aijob/resume-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { renderNativePdfArtifactIsolated } from "../dist/isolated.mjs";
import { sidebarFieldText } from "./studio-sidebar-fields.js";

const fontDirectory = resolve("../../apps/web/public/fonts");
const headline = "小学教育 · 教研与阅读活动助理";
const email = "shuning.zhou@example.com";

function fixture() {
  const document = applyNativeTemplate(createNativeResumeDocument(), "studio-sidebar-cn");
  document.data.basics = {
    ...document.data.basics,
    name: "周书宁（示例）",
    headline,
    email,
    phone: "138 0000 0000",
    location: "南京",
  };
  document.data.summary.content = "<p>关注儿童阅读与课堂活动设计。</p>";
  document.data.sections.education.items = [
    {
      ...newNativeItem("education", "education"),
      school: "江南师范学院",
      degree: "本科",
      area: "小学教育",
      period: "2025—2029",
    },
  ];
  document.data.sections.projects.items = [
    {
      ...newNativeItem("projects", "reading"),
      name: "低年级绘本阅读活动设计",
      description: "<p>整理课堂观察记录，参与完整阅读活动。</p>",
    },
  ];
  return document;
}

async function inspect(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items.flatMap((item) =>
      "str" in item && item.str.trim()
        ? [
            {
              text: item.str,
              x: item.transform[4],
              y: item.transform[5],
              width: item.width,
              size: Math.hypot(item.transform[0], item.transform[1]),
            },
          ]
        : [],
    );
    return {
      pages: pdf.numPages,
      viewport,
      items,
      text: items
        .map((item) => item.text)
        .join("")
        .replace(/\s/gu, ""),
    };
  } finally {
    await task.destroy();
  }
}

describe("C field presentation", () => {
  it("keeps an explicit manual break outside the saved fact and respects grapheme boundaries", () => {
    const source = "教研📚助理";
    expect(sidebarFieldText(source, { lineMode: "manual", breakAfter: 4 })).toBe("教研📚\n助理");
    expect(() => sidebarFieldText(source, { lineMode: "manual", breakAfter: 3 })).toThrow(
      "NATIVE_FIELD_BREAK_INVALID",
    );
    expect(() => sidebarFieldText("é课堂", { lineMode: "manual", breakAfter: 1 })).toThrow(
      "NATIVE_FIELD_BREAK_INVALID",
    );
    expect(sidebarFieldText("教研\n助理", { lineMode: "single" })).toBe("教研 助理");
    expect(source).toBe("教研📚助理");
  });

  it("uses complete role groups and moves an unbroken email to the wider header at the original font size", async () => {
    const document = fixture();
    const before = structuredClone(document);
    const artifact = await renderNativePdfArtifactIsolated(document, fontDirectory);
    const actual = await inspect(artifact.bytes);
    expect(actual.pages).toBe(1);
    expect(actual.viewport.width).toBeCloseTo(595.28, 1);
    expect(actual.viewport.height).toBeCloseTo(841.89, 1);
    expect(artifact.fit?.bodyFontSize).toBe(document.data.metadata.typography.body.fontSize);
    expect(actual.items.filter((item) => item.text === email)).toHaveLength(1);
    const role = actual.items.find((item) => item.text === "教研与阅读活动助理");
    const discipline = actual.items.find((item) => item.text === "小学教育 ·");
    expect(role).toBeDefined();
    expect(discipline).toBeDefined();
    expect(role?.y).toBeLessThan(discipline?.y ?? 0);
    expect(role?.size).toBe(document.data.metadata.typography.body.fontSize);
    const mail = actual.items.find((item) => item.text === email);
    expect(mail?.size).toBe(document.data.metadata.typography.body.fontSize);
    expect(mail?.x).toBeGreaterThan(150);
    expect(role?.x).toBeLessThan(30);
    for (const fact of [
      headline,
      email,
      "关注儿童阅读与课堂活动设计。",
      "江南师范学院",
      "低年级绘本阅读活动设计",
      "整理课堂观察记录，参与完整阅读活动。",
    ]) {
      expect(actual.text).toContain(fact.replace(/\s/gu, ""));
    }
    expect(
      actual.items.filter(
        (item) => item.x < 0 || item.x + item.width > actual.viewport.width + 0.25,
      ),
    ).toEqual([]);
    for (const field of ["headline", "email"] as const) {
      const anchor = artifact.anchors.find((item) => item.kind === "field" && item.field === field);
      expect(anchor?.page).toBe(1);
      expect(anchor?.width).toBeGreaterThan(0);
      expect(anchor?.height).toBeGreaterThan(0);
    }
    expect(document).toEqual(before);
  }, 60000);

  it("applies user font sizes, an explicit role break and main-column placement to the actual PDF", async () => {
    const document = fixture();
    document.fieldLayout = {
      headline: { fontSize: 13, lineMode: "manual", breakAfter: 7, position: "main" },
      email: { fontSize: 11.5, lineMode: "single", position: "main" },
    };
    const before = structuredClone(document);
    const artifact = await renderNativePdfArtifactIsolated(document, fontDirectory);
    const actual = await inspect(artifact.bytes);
    expect(actual.pages).toBe(1);
    const role = actual.items.find((item) => item.text === "教研与阅读活动助理");
    const discipline = actual.items.find((item) => item.text === "小学教育 ·");
    const mail = actual.items.find((item) => item.text === email);
    expect(role?.size).toBe(13);
    expect(discipline?.size).toBe(13);
    expect(role?.y).toBeLessThan(discipline?.y ?? 0);
    expect(mail?.size).toBe(11.5);
    expect(role?.x).toBeGreaterThan(150);
    expect(mail?.x).toBeGreaterThan(150);
    expect(document).toEqual(before);
  }, 60000);

  it("keeps the headline before the email when both automatically move to the main header in different passes", async () => {
    const document = fixture();
    document.data.basics.headline = "小学教育 · 教研与儿童阅读活动组织及语文课堂设计助理";
    const before = structuredClone(document);
    const artifact = await renderNativePdfArtifactIsolated(document, fontDirectory);
    const actual = await inspect(artifact.bytes);
    expect(actual.pages).toBe(1);
    const role = artifact.anchors.find((item) => item.field === "headline");
    const mail = artifact.anchors.find((item) => item.field === "email");
    expect(role?.x).toBeGreaterThan(150);
    expect(mail?.x).toBeGreaterThan(150);
    expect(role?.y).toBeLessThan(mail?.y ?? 0);
    expect(actual.text.split(document.data.basics.headline.replace(/\s/gu, ""))).toHaveLength(2);
    expect(actual.text.split(email)).toHaveLength(2);
    expect(document).toEqual(before);
  }, 60000);

  it("honors a user-authored email break in the sidebar without duplicating the moved field", async () => {
    const document = fixture();
    document.fieldLayout = {
      email: { fontSize: 10.5, lineMode: "manual", breakAfter: 13, position: "sidebar" },
    };
    const before = structuredClone(document);
    const artifact = await renderNativePdfArtifactIsolated(document, fontDirectory);
    const actual = await inspect(artifact.bytes);
    expect(actual.pages).toBe(1);
    const local = actual.items.find((item) => item.text === "shuning.zhou@");
    const domain = actual.items.find((item) => item.text === "example.com");
    expect(local?.size).toBe(10.5);
    expect(domain?.size).toBe(10.5);
    expect(domain?.y).toBeLessThan(local?.y ?? 0);
    expect(local?.x).toBeLessThan(30);
    expect(actual.text.split(email)).toHaveLength(2);
    expect(document).toEqual(before);
  }, 60000);

  it.each([
    { fontSize: 18, lineMode: "single", position: "sidebar" },
    { fontSize: 18, lineMode: "manual", breakAfter: 1, position: "sidebar" },
  ] satisfies NativeFieldLayout[])(
    "refuses an impossible locked layout instead of silently wrapping, shrinking or clipping",
    async (layout) => {
      const document = fixture();
      document.fieldLayout = { email: layout };
      const before = structuredClone(document);
      await expect(renderNativePdfArtifactIsolated(document, fontDirectory)).rejects.toThrow(
        "NATIVE_FIELD_EMAIL_TOO_WIDE",
      );
      expect(document).toEqual(before);
    },
    60000,
  );

  it("refuses even automatic placement if the whole address cannot fit the main header at its chosen size", async () => {
    const document = fixture();
    document.data.basics.email = `${"long".repeat(30)}@example.com`;
    document.fieldLayout = { email: { fontSize: 18 } };
    const before = structuredClone(document);
    await expect(renderNativePdfArtifactIsolated(document, fontDirectory)).rejects.toThrow(
      "NATIVE_FIELD_EMAIL_TOO_WIDE",
    );
    expect(document).toEqual(before);
  }, 60000);
});
