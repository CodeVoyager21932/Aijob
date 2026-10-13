import { z } from "zod";
import {
  createNativeResumeDocument,
  type NativeResumeDocument,
  parseNativeResumeDocument,
} from "./index.js";

export interface NativeExperience {
  schemaVersion: "aijob-native-experience-v1";
  type: "experience" | "projects" | "volunteer";
  kind: "internship" | "project" | "research" | "activity";
  entry: Record<string, unknown> & { id: string; hidden: boolean; description: string };
}
export function parseNativeExperience(input: unknown): NativeExperience {
  const wrapper = z
    .strictObject({
      schemaVersion: z.literal("aijob-native-experience-v1"),
      type: z.enum(["experience", "projects", "volunteer"]),
      kind: z.enum(["internship", "project", "research", "activity"]),
      entry: z.record(z.string(), z.unknown()),
    })
    .parse(input);
  if (
    (wrapper.type === "experience" && wrapper.kind !== "internship") ||
    (wrapper.type === "volunteer" && wrapper.kind !== "activity") ||
    (wrapper.type === "projects" && !["project", "research", "activity"].includes(wrapper.kind))
  )
    throw new Error("NATIVE_EXPERIENCE_KIND_MISMATCH");
  const document = createNativeResumeDocument();
  (document.data.sections[wrapper.type].items as unknown[]) = [wrapper.entry];
  const parsed = parseNativeResumeDocument(document);
  return { ...wrapper, entry: parsed.data.sections[wrapper.type].items[0] } as NativeExperience;
}
export function nativeExperienceEntries(
  document: NativeResumeDocument,
  options: { visibleOnly?: boolean } = {},
): NativeExperience[] {
  const selected = new Set(
    document.data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]),
  );
  const sections = [
    ...(["experience", "projects", "volunteer"] as const).map((type) => ({
      type,
      visible: selected.has(type) && !document.data.sections[type].hidden,
      kind: type === "experience" ? "internship" : type === "volunteer" ? "activity" : "project",
      items: document.data.sections[type].items,
    })),
    ...document.data.customSections
      .filter((section) => ["experience", "projects", "volunteer"].includes(section.type))
      .map((section) => ({
        type: section.type,
        visible: selected.has(section.id) && !section.hidden,
        kind:
          section.aijobKind === "research"
            ? "research"
            : section.aijobKind === "campus" || section.type === "volunteer"
              ? "activity"
              : section.type === "experience"
                ? "internship"
                : "project",
        items: section.items,
      })),
  ];
  return sections
    .filter((section) => !options.visibleOnly || section.visible)
    .flatMap((section) =>
      section.items
        .filter((entry) => !options.visibleOnly || !entry.hidden)
        .map((entry) =>
          parseNativeExperience({
            schemaVersion: "aijob-native-experience-v1",
            type: section.type,
            kind: section.kind,
            entry,
          }),
        ),
    );
}

/** Insert a complete experience into the caller-owned draft, preserving its domain and fields. */
export function insertNativeExperience(document: NativeResumeDocument, input: unknown, id: string) {
  const source = parseNativeExperience(input),
    item = { ...structuredClone(source.entry), id, hidden: false };
  let target: { items: unknown[]; hidden: boolean; id?: string };
  if (source.type === "projects" && source.kind !== "project") {
    const kind = source.kind === "research" ? "research" : "campus";
    let section = document.data.customSections.find(
      (s) => s.type === "projects" && s.aijobKind === kind,
    );
    if (!section) {
      section = {
        id: `section:${id}`,
        type: "projects",
        aijobKind: kind,
        title: kind === "research" ? "科研经历" : "校园经历",
        icon: "",
        columns: 1,
        hidden: false,
        keepTogether: false,
        startOnNewPage: false,
        items: [],
      };
      document.data.customSections.push(section);
      document.data.metadata.layout.pages[0]?.main.push(section.id);
    }
    target = section;
  } else {
    target = document.data.sections[source.type];
    if (
      !document.data.metadata.layout.pages.some((page) =>
        [...page.main, ...page.sidebar].includes(source.type),
      )
    )
      document.data.metadata.layout.pages[0]?.main.push(source.type);
  }
  target.items.push(item);
  target.hidden = false;
  parseNativeResumeDocument(document);
}
