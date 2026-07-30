import mammoth from "mammoth";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { normalizeResumeText, ResumeInputError, type ResumeInputKind } from "./security.js";

const MAX_DOCX_ENTRIES = 250;
const MAX_DOCX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_DOCX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 30;
const MAX_RESUME_TEXT_CHARACTERS = 200_000;
const MIN_USEFUL_TEXT_CHARACTERS = 30;

function rejectUnsafeArchiveEntry(entry: Entry): void {
  const normalizedName = entry.fileName.replaceAll("\\", "/");
  if (
    normalizedName.startsWith("/") ||
    normalizedName.split("/").includes("..") ||
    /(^|\/)vbaProject\.bin$/i.test(normalizedName)
  ) {
    throw new ResumeInputError("RESUME_ARCHIVE_UNSAFE", "DOCX 包含宏或不安全的归档路径。");
  }
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new ResumeInputError("RESUME_ENCRYPTED", "暂不支持加密 DOCX。");
  }
  if (entry.uncompressedSize > MAX_DOCX_ENTRY_BYTES) {
    throw new ResumeInputError("RESUME_ARCHIVE_UNSAFE", "DOCX 内部单个文件过大。");
  }
}

function closeQuietly(zipFile: ZipFile | undefined): void {
  try {
    zipFile?.close();
  } catch {
    // Closing is best effort after a validation failure.
  }
}

export function validateDocxArchive(buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let zipFile: ZipFile | undefined;
    let entryCount = 0;
    let uncompressedBytes = 0;
    let hasContentTypes = false;
    let hasDocument = false;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      closeQuietly(zipFile);
      if (error) reject(error);
      else resolve();
    };

    const timeout = setTimeout(
      () =>
        finish(new ResumeInputError("RESUME_PARSE_TIMEOUT", "DOCX 安全检查超时，请改用粘贴文本。")),
      3_000,
    );
    timeout.unref();

    yauzl.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
      },
      (openError, openedZipFile) => {
        if (openError || !openedZipFile) {
          finish(
            new ResumeInputError(
              "RESUME_PARSE_FAILED",
              `DOCX 归档无法读取：${openError?.message ?? "unknown error"}`,
            ),
          );
          return;
        }

        zipFile = openedZipFile;
        openedZipFile.on("error", (error) =>
          finish(new ResumeInputError("RESUME_PARSE_FAILED", `DOCX 读取失败：${error.message}`)),
        );
        openedZipFile.on("entry", (entry: Entry) => {
          try {
            entryCount += 1;
            uncompressedBytes += entry.uncompressedSize;
            if (entryCount > MAX_DOCX_ENTRIES || uncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
              throw new ResumeInputError(
                "RESUME_ARCHIVE_UNSAFE",
                "DOCX 解压后的体积或文件数量超过安全上限。",
              );
            }
            rejectUnsafeArchiveEntry(entry);
            const name = entry.fileName.replaceAll("\\", "/");
            if (name === "[Content_Types].xml") hasContentTypes = true;
            if (name === "word/document.xml") hasDocument = true;
            openedZipFile.readEntry();
          } catch (error) {
            finish(
              error instanceof Error
                ? error
                : new ResumeInputError("RESUME_ARCHIVE_UNSAFE", "DOCX 安全检查失败。"),
            );
          }
        });
        openedZipFile.on("end", () => {
          if (!hasContentTypes || !hasDocument) {
            finish(
              new ResumeInputError(
                "RESUME_TYPE_MISMATCH",
                "文件是 ZIP 归档，但不是有效的 DOCX 文档。",
              ),
            );
            return;
          }
          finish();
        });
        openedZipFile.readEntry();
      },
    );
  });
}

async function parseDocx(buffer: Buffer): Promise<string> {
  await validateDocxArchive(buffer);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    try {
      if (document.numPages > MAX_PDF_PAGES) {
        throw new ResumeInputError("RESUME_PARSE_FAILED", "PDF 页数超过 30 页安全上限。");
      }

      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(
          content.items
            .map((item) => ("str" in item ? item.str : ""))
            .filter(Boolean)
            .join(" "),
        );
        page.cleanup();
      }
      return pages.join("\n\n");
    } finally {
      document.cleanup();
      await loadingTask.destroy();
    }
  } catch (error) {
    if (error instanceof ResumeInputError) throw error;
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    if (name === "PasswordException") {
      throw new ResumeInputError("RESUME_ENCRYPTED", "暂不支持加密 PDF。");
    }
    throw new ResumeInputError(
      "RESUME_PARSE_FAILED",
      `PDF 无法解析：${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function usefulResumeText(text: string): string {
  const normalized = normalizeResumeText(text).slice(0, MAX_RESUME_TEXT_CHARACTERS);
  if (normalized.replace(/\s/g, "").length < MIN_USEFUL_TEXT_CHARACTERS) {
    throw new ResumeInputError(
      "RESUME_SCANNED_OR_EMPTY",
      "没有提取到足够文本；如果是扫描 PDF，请改用粘贴文本。",
    );
  }
  return normalized;
}

export async function parseResumeBuffer(input: {
  kind: Exclude<ResumeInputKind, "text">;
  buffer: Buffer;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 10_000;
  let timeout: NodeJS.Timeout | undefined;
  try {
    const parsePromise = input.kind === "pdf" ? parsePdf(input.buffer) : parseDocx(input.buffer);
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () =>
          reject(
            new ResumeInputError(
              "RESUME_PARSE_TIMEOUT",
              "简历解析超时，请压缩文件或改用粘贴文本。",
            ),
          ),
        timeoutMs,
      );
      timeout.unref();
    });
    return usefulResumeText(await Promise.race([parsePromise, timeoutPromise]));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function parseResumeText(text: string): string {
  return usefulResumeText(text);
}
