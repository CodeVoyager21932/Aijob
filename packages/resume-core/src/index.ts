import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { parseResumeDataForWrite } from "@reactive-resume/schema/resume/write";
import { z } from "zod";
import { type NativeSourceBinding, nativeSourceBindingSchema } from "./source-bindings.js";
import { applyNativeTemplate, type NativeTemplateId, nativeTemplateCatalog } from "./templates.js";

export { applyNativeTemplate, type NativeTemplateId, nativeTemplateCatalog } from "./templates.js";

export const NATIVE_CORE_VERSION = "reactive-resume-5.3.0-aijob-1";
export { type NativeImportBlock, nativePdfBlocks, nativeTextBlocks } from "./import-blocks.js";
export {
  importNativeChineseBlocks,
  type NativeImportCorrections,
  type NativeImportMapping,
  type NativeImportResult,
} from "./import-cn.js";
export type NativeResumeData = ResumeData;
export {
  applyNativeImportCorrection,
  type NativeLocalImportCorrection,
  nativeCorrectionEntries,
  nativeDescriptionSegments,
} from "./import-correction.js";
export {
  changeNativeItems,
  type EditableNativeSection,
  ensureNativeResearchSection,
  newNativeItem,
} from "./items.js";
export type { NativeSourceBinding } from "./source-bindings.js";

const envelopeSchema = z.strictObject({
  schemaVersion: z.literal("aijob-native-resume-v1"),
  coreVersion: z.literal(NATIVE_CORE_VERSION),
  data: z.unknown(),
  sourceBindings: z.array(nativeSourceBindingSchema).max(100000).optional(),
  presentation: z
    .strictObject({
      id: z.enum(
        nativeTemplateCatalog.map((item) => item.id) as [NativeTemplateId, ...NativeTemplateId[]],
      ),
      version: z.literal(1),
    })
    .optional(),
});

export interface NativeResumeDocument {
  schemaVersion: "aijob-native-resume-v1";
  coreVersion: typeof NATIVE_CORE_VERSION;
  data: ResumeData;
  /** Provenance of imported fields, not a claim that later edits equal the source. */
  sourceBindings?: NativeSourceBinding[];
  presentation?: { id: NativeTemplateId; version: 1 };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Read fallbacks must never silently remove submitted draft fields. */
export function parseNativeResumeDocument(input: unknown): NativeResumeDocument {
  const envelope = envelopeSchema.parse(input);
  const data = parseResumeDataForWrite(envelope.data);
  const bases = Object.fromEntries(nativeTemplateCatalog.map((item) => [item.id, item.base]));
  if (envelope.presentation && data.metadata.template !== bases[envelope.presentation.id])
    throw new Error("NATIVE_TEMPLATE_BASE_MISMATCH");
  if (canonical(envelope.data) !== canonical(data)) {
    const changedPaths: string[] = [];
    const compare = (left: unknown, right: unknown, path: string) => {
      if (canonical(left) === canonical(right)) return;
      if (left && right && typeof left === "object" && typeof right === "object") {
        for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
          compare(
            (left as Record<string, unknown>)[key],
            (right as Record<string, unknown>)[key],
            `${path}.${key}`,
          );
        }
      } else changedPaths.push(path);
    };
    compare(envelope.data, data, "data");
    // Field paths diagnose contract regressions without logging resume values.
    throw new Error(
      `NATIVE_RESUME_WRITE_WOULD_CHANGE_CONTENT: ${changedPaths.slice(0, 12).join(", ")}`,
    );
  }
  return {
    schemaVersion: envelope.schemaVersion,
    coreVersion: envelope.coreVersion,
    data,
    ...(envelope.sourceBindings ? { sourceBindings: envelope.sourceBindings } : {}),
    ...(envelope.presentation ? { presentation: envelope.presentation } : {}),
  };
}

export function createNativeResumeDocument(): NativeResumeDocument {
  const data = structuredClone(defaultResumeData);
  data.metadata.page.locale = "zh-CN";
  data.metadata.page.format = "a4";
  data.metadata.page.hideIcons = true;
  data.picture.hidden = true;
  data.metadata.design.colors.primary = "rgba(0, 0, 0, 1)";
  data.metadata.typography.body = {
    fontFamily: "Noto Sans SC",
    fontWeights: ["400", "700"],
    fontSize: 10,
    lineHeight: 1.5,
  };
  data.metadata.typography.heading = {
    fontFamily: "Noto Sans SC",
    fontWeights: ["400", "700"],
    fontSize: 12,
    lineHeight: 1.5,
  };
  data.metadata.layout.pages = [
    {
      fullWidth: true,
      main: [
        "summary",
        "education",
        "experience",
        "projects",
        "skills",
        "publications",
        "certifications",
        "awards",
        "languages",
        "volunteer",
        "profiles",
        "interests",
        "references",
      ],
      sidebar: [],
    },
  ];
  const titles: Record<string, string> = {
    education: "教育经历",
    experience: "实习与工作经历",
    projects: "项目经历",
    skills: "技能与工具",
    publications: "论文与成果",
    certifications: "资格证书",
    awards: "荣誉奖项",
    languages: "语言",
    volunteer: "校园与志愿活动",
    profiles: "个人链接",
    interests: "兴趣",
    references: "推荐人",
  };
  data.summary.title = "个人简介";
  for (const [id, section] of Object.entries(data.sections)) section.title = titles[id] ?? id;
  return applyNativeTemplate(
    { schemaVersion: "aijob-native-resume-v1", coreVersion: NATIVE_CORE_VERSION, data },
    "studio-clear-cn",
  );
}

/** A visible blank row still counts as user work; imports must not silently overwrite it. */
export function hasNativeResumeContent(document: NativeResumeDocument): boolean {
  const hasText = (value: unknown): boolean =>
    typeof value === "string"
      ? !!value.trim()
      : value !== null && typeof value === "object"
        ? Object.values(value).some(hasText)
        : false;
  const data = document.data;
  return (
    hasText(data.basics) ||
    !!data.picture.url ||
    !!data.summary.content ||
    Object.values(data.sections).some((section) => section.items.length > 0) ||
    data.customSections.length > 0
  );
}

/** The existing draft transaction stores content and layout separately. */
export function splitNativeResumeDocument(input: unknown) {
  const document = parseNativeResumeDocument(input);
  const { metadata, ...data } = document.data;
  return {
    content: {
      schemaVersion: document.schemaVersion,
      coreVersion: document.coreVersion,
      data,
      ...(document.sourceBindings ? { sourceBindings: document.sourceBindings } : {}),
    },
    layout: {
      schemaVersion: "aijob-native-layout-v1",
      coreVersion: document.coreVersion,
      metadata,
      ...(document.presentation ? { presentation: document.presentation } : {}),
    },
  };
}

export function joinNativeResumeDocument(content: unknown, layout: unknown): NativeResumeDocument {
  const body = z
    .strictObject({
      schemaVersion: z.literal("aijob-native-resume-v1"),
      coreVersion: z.literal(NATIVE_CORE_VERSION),
      data: z.record(z.string(), z.unknown()),
      sourceBindings: envelopeSchema.shape.sourceBindings,
    })
    .parse(content);
  const style = z
    .strictObject({
      schemaVersion: z.literal("aijob-native-layout-v1"),
      coreVersion: z.literal(NATIVE_CORE_VERSION),
      metadata: z.unknown(),
      presentation: envelopeSchema.shape.presentation,
    })
    .parse(layout);
  if ("metadata" in body.data) throw new Error("NATIVE_LAYOUT_DUPLICATED_IN_CONTENT");
  return parseNativeResumeDocument({
    ...body,
    ...(style.presentation ? { presentation: style.presentation } : {}),
    data: { ...body.data, metadata: style.metadata },
  });
}

export {
  insertNativeExperience,
  type NativeExperience,
  nativeExperienceEntries,
  parseNativeExperience,
} from "./experiences.js";
