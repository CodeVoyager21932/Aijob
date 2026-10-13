import { describe, expect, it } from "vitest";
import {
  applyNativeImportCorrection,
  createNativeResumeDocument,
  hasNativeResumeContent,
  importNativeChineseBlocks,
  joinNativeResumeDocument,
  nativeDescriptionSegments,
  nativeTextBlocks,
  newNativeItem,
  splitNativeResumeDocument,
} from "./index.js";

function fixture() {
  const blocks = nativeTextBlocks("测试同学\n项目经历\n校园项目\n独立完成调研。\n撰写总结。");
  const document = importNativeChineseBlocks(blocks, "fixture-original").document;
  const item = document.data.sections.projects.items[0];
  if (!item) throw new Error("Fixture project missing");
  item.role = "人工补写职责";
  item.unit = "人工补写单位";
  item.description =
    "<p>独立完成调研。</p><ul><li>撰写总结。</li><li><strong>人工新增</strong>的段落。</li></ul>";
  document.data.summary.content = "<p>其他模块的手写内容。</p>";
  return { document, blocks, item };
}

describe("local native import correction", () => {
  it("moves one entry with its ID, manual body and nonmatching fields intact", () => {
    const { document, item } = fixture();
    document.sourceBindings?.push({
      originalId: "fixture-original",
      blockId: "role-source",
      sectionId: "projects",
      itemId: item.id,
      field: "role",
    });
    const moved = applyNativeImportCorrection(document, {
      type: "move-entry",
      itemId: item.id,
      target: "experience",
    });
    const result = moved.data.sections.experience.items[0];
    if (!result) throw new Error("Moved project missing");
    expect(result.id).toBe(item.id);
    expect(result.company).toBe(item.name);
    expect(result.position).toBe("人工补写职责");
    expect(moved.sourceBindings?.at(-1)?.field).toBe("position");
    expect(result.description.startsWith(item.description)).toBe(true);
    expect(result.description).toContain("所属单位：人工补写单位");
    expect(moved.data.sections.projects.items).toHaveLength(0);
    expect(moved.data.summary).toEqual(document.data.summary);
    expect(
      moved.sourceBindings
        ?.filter((binding) => binding.itemId === item.id)
        .every((binding) => binding.sectionId === "experience"),
    ).toBe(true);
    expect(document.data.sections.projects.items[0]).toEqual(item);
  });
  it("splits current edited HTML without replicating dates or replacing any other content", () => {
    const { document, item, blocks } = fixture();
    const split = applyNativeImportCorrection(
      document,
      { type: "split-entry", itemId: item.id, segmentIndex: 1, newItemId: "new-entry" },
      { originalId: "fixture-original", blocks },
    );
    const [first, second] = split.data.sections.projects.items;
    expect(first?.id).toBe(item.id);
    expect(first?.description).toBe("<p>独立完成调研。</p>");
    expect(first?.role).toBe("人工补写职责");
    expect(second?.id).toBe("new-entry");
    expect(second?.name).toBe("");
    expect(second?.period).toBe("");
    expect(second?.description).toContain("<strong>人工新增</strong>");
    expect(second?.description).toContain("撰写总结。");
    expect(split.data.summary).toEqual(document.data.summary);
    const movedBlock = blocks.find((block) => block.text === "撰写总结。");
    if (!movedBlock) throw new Error("Fixture block missing");
    expect(split.sourceBindings?.find((binding) => binding.blockId === movedBlock.id)?.itemId).toBe(
      "new-entry",
    );
    const pair = splitNativeResumeDocument(split);
    expect(joinNativeResumeDocument(pair.content, pair.layout)).toEqual(split);
  });
  it("updates only an explicit scalar, appends body text and records provenance without source text", () => {
    const { document, item, blocks } = fixture();
    const block = blocks[2];
    if (!block) throw new Error("Fixture block missing");
    const source = { originalId: "fixture-original", blocks };
    const changed = applyNativeImportCorrection(
      document,
      {
        type: "assign-field",
        itemId: item.id,
        field: "unit",
        value: "更正的单位",
        originalId: source.originalId,
        blockId: block.id,
      },
      source,
    );
    expect(changed.data.sections.projects.items[0]?.unit).toBe("更正的单位");
    expect(changed.data.sections.projects.items[0]?.description).toBe(item.description);
    const appended = applyNativeImportCorrection(
      changed,
      {
        type: "assign-field",
        itemId: item.id,
        field: "description",
        value: "<原文>",
        originalId: source.originalId,
        blockId: block.id,
      },
      source,
    );
    expect(appended.data.sections.projects.items[0]?.description).toBe(
      `${item.description}<p>&lt;原文&gt;</p>`,
    );
    expect(appended.sourceBindings?.at(-1)).toEqual({
      originalId: source.originalId,
      blockId: block.id,
      sectionId: "projects",
      itemId: item.id,
      field: "description",
    });
    expect(() =>
      applyNativeImportCorrection(
        document,
        {
          type: "assign-field",
          itemId: item.id,
          field: "unit",
          value: "bad",
          originalId: "foreign",
          blockId: block.id,
        },
        source,
      ),
    ).toThrow("SOURCE_NOT_FOUND");
  });
  it("supports legacy documents without bindings and rejects ambiguous or reused entry IDs", () => {
    const { document, item } = fixture();
    delete document.sourceBindings;
    const pair = splitNativeResumeDocument(document);
    expect(joinNativeResumeDocument(pair.content, pair.layout).sourceBindings).toBeUndefined();
    expect(
      applyNativeImportCorrection(document, {
        type: "move-entry",
        itemId: item.id,
        target: "research",
      }).data.customSections[0]?.items[0]?.id,
    ).toBe(item.id);
    expect(() =>
      applyNativeImportCorrection(document, {
        type: "split-entry",
        itemId: item.id,
        segmentIndex: 0,
        newItemId: item.id,
      }),
    ).toThrow("NEW_ID_REQUIRED");
    document.data.sections.projects.items.push(structuredClone(item));
    expect(() =>
      applyNativeImportCorrection(document, {
        type: "move-entry",
        itemId: item.id,
        target: "experience",
      }),
    ).toThrow("ENTRY_NOT_FOUND");
  });
  it("only offers complete nested list elements as boundaries", () => {
    expect(
      nativeDescriptionSegments("<ul><li>一<ul><li>嵌套</li></ul></li><li>二</li></ul>"),
    ).toEqual(["<ul><li>一<ul><li>嵌套</li></ul></li></ul>", "<ul><li>二</li></ul>"]);
    expect(nativeDescriptionSegments("<p>未闭合")).toEqual(["<p>未闭合"]);
    const numbered = '<ol start="3"><li>第一步</li><li>第二步</li></ol>';
    expect(nativeDescriptionSegments(numbered)).toEqual([numbered]);
  });
  it("treats manual or empty-entry work as occupied while a new system template remains blank", () => {
    const document = createNativeResumeDocument();
    expect(hasNativeResumeContent(document)).toBe(false);
    document.data.sections.projects.items.push(newNativeItem("projects", "user-row"));
    expect(hasNativeResumeContent(document)).toBe(true);
  });
});
