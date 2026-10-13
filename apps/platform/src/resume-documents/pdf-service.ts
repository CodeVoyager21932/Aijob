import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import {
  type ResumeDocumentDocxExportQuery,
  type ResumePrintInput,
  relaxOversizedResumeSections,
  relaxOversizedStudioEntries,
  resumePrintHtml,
  usesStudioPagesV2,
  resumePaginationScript,
  resumeContentManifest,
  resumeContentAuditScript,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { type Browser, chromium } from "playwright-core";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import { loadResumeExportSnapshot, safeResumeFileName } from "./export-service.js";
import { studioV3FontCss, studioV3FontDirectory } from './studio-fonts.js';
import { inspectResumePdf, ResumeContentIntegrityError, type ResumePageAudit } from './pdf-integrity.js';

export interface PdfRuntimeConfig {
  executablePath: string;
  fontPath: string;
  serifFontPath?: string | undefined;
  concurrency: number;
  timeoutMs: number;
}
let fontCache: { path: string; mtime: number; css: string } | undefined;
async function localFontCss(path: string) {
  const info = await stat(path);
  if (info.size > 64 * 1024 * 1024 || !info.isFile()) throw new Error("PDF_FONT_FILE_INVALID");
  if (fontCache?.path === path && fontCache.mtime === info.mtimeMs) return fontCache.css;
  const extension = extname(path).toLowerCase();
  const mime = (
    {
      ".ttf": "font/ttf",
      ".otf": "font/otf",
      ".ttc": "font/collection",
      ".woff2": "font/woff2",
    } as Record<string, string>
  )[extension];
  if (!mime) throw new Error("PDF_FONT_FORMAT_UNSUPPORTED");
  const bytes = await readFile(path);
  const css = `@font-face{font-family:AijobPrint;font-style:normal;font-weight:400;src:url(data:${mime};base64,${bytes.toString("base64")});}`;
  fontCache = { path, mtime: info.mtimeMs, css };
  return css;
}
export async function renderResumePdf(input: {
  db: Kysely<Database>;
  snapshot: ResumePrintInput;
  runtime?: PdfRuntimeConfig;
}) {
  const runtime = input.runtime;
  if (!runtime)
    throw new ServiceError(
      503,
      "PDF_RUNTIME_NOT_CONFIGURED",
      "PDF 生成环境尚未配置，可先使用浏览器打印或 DOCX 下载。",
    );
  const serif = input.snapshot.studio?.layout.fontFamily === "serif";
  if (serif && !runtime.serifFontPath)
    throw new ServiceError(
      503,
      "PDF_SERIF_FONT_NOT_READY",
      "宋体类字体尚未配置。可将字体切换为黑体类后下载 PDF，或使用 DOCX 和浏览器打印。",
    );
  const selectedFontPath =
    serif && runtime.serifFontPath ? runtime.serifFontPath : runtime.fontPath;
  const v3 = input.snapshot.studio?.layout.rendererVersion === 'studio-pages-v3';
  const manifest = input.snapshot.studio ? resumeContentManifest(input.snapshot.studio.content) : undefined;
  const fontCss = await (v3 && input.snapshot.studio ? studioV3FontCss(studioV3FontDirectory(runtime.fontPath), input.snapshot.studio.layout) : localFontCss(selectedFontPath)).catch(() => {
    throw new ServiceError(
      503,
      "PDF_FONT_NOT_READY",
      "PDF 中文字体尚未就绪，请使用浏览器打印或 DOCX 下载。",
    );
  });
  const html = resumePrintHtml(input.snapshot, fontCss);
  if (Buffer.byteLength(resumePrintHtml(input.snapshot)) > 2 * 1024 * 1024)
    throw new ServiceError(422, "PDF_CONTENT_TOO_LARGE", "简历内容过长，请精简后生成 PDF。");
  return input.db.connection().execute(async (connection) => {
    let slot: string | undefined;
    for (let index = 0; index < runtime.concurrency; index++) {
      const name = `aijob:pdf-render:${index}`;
      const result = await sql<{
        acquired: boolean;
      }>`SELECT pg_try_advisory_lock(hashtextextended(${name},0)) AS acquired`.execute(connection);
      if (result.rows[0]?.acquired) {
        slot = name;
        break;
      }
    }
    if (!slot)
      throw new ServiceError(
        429,
        "PDF_RENDER_BUSY",
        "PDF 生成容量已满，请稍后重试。浏览器打印仍可使用。",
      );
    let browser: Browser | undefined;
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      void browser?.close().catch(() => {});
    }, runtime.timeoutMs);
    try {
      browser = await chromium.launch({
        executablePath: runtime.executablePath,
        headless: true,
        chromiumSandbox: process.platform === "linux",
        timeout: runtime.timeoutMs,
        proxy: { server: "http://127.0.0.1:9", bypass: "<-loopback>" },
        args: ["--disable-background-networking", "--disable-quic", "--disable-extensions"],
      });
      if (expired) throw new Error("PDF_RENDER_TIMEOUT");
      const context = await browser.newContext({
        viewport: {
          width: Math.round(
            ((210 -
              (input.snapshot.studio
                ? input.snapshot.studio.layout.margin * 2
                : input.snapshot.templateKey === "cn_compact_technical" ||
                    input.snapshot.settings.pageBreakPolicy === "compact_to_fit"
                  ? 28
                  : 36)) *
              96) /
              25.4,
          ),
          height: 1123,
        },
        javaScriptEnabled: false,
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      await context.route("**/*", (route) => route.abort("blockedbyclient"));
      const page = await context.newPage();
      page.setDefaultTimeout(runtime.timeoutMs);
      await page.emulateMedia({ media: "print" });
      await page.setContent(html, { waitUntil: "load", timeout: runtime.timeoutMs });
      await page.evaluate(async (fontFamily) => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map(image => image.decode()));
        if (!document.fonts.check(`12px "${fontFamily}"`, "中文简历"))
          throw new Error("PDF_FONT_LOAD_FAILED");
      },v3 ? `AijobV3${input.snapshot.studio?.layout.fontFamily === 'serif' ? 'Serif' : 'Sans'}` : 'AijobPrint');
      if (input.snapshot.studio && usesStudioPagesV2(input.snapshot.studio.layout))
        await page.evaluate(resumePaginationScript({ keepEntriesTogether: input.snapshot.studio.layout.keepEntriesTogether, autoColumns: input.snapshot.studio.layout.autoColumns !== false }));
      else if (input.snapshot.studio)
        await page.evaluate(relaxOversizedStudioEntries, {
          margin: input.snapshot.studio.layout.margin,
        });
      else
        await page.evaluate(relaxOversizedResumeSections, {
          compact:
            input.snapshot.templateKey === "cn_compact_technical" ||
            input.snapshot.settings.pageBreakPolicy === "compact_to_fit",
        });
      const audit = v3 && manifest ? await page.evaluate<ResumePageAudit>(resumeContentAuditScript(manifest)) : undefined;
      if (audit?.failures.length) throw new ResumeContentIntegrityError('pagination', audit.failures);
      const buffer = await page.pdf({
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
        tagged: true,
      });
      if (expired) throw new Error("PDF_RENDER_TIMEOUT");
      if (buffer.length > 10 * 1024 * 1024)
        throw new ServiceError(422, "PDF_OUTPUT_TOO_LARGE", "PDF 超出下载大小，请精简内容后重试。");
      if (audit && manifest) await inspectResumePdf(buffer, manifest, audit);
      return buffer;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (error instanceof ResumeContentIntegrityError) {
        console.error(JSON.stringify({ event: 'resume_export_integrity_failed', stage: error.stage, fields: error.failures }));
        throw new ServiceError(422, 'RESUME_EXPORT_CONTENT_INCOMPLETE', '导出未通过内容完整性检查，未提供残缺文件。草稿已保留，请重试或使用其他模板。');
      }
      throw new ServiceError(
        503,
        "PDF_RENDER_FAILED",
        "PDF 暂时生成失败，请重试，或使用浏览器打印和 DOCX 下载。",
      );
    } finally {
      clearTimeout(timer);
      await browser?.close().catch(() => {});
      await sql`SELECT pg_advisory_unlock(hashtextextended(${slot},0))`.execute(connection);
    }
  });
}
export async function exportResumeDocumentPdf(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  documentId: string;
  query: ResumeDocumentDocxExportQuery;
  runtime?: PdfRuntimeConfig;
  encryptionKey?: string | undefined;
  allowHistorical?: boolean;
}) {
  const snapshot = await input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    return loadResumeExportSnapshot({ ...input, db: tx });
  });
  const buffer = await renderResumePdf({
    db: input.db,
    snapshot,
    ...(input.runtime ? { runtime: input.runtime } : {}),
  });
  await input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const document = await tx
      .selectFrom("profile.resume_documents")
      .select("id")
      .where("id", "=", input.documentId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!document)
      throw new ServiceError(410, "RESUME_DOCUMENT_DELETED", "简历已删除，本次 PDF 不再提供下载。");
  });
  return {
    buffer,
    fileName: safeResumeFileName(snapshot.title, "pdf"),
    mediaType: "application/pdf",
  };
}
