/** Shared exact section labels for PDF column detection and content classification. */
export type NativeImportKind =
  | "education"
  | "experience"
  | "projects"
  | "research"
  | "publications"
  | "skills"
  | "languages"
  | "certifications"
  | "awards"
  | "volunteer"
  | "summary"
  | "unknown";

const headings: Record<string, NativeImportKind> = {
  教育背景: "education",
  教育情况: "education",
  教育经历: "education",
  学习经历: "education",
  教育: "education",
  实习经历: "experience",
  实习经验: "experience",
  工作经历: "experience",
  工作经验: "experience",
  实习与工作经历: "experience",
  实习工作经历: "experience",
  项目经历: "projects",
  项目成果: "projects",
  项目经验: "projects",
  项目实践: "projects",
  科研经历: "research",
  研究经历: "research",
  学术经历: "research",
  论文与成果: "publications",
  论文成果: "publications",
  发表论文: "publications",
  学术成果: "publications",
  专业技能: "skills",
  技能清单: "skills",
  技能与工具: "skills",
  技能特长: "skills",
  技能: "skills",
  语言能力: "languages",
  语言: "languages",
  资格证书: "certifications",
  认证证书: "certifications",
  证书: "certifications",
  荣誉证书: "certifications",
  荣誉奖项: "awards",
  获奖经历: "awards",
  奖项: "awards",
  校园经历: "volunteer",
  校园活动: "volunteer",
  校园实践: "volunteer",
  校园与志愿活动: "volunteer",
  社会实践: "volunteer",
  志愿经历: "volunteer",
  个人简介: "summary",
  个人总结: "summary",
  个人优势: "summary",
  自我评价: "summary",
};
// Keep a heading's first-line numbering and punctuation out of its semantic label.
export function nativeImportHeadingKind(text: string): NativeImportKind | undefined {
  const label = text.trim()
    .replace(/^[\d一二三四五六七八九十.、．\s]+/u, "")
    // PDF icon fonts often extract a single decorative glyph as a Latin-looking
    // character before an otherwise complete heading.
    .replace(/^[^\p{Script=Han}\d\s]\s+/u, "")
    .replace(/[\s：:／/]/g, "");
  return headings[label];
}

export function isNativeImportSectionHeading(text: string): boolean {
  return nativeImportHeadingKind(text) !== undefined;
}
