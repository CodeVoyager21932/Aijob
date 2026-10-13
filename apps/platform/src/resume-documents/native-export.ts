import { resolve } from "node:path";
import type { NativeResumeDocument } from "@aijob/resume-core";
import { nativeRendererVersions, renderNativePdfArtifactIsolated } from "@aijob/resume-renderer/isolated";
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

export function createNativeExport(input: ExportArtifactInput) {
  return createExportWithAdapter(input, {
    load: (tx) => loadNativeSnapshot(tx, input.owner, input.documentId, input.request),
    describe: (snapshot) => ({
      title: snapshot.title,
      versions: {
        templateId: snapshot.document.presentation?.id ?? snapshot.document.data.metadata.template,
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
      return renderResolvedNativeExport(resolvedDocument, input.request.format);
    },
  });
}

/** Already-resolved immutable content; shared by document and submitted-material downloads. */
export async function renderResolvedNativeExport(
  document: NativeResumeDocument,
  format: "pdf" | "docx",
) {
  if (format === "docx") {
    const buffer = await createNativeDocx(document);
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
  const rendered = await renderNativePdfArtifactIsolated(
    document,
    process.env.AIJOB_RESUME_FONT_DIR ?? resolve(import.meta.dirname, "../../../web/public/fonts"),
  );
  const { bytes } = rendered;
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
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
    return { buffer: Buffer.from(bytes), pageCount: pdf.numPages,
      renderMetadata: { anchors: rendered.anchors, pageMap: rendered.pageMap, diagnostics: rendered.diagnostics } };
  } finally {
    await loading.destroy();
  }
}
