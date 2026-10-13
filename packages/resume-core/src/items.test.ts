import { describe, expect, it } from "vitest";
import { createNativeResumeDocument, parseNativeResumeDocument } from "./index.js";
import { changeNativeItems, ensureNativeResearchSection, newNativeItem } from "./items.js";

describe("native typed items", () => {
  it("retains Chinese authorship and full research context in one native section", () => {
    const doc = createNativeResumeDocument();
    const research = ensureNativeResearchSection(doc.data, "research");
    const item = newNativeItem("projects", "topic");
    Object.assign(item, {
      name: "控制系统研究",
      role: "实验设计",
      unit: "自动化实验室",
      method: "对照实验",
      description: "<p>完成两组验证</p>",
    });
    research.items.push(item);
    expect(ensureNativeResearchSection(doc.data, "another")).toBe(research);
    const paper = newNativeItem("publications", "paper");
    Object.assign(paper, {
      authors: "林同学、王同学",
      authorPosition: "第二作者",
      status: "已录用",
    });
    doc.data.sections.publications.items.push(paper);
    expect(parseNativeResumeDocument(doc)).toEqual(doc);
    expect(doc.data.customSections).toHaveLength(1);
    expect(doc.data.metadata.layout.pages[0]?.main).toContain("research");
  });
  it("persists unfinished distinct module fields without normalizing them away", () => {
    const doc = createNativeResumeDocument();
    doc.data.sections.projects.items.push(newNativeItem("projects", "project"));
    const paper = newNativeItem("publications", "paper");
    doc.data.sections.publications.items.push(paper);
    doc.data.sections.certifications.items.push(newNativeItem("certifications", "certificate"));
    doc.data.sections.awards.items.push(newNativeItem("awards", "award"));
    const skill = newNativeItem("skills", "skill");
    doc.data.sections.skills.items.push(skill);
    doc.data.sections.profiles.items.push(newNativeItem("profiles", "portfolio"));
    doc.data.sections.interests.items.push(newNativeItem("interests", "interest"));
    doc.data.sections.references.items.push(newNativeItem("references", "reference"));
    paper.publisher = "示例学报";
    skill.proficiency = "用 SQL 完成留存统计";
    expect(parseNativeResumeDocument(doc)).toEqual(doc);
  });
  it("copies independently and retains content through order/hide/restore", () => {
    const original = newNativeItem("projects", "a");
    const items = [original, newNativeItem("projects", "b")];
    original.description = "<p>原项目</p>";
    changeNativeItems(items, "a", "duplicate", "copy");
    const copy = items.find((item) => item.id === "copy");
    if (!copy) throw new Error("Missing copy");
    copy.website.url = "https://example.com";
    expect(original.website.url).toBe("");
    changeNativeItems(items, "copy", "down");
    expect(items.map((item) => item.id)).toEqual(["a", "b", "copy"]);
    changeNativeItems(items, "a", "visibility");
    changeNativeItems(items, "a", "visibility");
    expect(original.description).toBe("<p>原项目</p>");
    expect(original.hidden).toBe(false);
    expect(() => changeNativeItems(items, "a", "duplicate", "b")).toThrow();
  });
});
