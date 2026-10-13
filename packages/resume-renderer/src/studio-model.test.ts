import { applyNativeTemplate, createNativeResumeDocument, newNativeItem } from "@aijob/resume-core";
import { describe, expect, it } from "vitest";
import { studioSections } from "./studio-model.js";
import { nativeRendererVersions } from "./versions.js";

describe("studio read-only projection", () => {
  it("keeps local project/publication extensions and verbatim dates without changing the source", () => {
    const document = createNativeResumeDocument();
    document.data.sections.projects.items = [
      {
        ...newNativeItem("projects", "p"),
        name: "调查项目",
        period: "大三暑期—至今",
        role: "负责人",
        unit: "实验室",
        method: "访谈",
        description: "<p>原始正文</p>",
      },
    ];
    document.data.sections.publications.items = [
      {
        ...newNativeItem("publications", "r"),
        title: "论文",
        authors: "张三",
        authorPosition: "共同一作",
        status: "已录用",
        date: "2026年秋",
      },
    ];
    const before = JSON.stringify(document);
    const sections = studioSections(document);
    expect(sections.find((s) => s.id === "projects")?.entries[0]).toMatchObject({
      date: "大三暑期—至今",
      details: [
        { text: "负责人", label: "角色" },
        { text: "实验室", label: "单位" },
        { text: "访谈", label: "方法" },
      ],
    });
    expect(sections.find((s) => s.id === "publications")?.entries[0]).toMatchObject({
      date: "2026年秋",
      details: [
        { text: "张三", label: "作者" },
        { text: "共同一作", label: "作者顺序" },
        { text: "已录用", label: "状态" },
      ],
    });
    expect(JSON.stringify(document)).toBe(before);
  });
  it("does not introduce hidden or unplaced content", () => {
    const document = createNativeResumeDocument();
    document.data.sections.projects.items = [
      { ...newNativeItem("projects", "p"), hidden: true, name: "隐藏项目" },
    ];
    document.data.summary.content = "<p>未放置简介</p>";
    document.data.metadata.layout.pages = [{ fullWidth: true, main: ["projects"], sidebar: [] }];
    expect(studioSections(document)).toEqual([]);
  });
  it("keeps stored content and legacy renderer identity when changing only a layout", () => {
    const document = createNativeResumeDocument();
    const before = JSON.stringify(document.data.basics);
    expect(nativeRendererVersions(applyNativeTemplate(document, "lapis-cn")).rendererVersion).toBe(
      "native-react-pdf-cn-v11",
    );
    for (const id of [
      "studio-clear-cn",
      "studio-compact-cn",
      "studio-main-cn",
      "studio-research-cn",
    ] as const) {
      const next = applyNativeTemplate(document, id);
      expect(nativeRendererVersions(next).rendererVersion).toContain("forme-0.28");
      expect(JSON.stringify(next.data.basics)).toBe(before);
    }
  });
});
