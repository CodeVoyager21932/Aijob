import {
  ResumeStudioContentSchema,
  type ResumeStudioEntry,
  resumeRichHtml,
} from "@aijob/contracts";
import {
  createNativeResumeDocument,
  type NativeResumeDocument,
  newNativeItem,
  parseNativeResumeDocument,
} from "@aijob/resume-core";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paragraph = (label: string, value: string) =>
  value ? `<p>${escapeHtml(label)}${label ? "：" : ""}${escapeHtml(value)}</p>` : "";
const kindMap = {
  education: "education",
  internship: "experience",
  project: "projects",
  research: "projects",
  publications: "publications",
  activity: "volunteer",
  skills: "skills",
  awards: "awards",
  languages: "languages",
  certificates: "certifications",
  summary: "summary",
  custom: "summary",
} as const;
const labels: Record<string, string> = {
  title: "条目名称",
  organization: "单位",
  role: "角色",
  location: "地点",
  degree: "学历",
  major: "专业",
  department: "部门",
  background: "背景",
  methods: "方法",
  results: "成果",
  gpa: "绩点",
  courses: "课程",
  researchFocus: "研究方向",
  authors: "作者",
  venue: "发表刊物",
  publicationStatus: "发表状态",
  url: "链接",
  skillCategory: "技能分类",
  proficiency: "使用说明",
  issuer: "颁发机构",
};

/** Explicit one-way migration. Never called by normal native reads or saves. */
export function convertLegacyStudioContent(input: unknown) {
  const source = ResumeStudioContentSchema.parse(input),
    document = createNativeResumeDocument();
  const mappings: {
    sourceSectionId: string;
    sourceEntryId: string;
    nativeSectionId: string;
    nativeItemId: string;
    experienceId: string | null;
    experienceRevision: number | null;
  }[] = [];
  const warnings: string[] = ["旧版排版不直接混入原生模板，新稿采用中文单栏，可继续换模板。"];
  Object.assign(document.data.basics, {
    name: source.basics.name,
    headline: source.basics.headline,
    phone: source.basics.phone,
    email: source.basics.email,
    location: source.basics.city,
    customFields: source.basics.links.map((link, index) => ({
      id: link.id ?? `legacy-link-${index}`,
      icon: "",
      text: link.label || link.url,
      link: link.url,
    })),
  });
  document.data.metadata.layout.pages = [{ fullWidth: true, main: [], sidebar: [] }];
  for (const section of source.sections) {
    const type = kindMap[section.kind];
    const items = section.entries.map((entry) => {
      const used = new Set<string>();
      const take = (key: keyof ResumeStudioEntry) => {
        used.add(String(key));
        return String(entry[key] ?? "");
      };
      const detail = (key: string) => {
        used.add(`details.${key}`);
        return String((entry.details as Record<string, unknown> | undefined)?.[key] ?? "");
      };
      const period = [entry.startDate, entry.endDate].filter(Boolean).join(" — ");
      const item: Record<string, unknown> & { id: string; hidden: boolean } =
        type === "summary"
          ? { id: entry.id, hidden: entry.hidden, content: "" }
          : newNativeItem(type, entry.id);
      item.hidden = entry.hidden;
      if (type === "education")
        Object.assign(item, {
          school: take("organization") || take("title"),
          degree: take("degree"),
          area: take("major"),
          grade: detail("gpa"),
          location: take("location"),
          period,
        });
      else if (type === "experience")
        Object.assign(item, {
          company: take("organization") || take("title"),
          position: take("role"),
          location: take("location"),
          period,
        });
      else if (type === "projects")
        Object.assign(item, {
          name: take("title"),
          unit: take("organization"),
          role: take("role"),
          method: detail("methods"),
          period,
        });
      else if (type === "publications")
        Object.assign(item, {
          title: take("title"),
          publisher: detail("venue") || take("organization"),
          authors: detail("authors"),
          status: detail("publicationStatus"),
          date: period,
        });
      else if (type === "skills")
        Object.assign(item, {
          name: take("title") || detail("skillCategory"),
          proficiency: detail("proficiency") || take("role"),
        });
      else if (type === "languages")
        Object.assign(item, {
          language: take("title"),
          fluency: detail("proficiency") || take("role"),
        });
      else if (type === "certifications")
        Object.assign(item, {
          title: take("title"),
          issuer: detail("issuer") || take("organization"),
          date: period,
        });
      else if (type === "awards")
        Object.assign(item, { title: take("title"), awarder: take("organization"), date: period });
      else if (type === "volunteer")
        Object.assign(item, {
          organization: take("organization") || take("title"),
          location: take("location"),
          period,
        });
      const url = entry.details?.url;
      if (url && "website" in item && /^(https?:\/\/|mailto:|tel:)/i.test(url)) {
        used.add("details.url");
        item.website = { url, label: "", inlineLink: false };
      }
      let description = resumeRichHtml(entry.body);
      for (const key of ["title", "organization", "role", "location", "degree", "major"] as const) {
        const value = entry[key];
        if (value && !used.has(key) && !Object.values(item).includes(value))
          description += paragraph(labels[key] ?? key, value);
      }
      for (const [key, value] of Object.entries(entry.details ?? {})) {
        if (value && !used.has(`details.${key}`))
          description += paragraph(labels[key] ?? key, value);
      }
      if (type === "summary" || type === "skills" || type === "languages")
        description += paragraph("时间", period);
      item[type === "summary" ? "content" : "description"] = description;
      mappings.push({
        sourceSectionId: section.id,
        sourceEntryId: entry.id,
        nativeSectionId: section.id,
        nativeItemId: entry.id,
        experienceId: entry.experienceId,
        experienceRevision: entry.experienceRevision,
      });
      if (entry.pageBreakBefore) warnings.push(`条目 ${entry.id} 的旧手动分页需在新稿中重新查看。`);
      return item;
    });
    document.data.customSections.push({
      id: section.id,
      type,
      title: section.title,
      icon: "",
      columns: 1,
      hidden: section.hidden,
      keepTogether: false,
      startOnNewPage: false,
      items,
      ...(type === "skills" ? { keywordLayout: "inline" as const } : {}),
      ...(section.kind === "research" ? { aijobKind: "research" as const } : {}),
    } as NativeResumeDocument["data"]["customSections"][number]);
    document.data.metadata.layout.pages[0]?.main.push(section.id);
  }
  if (source.basics.photoId) {
    document.data.picture.url = `aijob-photo:${source.basics.photoId}`;
    document.data.picture.hidden = false;
  }
  return {
    document: parseNativeResumeDocument(document),
    mappings,
    warnings,
    photoId: source.basics.photoId ?? null,
  };
}
