import { z } from "zod";

export type ResumeRichNode = {
  type: "doc" | "paragraph" | "bulletList" | "orderedList" | "listItem" | "text" | "hardBreak";
  text?: string | undefined;
  attrs?: { start?: number | undefined } | undefined;
  marks?:
    | {
        type: "bold" | "italic" | "underline" | "link";
        attrs?:
          | {
              href: string;
              target?: string | null | undefined;
              rel?: string | null | undefined;
              class?: string | null | undefined;
            }
          | undefined;
      }[]
    | undefined;
  content?: ResumeRichNode[] | undefined;
};
export const ResumeLinkSchema = z
  .string()
  .max(2000)
  .refine((s) => /^(https?:\/\/|mailto:|tel:)/i.test(s), "请使用完整的网页、邮箱或电话链接");
const LinkAttributesSchema = z
  .object({
    href: ResumeLinkSchema,
    target: z.string().nullable().optional(),
    rel: z.string().nullable().optional(),
    class: z.string().nullable().optional(),
  })
  .strict();
const RichNodeSchema: z.ZodType<ResumeRichNode> = z.lazy(() =>
  z
    .object({
      type: z.enum([
        "doc",
        "paragraph",
        "bulletList",
        "orderedList",
        "listItem",
        "text",
        "hardBreak",
      ]),
      text: z.string().max(10000).optional(),
      attrs: z
        .object({ start: z.number().int().min(1).max(10000).optional() })
        .strict()
        .optional(),
      marks: z
        .array(
          z
            .object({
              type: z.enum(["bold", "italic", "underline", "link"]),
              attrs: LinkAttributesSchema.optional(),
            })
            .strict(),
        )
        .max(4)
        .optional(),
      content: z.array(RichNodeSchema).max(200).optional(),
    })
    .strict(),
);
export const ResumeRichTextSchema = z
  .preprocess((value, ctx) => {
    let nodes = 0;
    const walk = (v: unknown, depth: number): boolean => {
      if (++nodes > 3000 || depth > 12 || !v || typeof v !== "object") return false;
      const n = v as ResumeRichNode;
      return !n.content || (Array.isArray(n.content) && n.content.every((c) => walk(c, depth + 1)));
    };
    if (!walk(value, 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "文字内容过大或嵌套过深", fatal: true });
      return z.NEVER;
    }
    return value;
  }, RichNodeSchema)
  .refine((n) => n.type === "doc", "正文必须是文档");

export const ResumeSectionKindSchema = z.enum([
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
]);
export const ResumeStudioEntrySchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().max(500),
    organization: z.string().max(200),
    role: z.string().max(200),
    location: z.string().max(100),
    startDate: z.string().max(40),
    endDate: z.string().max(40),
    degree: z.string().max(100),
    major: z.string().max(100),
    details: z.object({
      department: z.string().max(200).optional(),
      background: z.string().max(3000).optional(),
      methods: z.string().max(3000).optional(),
      results: z.string().max(3000).optional(),
      gpa: z.string().max(100).optional(),
      courses: z.string().max(1000).optional(),
      researchFocus: z.string().max(1000).optional(),
      authors: z.string().max(1500).optional(),
      venue: z.string().max(500).optional(),
      publicationStatus: z.string().max(100).optional(),
      // Plain URL fields are editable drafts; renderers only activate supported protocols.
      url: z.string().max(2000).optional(),
      skillCategory: z.string().max(200).optional(),
      proficiency: z.string().max(200).optional(),
      issuer: z.string().max(200).optional(),
    }).strict().optional(),
    body: ResumeRichTextSchema,
    hidden: z.boolean().default(false),
    pageBreakBefore: z.boolean().default(false),
    experienceId: z.string().uuid().nullable().default(null),
    experienceRevision: z.number().int().positive().nullable().default(null),
  })
  .strict();
export const ResumeStudioSectionSchema = z
  .object({
    id: z.string().uuid(),
    kind: ResumeSectionKindSchema,
    title: z.string().min(1).max(100),
    hidden: z.boolean().default(false),
    pageBreakBefore: z.boolean().default(false),
    column: z.enum(["main", "aside"]).default("main"),
    entries: z.array(ResumeStudioEntrySchema).max(100),
  })
  .strict();
export const ResumeStudioContentSchema = z
  .object({
    schemaVersion: z.enum(["resume-studio-v1", "resume-studio-v2"]),
    basics: z
      .object({
        name: z.string().max(100),
        headline: z.string().max(200),
        phone: z.string().max(100),
        email: z.string().max(200),
        city: z.string().max(100),
        photoId: z.string().uuid().nullable().optional(),
        links: z
          .array(
            z
              .object({
                id: z.string().min(1).max(100).optional(),
                label: z.string().max(100),
                url: z.string().max(2000),
              })
              .strict(),
          )
          .max(10),
      })
      .strict(),
    sections: z.array(ResumeStudioSectionSchema).max(40),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.sections.flatMap((s) => [s.id, ...s.entries.map((e) => e.id)]);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "模块或条目编号重复" });
    if (JSON.stringify(value).length > 300000)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "文档内容超过保存范围" });
  });
export const ResumeStudioTemplateSchema = z.enum([
  "cn_clear_single_column",
  "cn_classic_single_column",
  "cn_compact_technical",
  "cn_simple_two_column",
  "cn_research_multi_page",
  'jp_classic', 'jp_ats', 'jp_euro', 'magic_cn_formal_photo', 'rx_onyx', 'rx_scizor',
  'jp_modern_minimal', 'magic_clean_minimal', 'magic_executive_band', 'rx_lapras', 'rx_meowth', 'rx_kakuna',
  'jp_engineer', 'jp_swiss', 'magic_product_ops_focus', 'magic_compact_cn_photo',
  'rx_azurill', 'rx_bronzor', 'rx_chikorita', 'rx_ditto', 'rx_glalie',
  'jp_academic', 'jp_scientist', 'rx_rhyhorn',
  'jp_modern', 'jp_berlin', 'jp_designer', 'jp_blocks', 'jp_ribbon', 'rx_gengar',
  'rx_ditgar', 'rx_leafish', 'rx_pikachu', 'lapis_cn', 'billryan_cn',
  'rendercv_classic', 'rendercv_engineering', 'bre_cool', 'bre_creative', 'bre_oblique',
]);
export const ResumeStudioLayoutSchema = z
  .object({
    templateKey: ResumeStudioTemplateSchema.default("cn_clear_single_column"),
    fontFamily: z.enum(["sans", "serif"]).default("sans"),
    fontSize: z.number().min(9).max(16).default(11),
    lineHeight: z.number().min(1.1).max(2).default(1.45),
    sectionGap: z.number().min(4).max(28).default(12),
    margin: z.number().min(10).max(30).default(18),
    columns: z.enum(["auto", "one", "two"]).default("auto"),
    accent: z.enum(["ink", "green", "navy"]).default("ink"),
    keepEntriesTogether: z.boolean().default(true),
    templateVersion: z.string().max(100).optional(),
    rendererVersion: z.enum(['studio-pages-v1', 'studio-pages-v2', 'studio-pages-v3']).optional(),
    fontSetVersion: z.literal('cjk-2026-09-10.1').optional(),
    typography: z.object({
      namePt: z.number().min(12).max(36),
      headingPt: z.number().min(9).max(20),
      entryPt: z.number().min(9).max(16),
      contactPt: z.number().min(8).max(14),
      datePt: z.number().min(8).max(14),
      headingFamily: z.enum(['sans', 'serif']),
    }).strict().optional(),
    regions: z.object({
      marginYmm: z.number().min(8).max(30),
      gapMm: z.number().min(3).max(12),
      sidebarPaddingMm: z.number().min(0).max(10),
    }).strict().optional(),
    colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    paragraphGap: z.number().min(0).max(16).optional(),
    entryGap: z.number().min(0).max(24).optional(),
    columnRatio: z.number().min(0.22).max(0.45).optional(),
    photoVisible: z.boolean().optional(),
    autoColumns: z.boolean().optional(),
  })
  .strict().superRefine((layout, ctx) => {
    if (layout.rendererVersion === 'studio-pages-v3' && (!layout.templateVersion || !layout.fontSetVersion || !layout.typography || !layout.regions))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '新版版式须包含模板、字体、字号层级和区域设置。', path: ['rendererVersion'] });
    if (layout.rendererVersion !== 'studio-pages-v3' && (layout.fontSetVersion || layout.typography || layout.regions || layout.colorHex))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '新版排版参数不能混入历史布局。', path: ['rendererVersion'] });
  });
export const ResumeStudioDraftSchema = z.object({
  documentId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  title: z.string().min(1).max(200),
  content: ResumeStudioContentSchema,
  layout: ResumeStudioLayoutSchema,
  updatedAt: z.string().datetime(),
  contentRevisionId: z.string().uuid().nullable(),
  layoutRevisionId: z.string().uuid().nullable(),
});
export const SaveResumeStudioDraftSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200),
    content: ResumeStudioContentSchema,
    layout: ResumeStudioLayoutSchema,
  })
  .strict();
export const CreateResumeStudioSchema = z
  .object({
    title: z.string().trim().min(1).max(200).default("我的简历"),
    copyFromDocumentId: z.string().uuid().optional(),
    experienceIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict();
export type ResumeStudioContent = z.infer<typeof ResumeStudioContentSchema>;
export type ResumeStudioEntry = z.infer<typeof ResumeStudioEntrySchema>;
export type ResumeStudioSection = z.infer<typeof ResumeStudioSectionSchema>;
export type ResumeStudioLayout = z.infer<typeof ResumeStudioLayoutSchema>;
export type ResumeStudioDraft = z.infer<typeof ResumeStudioDraftSchema>;
export type SaveResumeStudioDraft = z.infer<typeof SaveResumeStudioDraftSchema>;
export type ResumeSectionKind = z.infer<typeof ResumeSectionKindSchema>;

export function resumeRichText(text: string): ResumeRichNode {
  return {
    type: "doc",
    content: text.split(/\r?\n/).map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}
export function resumeRichPlain(node: ResumeRichNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const separator = ["doc", "bulletList", "orderedList", "listItem"].includes(node.type)
    ? "\n"
    : "";
  return (node.content ?? []).map(resumeRichPlain).join(separator);
}
export function blankResumeStudioContent(): ResumeStudioContent {
  return {
    schemaVersion: "resume-studio-v2",
    basics: { name: "", headline: "", phone: "", email: "", city: "", links: [] },
    sections: [],
  };
}
export function blankResumeEntry(id: string): ResumeStudioEntry {
  return {
    id,
    title: "",
    organization: "",
    role: "",
    location: "",
    startDate: "",
    endDate: "",
    degree: "",
    major: "",
    body: resumeRichText(""),
    hidden: false,
    pageBreakBefore: false,
    experienceId: null,
    experienceRevision: null,
  };
}
export const ExperienceRecordSchema = z.object({
  id: z.string().uuid(),
  kind: ResumeSectionKindSchema,
  title: z.string(),
  entry: ResumeStudioEntrySchema,
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ExperienceRecord = z.infer<typeof ExperienceRecordSchema>;
export const ResumeOriginalSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  filename: z.string(),
  mediaType: z.string(),
  byteSize: z.number(),
  createdAt: z.string().datetime(),
  status: z.enum(["queued", "succeeded", "failed", "ready"]),
  failureCode: z.string().nullable(),
});
export type ResumeOriginal = z.infer<typeof ResumeOriginalSchema>;
