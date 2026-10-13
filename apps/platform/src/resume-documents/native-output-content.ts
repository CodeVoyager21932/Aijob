import type { NativeResumeDocument } from "@aijob/resume-core";
import { load } from "cheerio";

function richFragments(html: string): string[] {
  const $ = load(html, null, false);
  const contentNodes = $.root().contents().toArray();
  type Node = (typeof contentNodes)[number];
  const fragments: string[] = [];
  const visit = (nodes: Node[]) => {
    let inline: Node[] = [];
    const flush = () => {
      const text = $(inline).text();
      if (text.trim()) fragments.push(text);
      inline = [];
    };
    for (const node of nodes) {
      if ("name" in node && ["p", "li", "ul", "ol", "div", "blockquote"].includes(node.name)) {
        flush();
        if ("children" in node) visit(node.children);
      } else inline.push(node);
    }
    flush();
  };
  visit(contentNodes);
  return fragments;
}
export function nativeOutputText(document: NativeResumeDocument): string[] {
  const expected: string[] = [];
  const keys = new Set([
    "role",
    "unit",
    "method",
    "authors",
    "authorPosition",
    "status",
    "name",
    "text",
    "headline",
    "email",
    "phone",
    "location",
    "school",
    "degree",
    "area",
    "grade",
    "company",
    "position",
    "period",
    "title",
    "publisher",
    "date",
    "issuer",
    "awarder",
    "proficiency",
    "language",
    "fluency",
    "organization",
    "username",
    "network",
    "description",
    "content",
    "keywords",
  ]);
  const inspect = (value: unknown, key = "") => {
    if (typeof value === "string" && keys.has(key)) {
      if (key === "description" || key === "content") expected.push(...richFragments(value));
      else if (value.trim()) expected.push(value);
    } else if (Array.isArray(value)) for (const item of value) inspect(item, key);
    else if (value && typeof value === "object") {
      if ("hidden" in value && value.hidden === true) return;
      for (const [k, v] of Object.entries(value)) if (k !== "website") inspect(v, k);
    }
  };
  const data = document.data;
  inspect(data.basics);
  const selected = new Set(
    data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]),
  );
  if (selected.has("summary") && !data.summary.hidden) inspect(data.summary.content, "content");
  for (const [id, section] of Object.entries(data.sections))
    if (selected.has(id) && !section.hidden) inspect(section.items);
  for (const section of data.customSections)
    if (selected.has(section.id) && !section.hidden) inspect(section.items);

  return expected;
}

/** Link destinations are checked independently of their visible labels and reading order. */
export function nativeOutputLinks(document: NativeResumeDocument): string[] {
  const urls = new Set<string>();
  const add = (url: unknown) => {
    if (typeof url === "string" && /^(https?:\/\/|mailto:|tel:)/i.test(url)) urls.add(url);
  };
  const inspect = (value: unknown, key = "") => {
    if (typeof value === "string") {
      if (key === "url" || key === "link") add(value);
      if (["description", "content", "recipient"].includes(key)) {
        const $ = load(value, null, false);
        $("a[href]").each((_, node) => {
          add($(node).attr("href"));
        });
      }
    } else if (Array.isArray(value)) value.forEach((item) => inspect(item, key));
    else if (value && typeof value === "object") {
      if ("hidden" in value && value.hidden === true) return;
      for (const [field, child] of Object.entries(value)) inspect(child, field);
    }
  };
  const data = document.data;
  inspect(data.basics);
  const selected = new Set(
    data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]),
  );
  if (selected.has("summary") && !data.summary.hidden) inspect(data.summary.content, "content");
  for (const [id, section] of Object.entries(data.sections))
    if (selected.has(id) && !section.hidden) inspect(section.items);
  for (const section of data.customSections)
    if (selected.has(section.id) && !section.hidden) inspect(section.items);
  return [...urls];
}

export function normalizeNativeLink(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}
