import type { NativeImportBlock } from "./import-blocks.js";
import { type NativeResumeDocument, parseNativeResumeDocument } from "./index.js";
import { ensureNativeResearchSection, newNativeItem } from "./items.js";

export type NativeCorrectionKind =
  | "education"
  | "experience"
  | "projects"
  | "research"
  | "volunteer";
export type NativeLocalImportCorrection =
  | { type: "move-entry"; itemId: string; target: NativeCorrectionKind }
  | { type: "split-entry"; itemId: string; segmentIndex: number; newItemId: string }
  | {
      type: "assign-field";
      itemId: string;
      field: string;
      value: string;
      originalId: string;
      blockId: string;
    };

const fieldLabels: Record<string, string> = {
  school: "学校",
  degree: "学历",
  area: "专业",
  grade: "成绩",
  location: "地点",
  period: "时间",
  company: "单位",
  position: "职位",
  organization: "组织",
  name: "名称",
  role: "职责",
  unit: "所属单位",
  method: "方法",
  title: "标题",
  publisher: "发表载体",
  date: "日期",
  authors: "作者",
  authorPosition: "作者位次",
  status: "状态",
  issuer: "颁发机构",
  awarder: "颁奖机构",
  proficiency: "熟练程度",
  language: "语言",
  fluency: "水平",
  network: "平台",
  username: "用户名",
  phone: "电话",
  description: "正文",
  content: "正文",
  keywords: "关键词",
  roles: "历任职责",
  website: "链接",
};
type Entry = { id: string; hidden: boolean } & Record<string, unknown>;
type Section = { id: string; kind: string; title: string; items: Entry[] };

function sections(document: NativeResumeDocument): Section[] {
  return [
    ...Object.entries(document.data.sections).map(([id, section]) => ({
      id,
      kind: id,
      title: section.title,
      items: section.items as unknown as Entry[],
    })),
    ...document.data.customSections.map((section) => ({
      id: section.id,
      kind: section.aijobKind ?? section.type,
      title: section.title,
      items: section.items as unknown as Entry[],
    })),
  ];
}

function locate(document: NativeResumeDocument, id: string) {
  const matches = sections(document).flatMap((section) =>
    section.items.filter((item) => item.id === id).map((item) => ({ section, item })),
  );
  const match = matches[0];
  if (matches.length !== 1 || !match) throw new Error("NATIVE_CORRECTION_ENTRY_NOT_FOUND");
  return match;
}

export function nativeCorrectionEntries(document: NativeResumeDocument) {
  return sections(document).flatMap((section) =>
    section.items.map((item) => ({
      id: item.id,
      sectionId: section.id,
      sectionTitle: section.title,
      kind: section.kind,
      title: String(
        item.school || item.company || item.organization || item.name || item.title || "未命名条目",
      ),
      description:
        typeof item.description === "string"
          ? item.description
          : typeof item.content === "string"
            ? item.content
            : "",
      fields: Object.entries(item)
        .filter(([key, value]) => key !== "id" && typeof value === "string" && fieldLabels[key])
        .map(([key, value]) => ({ key, label: fieldLabels[key] ?? key, value: value as string })),
    })),
  );
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
const paragraph = (text: string) => `<p>${escapeHtml(text)}</p>`;
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Split only at complete HTML elements; a list item carries its list wrapper. */
export function nativeDescriptionSegments(html: string): string[] {
  const units: string[] = [];
  let depth = 0;
  let start = 0;
  for (const match of html.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const tag = (match[1] ?? "").toLowerCase();
    const token = match[0];
    if (["br", "hr", "img", "wbr", "input"].includes(tag) || token.endsWith("/>")) continue;
    if (token.startsWith("</")) depth--;
    else depth++;
    if (depth < 0) return html ? [html] : [];
    if (depth === 0) {
      const end = match.index + token.length;
      const unit = html.slice(start, end);
      if (unit.trim()) units.push(unit);
      start = end;
    }
  }
  if (depth !== 0) return html ? [html] : [];
  if (html.slice(start).trim()) units.push(html.slice(start));
  return units.flatMap((unit) => {
    const list = unit.trim().match(/^(<(ul|ol)\b[^>]*>)([\s\S]*)<\/\2>$/i);
    if (!list) return [unit];
    // Keep ordered numbering (including start/value/reversed) unchanged as one complete unit.
    if (list[2]?.toLowerCase() === "ol") return [unit];
    const children = nativeDescriptionSegments(list[3] ?? "");
    return children.map((child) => `${list[1]}${child}</${list[2]}>`);
  });
}

function textValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("；");
  if (typeof value === "object")
    return Object.entries(value)
      .filter(([key]) => !["id", "hidden", "inlineLink"].includes(key))
      .map(([key, item]) => {
        const text = textValue(item);
        return text ? `${fieldLabels[key] ?? key}：${text}` : "";
      })
      .filter(Boolean)
      .join("；");
  return "";
}

function targetSection(document: NativeResumeDocument, kind: NativeCorrectionKind) {
  if (kind === "research") {
    const section = ensureNativeResearchSection(document.data, "aijob:research");
    return {
      id: section.id,
      kind: "projects" as const,
      items: section.items as unknown as Entry[],
    };
  }
  return { id: kind, kind, items: document.data.sections[kind].items as unknown as Entry[] };
}

/** Explicit category changes retain every non-empty old field, using labelled body lines when shapes differ. */
function convertEntry(source: Entry, kind: Exclude<NativeCorrectionKind, "research">): Entry {
  const next = newNativeItem(kind, source.id) as unknown as Entry;
  next.hidden = source.hidden;
  const consumed = new Set(["id", "hidden", "description", "content"]);
  for (const key of Object.keys(next)) {
    if (key in source && key !== "id" && key !== "hidden") {
      next[key] = structuredClone(source[key]);
      consumed.add(key);
    }
  }
  const titleKey =
    kind === "education"
      ? "school"
      : kind === "experience"
        ? "company"
        : kind === "volunteer"
          ? "organization"
          : "name";
  if (!next[titleKey]) {
    const key = ["school", "company", "organization", "name", "title"].find(
      (key) => typeof source[key] === "string" && source[key],
    );
    if (key) {
      next[titleKey] = source[key];
      consumed.add(key);
    }
  }
  const roleKey = kind === "experience" ? "position" : kind === "projects" ? "role" : undefined;
  if (roleKey && !next[roleKey]) {
    const key = ["position", "role"].find((key) => typeof source[key] === "string" && source[key]);
    if (key) {
      next[roleKey] = source[key];
      consumed.add(key);
    }
  }
  const retained = Object.entries(source)
    .filter(([key]) => !consumed.has(key) && !["icon", "iconColor", "level"].includes(key))
    .map(([key, value]) => {
      const text = textValue(value);
      return text ? paragraph(`${fieldLabels[key] ?? key}：${text}`) : "";
    })
    .join("");
  next.description = String(source.description ?? source.content ?? "") + retained;
  return next;
}

/** Applies one explicit edit to the current draft. Never re-imports or re-generates other entries. */
export function applyNativeImportCorrection(
  current: NativeResumeDocument,
  correction: NativeLocalImportCorrection,
  source?: { originalId: string; blocks: readonly NativeImportBlock[] },
): NativeResumeDocument {
  const document = structuredClone(current);
  const { section, item } = locate(document, correction.itemId);
  if (correction.type === "move-entry") {
    const target = targetSection(document, correction.target);
    if (target.id === section.id) return document;
    const next = convertEntry(item, target.kind);
    section.items.splice(section.items.indexOf(item), 1);
    target.items.push(next);
    if (document.sourceBindings)
      document.sourceBindings = document.sourceBindings.map((binding) =>
        binding.itemId === item.id
          ? {
              ...binding,
              sectionId: target.id,
              field:
                binding.field in next
                  ? binding.field
                  : ([
                      "school",
                      "company",
                      "organization",
                      "name",
                      "title",
                      "position",
                      "role",
                    ].find(
                      (key) =>
                        typeof item[binding.field] === "string" &&
                        item[binding.field] &&
                        next[key] === item[binding.field],
                    ) ?? "description"),
            }
          : binding,
      );
  } else if (correction.type === "split-entry") {
    if (
      !correction.newItemId ||
      sections(document).some((value) =>
        value.items.some((entry) => entry.id === correction.newItemId),
      )
    )
      throw new Error("NATIVE_CORRECTION_NEW_ID_REQUIRED");
    const field =
      typeof item.description === "string"
        ? "description"
        : typeof item.content === "string"
          ? "content"
          : null;
    if (!field) throw new Error("NATIVE_CORRECTION_DESCRIPTION_REQUIRED");
    const segments = nativeDescriptionSegments(String(item[field]));
    if (
      !Number.isInteger(correction.segmentIndex) ||
      correction.segmentIndex < 0 ||
      correction.segmentIndex >= segments.length
    )
      throw new Error("NATIVE_CORRECTION_SPLIT_BOUNDARY_INVALID");
    const tail = segments.slice(correction.segmentIndex).join("");
    item[field] = segments.slice(0, correction.segmentIndex).join("");
    let next: Entry;
    if (section.kind === "summary")
      next = { id: correction.newItemId, hidden: false, content: tail };
    else {
      const nativeKind = section.kind === "research" ? "projects" : section.kind;
      if (!["education", "experience", "projects", "volunteer"].includes(nativeKind))
        throw new Error("NATIVE_CORRECTION_SPLIT_KIND_UNSUPPORTED");
      next = newNativeItem(
        nativeKind as Exclude<NativeCorrectionKind, "research">,
        correction.newItemId,
      ) as unknown as Entry;
      next.description = tail;
    }
    section.items.splice(section.items.indexOf(item) + 1, 0, next);
    if (source) {
      const moved = new Set(
        source.blocks
          .filter((block) => {
            const text = plain(block.text);
            return text && plain(tail).includes(text) && !plain(String(item[field])).includes(text);
          })
          .map((block) => block.id),
      );
      if (document.sourceBindings)
        document.sourceBindings = document.sourceBindings.map((binding) =>
          binding.originalId === source.originalId &&
          binding.itemId === item.id &&
          moved.has(binding.blockId)
            ? { ...binding, itemId: next.id, field }
            : binding,
        );
    }
  } else {
    if (
      !source ||
      source.originalId !== correction.originalId ||
      !source.blocks.some((block) => block.id === correction.blockId)
    )
      throw new Error("NATIVE_CORRECTION_SOURCE_NOT_FOUND");
    if (!fieldLabels[correction.field] || typeof item[correction.field] !== "string")
      throw new Error("NATIVE_CORRECTION_FIELD_INVALID");
    item[correction.field] = ["description", "content"].includes(correction.field)
      ? String(item[correction.field]) + paragraph(correction.value)
      : correction.value;
    const binding = {
      originalId: correction.originalId,
      blockId: correction.blockId,
      sectionId: section.id,
      itemId: item.id,
      field: correction.field,
    };
    document.sourceBindings = [
      ...(document.sourceBindings ?? []).filter(
        (value) =>
          !(
            value.originalId === binding.originalId &&
            value.blockId === binding.blockId &&
            value.itemId === binding.itemId &&
            value.field === binding.field
          ),
      ),
      binding,
    ];
  }
  return parseNativeResumeDocument(document);
}
