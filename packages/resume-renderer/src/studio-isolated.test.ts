import { resolve } from "node:path";
import { applyNativeTemplate, createNativeResumeDocument, newNativeItem } from "@aijob/resume-core";
import { expect, it } from "vitest";
import { renderNativePdfArtifactIsolated } from "../dist/isolated.mjs";

it("renders a name-only studio draft in an isolated worker under the test runner", async () => {
  const document = createNativeResumeDocument();
  document.data.basics.name = "预览同学";
  const result = await renderNativePdfArtifactIsolated(
    document,
    resolve("../../apps/web/public/fonts"),
  );
  expect(result.bytes.byteLength).toBeGreaterThan(1000);
  expect(result.pageMap?.pages).toHaveLength(1);
  expect(result.diagnostics).toEqual([]);
}, 60000);

it("applies saved section, entry and sidebar controls to the actual PDF layout", async () => {
  const document = applyNativeTemplate(createNativeResumeDocument(), "studio-main-cn");
  document.data.basics.name = "排版设置夹具";
  document.data.metadata.layout.pages = [
    { fullWidth: false, main: ["projects"], sidebar: ["skills"] },
  ];
  document.data.sections.projects.items = ["first", "second"].map((id) => ({
    ...newNativeItem("projects", id),
    name: `项目 ${id}`,
    description: "<p>固定正文。</p>",
  }));
  document.data.sections.skills.items = [{ ...newNativeItem("skills", "skill"), name: "中文技能" }];
  const fontDirectory = resolve("../../apps/web/public/fonts");
  const before = await renderNativePdfArtifactIsolated(document, fontDirectory);
  const changed = structuredClone(document);
  changed.data.metadata.page.sectionGap = (document.data.metadata.page.sectionGap ?? 14) + 12;
  changed.data.metadata.page.gapY += 11;
  changed.data.metadata.layout.sidebarWidth = 45;
  const after = await renderNativePdfArtifactIsolated(changed, fontDirectory);
  const anchor = (result: typeof before, id: string) => {
    const node = result.anchors.find((node) => node.id === id);
    if (!node || node.width === undefined) throw new Error(`Missing layout anchor: ${id}`);
    return { ...node, width: node.width };
  };
  expect(anchor(after, "first").y - anchor(before, "first").y).toBeCloseTo(12, 1);
  const beforeGap = anchor(before, "second").y - anchor(before, "first").y;
  const afterGap = anchor(after, "second").y - anchor(after, "first").y;
  expect(afterGap - beforeGap).toBeCloseTo(11, 1);
  expect(anchor(after, "skill").x).toBeLessThan(anchor(before, "skill").x);
  expect(anchor(after, "skill").width).toBeGreaterThan(anchor(before, "skill").width);
  expect(after.pageMap?.pages).toHaveLength(1);
  expect(after.diagnostics).toEqual([]);
}, 60000);
