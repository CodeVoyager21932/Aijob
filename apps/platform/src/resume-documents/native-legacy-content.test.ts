import { randomUUID } from "node:crypto";
import {
  blankResumeEntry,
  blankResumeStudioContent,
  type ResumeSectionKind,
  resumeRichText,
} from "@aijob/contracts";
import { parseNativeResumeDocument } from "@aijob/resume-core";
import { describe, expect, it } from "vitest";
import { convertLegacyStudioContent } from "./native-legacy-content.js";
import { nativeOutputText } from "./native-output-content.js";

describe("explicit legacy-to-native content conversion", () => {
  it("preserves all old module types, details, rich content, IDs and experience links without changing the source", () => {
    const source = blankResumeStudioContent();
    source.basics.name = "迁移夹具";
    source.basics.phone = "13800000000";
    const kinds: ResumeSectionKind[] = [
      "education",
      "internship",
      "project",
      "research",
      "publications",
      "activity",
      "skills",
      "awards",
      "languages",
      "certificates",
      "summary",
      "custom",
    ];
    source.sections = kinds.map((kind, index) => ({
      id: randomUUID(),
      kind,
      title: `模块${index}`,
      hidden: false,
      pageBreakBefore: false,
      column: "main",
      entries: [
        {
          ...blankResumeEntry(randomUUID()),
          title: `条目${index}`,
          organization: `单位${index}`,
          role: `角色${index}`,
          major: `专业${index}`,
          degree: `学历${index}`,
          location: `地点${index}`,
          startDate: "2023.09",
          endDate: "2027.06",
          details: {
            background: `背景${index}`,
            methods: `方法${index}`,
            results: `结果${index}`,
            gpa: `绩点${index}`,
            authors: `作者${index}`,
            url: `https://example.com/${index}`,
          },
          body: resumeRichText(`正文${index}包含 18 次访谈和 12%。`),
          experienceId: randomUUID(),
          experienceRevision: 2,
        },
      ],
    }));
    const before = structuredClone(source),
      result = convertLegacyStudioContent(source);
    expect(source).toEqual(before);
    expect(parseNativeResumeDocument(result.document)).toEqual(result.document);
    expect(result.document.data.customSections.map((value) => value.id)).toEqual(
      source.sections.map((value) => value.id),
    );
    expect(result.mappings.map((value) => value.experienceId)).toEqual(
      source.sections.map((value) => value.entries[0]?.experienceId),
    );
    const text = nativeOutputText(result.document).join("\n");
    for (let i = 0; i < kinds.length; i++)
      for (const prefix of [
        "条目",
        "单位",
        "角色",
        "专业",
        "学历",
        "地点",
        "背景",
        "方法",
        "结果",
        "绩点",
        "作者",
        "正文",
      ])
        expect(text, `${prefix}${i}`).toContain(`${prefix}${i}`);
    expect(text).toContain("13800000000");
  });
});
