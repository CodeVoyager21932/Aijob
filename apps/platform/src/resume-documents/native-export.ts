import { resolve } from "node:path";
import {
  applyNativeTemplate,
  type NativeResumeDocument,
  type NativeTemplateId,
} from "@aijob/resume-core";
import {
  nativeRendererVersions,
  renderNativePdfArtifactIsolated,
} from "@aijob/resume-renderer/isolated";
import { load } from "cheerio";
import { convertToHtml, extractRawText } from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ServiceError } from "../lib/service-error.js";
import { createExportWithAdapter, type ExportArtifactInput } from "./export-artifacts.js";
import { loadNativeSnapshot } from "./native-checkpoint.js";
import { createNativeDocx } from "./native-docx.js";
import {
  nativeOutputLinks,
  nativeOutputText,
  normalizeNativeLink,
} from "./native-output-content.js";
import { resolveNativePhoto } from "./native-photo.js";

export function createNativeExport(
  input: ExportArtifactInput & { templateId?: NativeTemplateId | undefined },
) {
  return createExportWithAdapter(
    { ...input, ...(input.templateId ? { variant: `template:${input.templateId}` } : {}) },
    {
      load: async (tx) => {
        const snapshot = await loadNativeSnapshot(tx, input.owner, input.documentId, input.request);
        return input.templateId
          ? { ...snapshot, document: applyNativeTemplate(snapshot.document, input.templateId) }
          : snapshot;
      },
      describe: (snapshot) => ({
        title: snapshot.title,
        versions: {
          templateId:
            snapshot.document.presentation?.id ?? snapshot.document.data.metadata.template,
          templateVersion: `${snapshot.document.coreVersion}:${snapshot.document.presentation?.version ?? 0}`,
          ...nativeRendererVersions(snapshot.document),
        },
        resources: snapshot.document.data.picture.url,
      }),
      render: async (snapshot) => {
        const resolvedDocument = await resolveNativePhoto(
          input.db,
          input.owner,
          snapshot.document,
          input.encryptionKey,
        );
        return renderResolvedNativeExport(resolvedDocument, input.request.format, {
          allowOverflowPreview: input.purpose === "preview",
        });
      },
    },
  );
}

/** Already-resolved immutable content; shared by document and submitted-material downloads. */
export async function renderResolvedNativeExport(
  document: NativeResumeDocument,
  format: "pdf" | "docx",
  options: { allowOverflowPreview?: boolean } = {},
) {
  const rendered = await renderNativePdfArtifactIsolated(
    document,
    process.env.AIJOB_RESUME_FONT_DIR ?? resolve(import.meta.dirname, "../../../web/public/fonts"),
  ).catch((error: unknown) => {
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, string> = {
      NATIVE_FIELD_EMAIL_TOO_WIDE:
        "邮箱在当前字号下放不进所选位置。请选择宽页首或自动位置；原文和字号已保留。",
      NATIVE_FIELD_HEADLINE_TOO_WIDE:
        "求职方向在当前字号下放不进所选位置。请调整换行位置，或选择宽页首；原文和字号已保留。",
      NATIVE_FIELD_BREAK_INVALID:
        "换行位置已不适合当前文字。请重新指定换行位置或恢复自动换行；原文已保留。",
      NATIVE_TEXT_LAYOUT_OVERFLOW:
        "这段文字在当前字号或位置下放不下。请调整换行、对齐或缩进，或撤销本次修改；原文和字号已保留。",
      NATIVE_TEXT_BREAK_INVALID:
        "换行位置已不适合当前文字。请重新点选文字并指定换行，或恢复自动换行；原文已保留。",
    };
    if (messages[code]) throw new ServiceError(422, code, messages[code]);
    throw error;
  });
  if (format === "docx") {
    if (rendered.fit && rendered.fit.pageCount !== 1)
      throw new ServiceError(
        422,
        "NATIVE_SINGLE_PAGE_OVERFLOW",
        "当前排版超出一页。请调整布局、间距或撤销本次排版修改后再下载，完整内容已保留。",
      );
    const fitted = structuredClone(document);
    if (rendered.fittedMetadata) fitted.data.metadata = rendered.fittedMetadata;
    const buffer = await createNativeDocx(fitted);
    const $ = load((await convertToHtml({ buffer })).value);
    const links = new Set(
      $("a[href]")
        .map((_, node) => normalizeNativeLink($(node).attr("href") ?? ""))
        .get(),
    );
    if (nativeOutputLinks(document).some((url) => !links.has(normalizeNativeLink(url))))
      throw new ServiceError(
        422,
        "NATIVE_EXPORT_LINK_INCOMPLETE",
        "DOCX 链接检查未通过，草稿保留。",
      );
    const actual = (await extractRawText({ buffer })).value.normalize("NFKC").replace(/\s/g, "");
    if (
      nativeOutputText(document).some(
        (value) => !actual.includes(value.normalize("NFKC").replace(/\s/g, "")),
      )
    )
      throw new ServiceError(
        422,
        "NATIVE_EXPORT_CONTENT_INCOMPLETE",
        "DOCX 内容检查未通过，草稿保留。",
      );
    return { buffer, pageCount: null };
  }
  const { bytes } = rendered;
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages !== 1 && !options.allowOverflowPreview)
      throw new ServiceError(
        422,
        "NATIVE_SINGLE_PAGE_OVERFLOW",
        "当前排版超出一页。请调整布局、间距或撤销本次排版修改后再下载，完整内容已保留。",
      );
    const parts: string[] = [];
    const links = new Set<string>();
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      for (const annotation of await page.getAnnotations())
        if (annotation.url) links.add(normalizeNativeLink(annotation.url));
      for (const item of (await page.getTextContent()).items)
        if ("str" in item) parts.push(item.str);
    }
    if (nativeOutputLinks(document).some((url) => !links.has(normalizeNativeLink(url))))
      throw new ServiceError(
        422,
        "NATIVE_EXPORT_LINK_INCOMPLETE",
        "PDF 链接检查未通过，草稿保留。",
      );
    const normalize = (value: string) => value.normalize("NFKC").replace(/\s/g, "");
    const actual = normalize(parts.join(""));
    const expected = nativeOutputText(document);
    if (expected.some((value) => !actual.includes(normalize(value))))
      throw new ServiceError(
        422,
        "NATIVE_EXPORT_CONTENT_INCOMPLETE",
        "PDF 内容检查未通过，草稿保留。请调整或重试。",
      );
    return {
      buffer: Buffer.from(bytes),
      pageCount: pdf.numPages,
      renderMetadata: {
        anchors: rendered.anchors,
        pageMap: rendered.pageMap,
        diagnostics: rendered.diagnostics,
        fit: rendered.fit,
      },
    };
  } finally {
    await loading.destroy();
  }
}
