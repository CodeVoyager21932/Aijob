import type { NativeResumeData } from "./index.js";

export type EditableNativeSection =
  | "education"
  | "experience"
  | "projects"
  | "publications"
  | "certifications"
  | "awards"
  | "skills"
  | "languages"
  | "volunteer"
  | "profiles"
  | "interests"
  | "references";
export function newNativeItem<K extends EditableNativeSection>(
  kind: K,
  id: string,
): NativeResumeData["sections"][K]["items"][number] {
  const base = { id, hidden: false };
  const linked = { ...base, website: { url: "", label: "", inlineLink: false }, description: "" };
  const items = {
    profiles: {
      ...base,
      icon: "",
      iconColor: "",
      network: "",
      username: "",
      website: { url: "", label: "", inlineLink: false },
    },
    interests: { ...base, icon: "", iconColor: "", name: "", keywords: [] },
    references: { ...linked, name: "", position: "", phone: "" },
    education: { ...linked, school: "", degree: "", area: "", grade: "", location: "", period: "" },
    experience: { ...linked, company: "", position: "", location: "", period: "", roles: [] },
    languages: { ...base, language: "", fluency: "", level: 0, description: "" },
    volunteer: { ...linked, organization: "", location: "", period: "" },
    projects: { ...linked, name: "", period: "", role: "", unit: "", method: "" },
    publications: {
      ...linked,
      title: "",
      publisher: "",
      date: "",
      authors: "",
      authorPosition: "",
      status: "",
    },
    certifications: { ...linked, title: "", issuer: "", date: "" },
    awards: { ...linked, title: "", awarder: "", date: "" },
    skills: {
      ...base,
      name: "",
      proficiency: "",
      level: 0,
      icon: "",
      iconColor: "",
      keywords: [],
      description: "",
    },
  };
  return items[kind];
}

/** Mutates only a caller-owned draft. Stable IDs survive ordering and hiding. */
export function changeNativeItems<T extends { id: string; hidden: boolean }>(
  items: T[],
  id: string,
  action: "up" | "down" | "duplicate" | "visibility" | "delete",
  newId?: string,
) {
  const index = items.findIndex((item) => item.id === id);
  const item = items[index];
  if (!item) throw new Error("NATIVE_ITEM_NOT_FOUND");
  if (action === "duplicate") {
    if (!newId || items.some((entry) => entry.id === newId))
      throw new Error("NATIVE_ITEM_ID_REQUIRED");
    items.splice(index + 1, 0, { ...structuredClone(item), id: newId });
  } else if (action === "delete") items.splice(index, 1);
  else if (action === "visibility") item.hidden = !item.hidden;
  else {
    const target = index + (action === "up" ? -1 : 1);
    if (target >= 0 && target < items.length) {
      items.splice(index, 1);
      items.splice(target, 0, item);
    }
  }
}

/** Native custom project-shaped research section, with an explicit domain kind. */
export function ensureNativeResearchSection(data: NativeResumeData, id: string) {
  const existing = data.customSections.find((section) => section.aijobKind === "research");
  if (existing) {
    if (existing.type !== "projects") throw new Error("NATIVE_RESEARCH_TYPE_MISMATCH");
    return existing;
  }
  const section = {
    id,
    type: "projects" as const,
    aijobKind: "research" as const,
    title: "科研经历",
    icon: "",
    columns: 1,
    hidden: false,
    keepTogether: false,
    startOnNewPage: false,
    items: [] as NativeResumeData["sections"]["projects"]["items"],
  };
  data.customSections.push(section);
  const page = data.metadata.layout.pages[0];
  if (!page) throw new Error("NATIVE_LAYOUT_PAGE_REQUIRED");
  const position = page.main.indexOf("publications");
  page.main.splice(position < 0 ? page.main.length : position, 0, id);
  return section;
}
