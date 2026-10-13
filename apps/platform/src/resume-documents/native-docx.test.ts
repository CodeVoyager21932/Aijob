import {
  applyNativeTemplate,
  createNativeResumeDocument,
  nativeTemplateCatalog,
  newNativeItem,
} from "@aijob/resume-core";
import { load } from "cheerio";
import { convertToHtml, extractRawText } from "mammoth";
import { describe, expect, it } from "vitest";
import { createNativeDocx } from "./native-docx.js";
import {
  nativeOutputLinks,
  nativeOutputText,
  normalizeNativeLink,
} from "./native-output-content.js";

describe("native DOCX content adapter", () => {
  for (const template of nativeTemplateCatalog)
    it(`${template.id} keeps typed fields, formatted paragraphs and long content`, async () => {
      const document = applyNativeTemplate(createNativeResumeDocument(), template.id);
      document.data.basics.name = "中文导出夹具";
      document.data.basics.email = "lin@example.com";
      document.data.basics.customFields.push({
        id: "contact",
        icon: "",
        text: "作品网站",
        link: "https://example.com",
      });
      const project = newNativeItem("projects", "project");
      project.name = "完整研究项目";
      project.period = "2025.09–2026.06";
      project.description = Array.from(
        { length: 70 },
        (_, i) =>
          `<p>记录${i + 1}号：完成 <strong>18</strong> 次访谈，留存 <a href="https://example.com/report">报告${i + 1}</a>。</p>`,
      ).join("");
      document.data.sections.projects.items.push(project, {
        ...project,
        id: "hidden",
        name: "不应出现的私有条目",
        hidden: true,
      });
      const skill = newNativeItem("skills", "skill");
      skill.name = "SQL";
      skill.proficiency = "完成留存统计";
      skill.description = "<p>技能补充：独立检查 24 个查询。</p>";
      document.data.sections.skills.items.push(skill);
      const language = newNativeItem("languages", "language");
      language.language = "英语";
      language.description = "<p>语言补充：整理 8 篇原文报告。</p>";
      document.data.sections.languages.items.push(language);
      const original = structuredClone(document);
      const bytes = await createNativeDocx(document);
      const actual = (await extractRawText({ buffer: bytes })).value.replace(/\s/g, "");
      const $ = load((await convertToHtml({ buffer: bytes })).value);
      const links = new Set(
        $("a[href]")
          .map((_, node) => normalizeNativeLink($(node).attr("href") ?? ""))
          .get(),
      );
      for (const url of nativeOutputLinks(document))
        expect(links.has(normalizeNativeLink(url))).toBe(true);
      for (const text of nativeOutputText(document))
        expect(actual).toContain(text.replace(/\s/g, ""));
      expect(actual).toContain("记录70号");
      expect(actual).toContain("作品网站");
      expect(actual).not.toContain("不应出现的私有条目");
      expect(document).toEqual(original);
    });
});
