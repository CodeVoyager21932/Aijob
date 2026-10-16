import type { NativeResumeDocument } from "./index.js";

/** Display/export state only. The broader import guard still protects blank rows and hidden work. */
export function hasVisibleNativeResumeContent(document: NativeResumeDocument): boolean {
  const ignored = new Set(["id", "icon", "iconColor", "type"]);
  const text = (value: unknown): boolean => {
    if (typeof value === "string")
      return !!value
        .replace(/<[^>]*>/g, "")
        .replace(/&(?:nbsp|#160|#x0*a0);/gi, " ")
        .trim();
    if (Array.isArray(value)) return value.some(text);
    if (value && typeof value === "object") {
      if ("hidden" in value && value.hidden === true) return false;
      return Object.entries(value).some(([key, part]) => !ignored.has(key) && text(part));
    }
    return false;
  };
  const { data } = document;
  if (text(data.basics) || (!data.picture.hidden && !!data.picture.url)) return true;
  const selected = new Set(
    data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]),
  );
  if (selected.has("summary") && !data.summary.hidden && text(data.summary.content)) return true;
  return [
    ...Object.entries(data.sections),
    ...data.customSections.map((section) => [section.id, section] as const),
  ].some(([id, section]) => selected.has(id) && !section.hidden && text(section.items));
}
