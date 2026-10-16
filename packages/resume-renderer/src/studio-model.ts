import type { NativeResumeDocument } from "@aijob/resume-core";

export interface StudioText {
  text: string;
  label?: string;
  field?: string;
}
export interface StudioEntry {
  id: string;
  title: string;
  date: string;
  details: StudioText[];
  bodies: string[];
  links: { label: string; url: string }[];
}
export interface StudioSection {
  id: string;
  title: string;
  showHeading: boolean;
  startOnNewPage: boolean;
  entries: StudioEntry[];
}
const labels: Record<string, string> = {
  role: "角色",
  unit: "单位",
  method: "方法",
  authors: "作者",
  authorPosition: "作者顺序",
  status: "状态",
  grade: "成绩",
  location: "地点",
};
const titleKeys = ["name", "school", "company", "title", "organization", "language", "network"];
const detailKeys = [
  "position",
  "degree",
  "area",
  "grade",
  "location",
  "role",
  "unit",
  "method",
  "publisher",
  "authors",
  "authorPosition",
  "status",
  "issuer",
  "awarder",
  "proficiency",
  "fluency",
  "username",
  "phone",
];
type Item = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const visible = (item: unknown) => !!item && typeof item === "object" && !(item as Item).hidden;
function entry(item: Item): StudioEntry {
  const titleKey = titleKeys.find((key) => text(item[key]).trim());
  const details = detailKeys.flatMap((key) =>
    text(item[key]).trim()
      ? [{ text: text(item[key]), field: key, ...(labels[key] ? { label: labels[key] } : {}) }]
      : [],
  );
  if (Array.isArray(item.keywords))
    for (const keyword of item.keywords)
      if (text(keyword).trim()) details.push({ text: text(keyword), field: "keywords" });
  const website = item.website as { url?: string; label?: string } | undefined;
  const bodies = ["recipient", "description", "content"].flatMap((key) =>
    text(item[key]).trim() ? [text(item[key])] : [],
  );
  if (Array.isArray(item.roles))
    for (const role of item.roles as Item[]) {
      // Structured role dates stay verbatim; no upstream date parser or inferred date values.
      const line = [text(role.position), text(role.period)].filter(Boolean).join(" · ");
      if (line) bodies.push(`<p><strong>${escapeHtml(line)}</strong></p>`);
      if (text(role.description).trim()) bodies.push(text(role.description));
    }
  return {
    id: text(item.id),
    title: titleKey ? text(item[titleKey]) : "",
    date: text(item.period) || text(item.date),
    details,
    bodies,
    links: website?.url ? [{ label: website.label || website.url, url: website.url }] : [],
  };
}
/** A read-only projection: no RRv6 schema roundtrip, mutation, fact inference or date normalization. */
export function studioSections(document: NativeResumeDocument): StudioSection[] {
  const data = document.data;
  const order = [
    ...new Set(data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar])),
  ];
  return order.flatMap((id) => {
    if (id === "summary") {
      if (data.summary.hidden || !data.summary.content.trim()) return [];
      return [
        {
          id,
          title: data.summary.title,
          showHeading: data.summary.showHeading !== false,
          startOnNewPage: data.summary.startOnNewPage,
          entries: [
            {
              id: "summary",
              title: "",
              date: "",
              details: [],
              bodies: [data.summary.content],
              links: [],
            },
          ],
        },
      ];
    }
    const section =
      (data.sections as Record<string, unknown>)[id] ??
      data.customSections.find((part) => part.id === id);
    if (!section || !visible(section)) return [];
    const value = section as Item;
    const entries = (Array.isArray(value.items) ? value.items : [])
      .filter(visible)
      .map((item) => entry(item as Item));
    if (!entries.length) return [];
    return [
      {
        id,
        title: text(value.title),
        showHeading: value.showHeading !== false,
        startOnNewPage: value.startOnNewPage === true,
        entries,
      },
    ];
  });
}
