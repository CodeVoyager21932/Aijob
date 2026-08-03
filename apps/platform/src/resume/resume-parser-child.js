import mammoth from "mammoth";
import yauzl from "yauzl";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 250;
const MAX_DOCX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_DOCX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 30;
const MAX_RESUME_TEXT_CHARACTERS = 200_000;
const MIN_USEFUL_TEXT_CHARACTERS = 30;

class ParserError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function normalizeText(text) {
  return text
    .replaceAll("\u0000", "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function usefulText(text) {
  const normalized = normalizeText(text).slice(0, MAX_RESUME_TEXT_CHARACTERS);
  if (normalized.replace(/\s/g, "").length < MIN_USEFUL_TEXT_CHARACTERS) {
    throw new ParserError(
      "RESUME_SCANNED_OR_EMPTY",
      "没有提取到足够文本；如果是扫描 PDF，请改用粘贴文本。",
    );
  }
  return normalized;
}

function rejectUnsafeArchiveEntry(entry) {
  const normalizedName = entry.fileName.replaceAll("\\", "/");
  if (
    normalizedName.startsWith("/") ||
    normalizedName.split("/").includes("..") ||
    /(^|\/)vbaProject\.bin$/i.test(normalizedName)
  ) {
    throw new ParserError("RESUME_ARCHIVE_UNSAFE", "DOCX 包含宏或不安全的归档路径。");
  }
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new ParserError("RESUME_ENCRYPTED", "暂不支持加密 DOCX。");
  }
  if (entry.uncompressedSize > MAX_DOCX_ENTRY_BYTES) {
    throw new ParserError("RESUME_ARCHIVE_UNSAFE", "DOCX 内部单个文件过大。");
  }
}

function closeQuietly(zipFile) {
  try {
    zipFile?.close();
  } catch {
    // Best effort after a validation failure.
  }
}

function validateDocxArchive(buffer) {
  return new Promise((resolve, reject) => {
    let zipFile;
    let entryCount = 0;
    let uncompressedBytes = 0;
    let hasContentTypes = false;
    let hasDocument = false;
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      closeQuietly(zipFile);
      if (error) reject(error);
      else resolve();
    };

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
          finish(new ParserError("RESUME_PARSE_FAILED", "DOCX 归档无法读取。"));
          return;
        }
        zipFile = openedZipFile;
        openedZipFile.on("error", () =>
          finish(new ParserError("RESUME_PARSE_FAILED", "DOCX 读取失败。")),
        );
        openedZipFile.on("entry", (entry) => {
          try {
            entryCount += 1;
            uncompressedBytes += entry.uncompressedSize;
            if (entryCount > MAX_DOCX_ENTRIES || uncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
              throw new ParserError(
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
            finish(error instanceof Error ? error : new Error("DOCX validation failed"));
          }
        });
        openedZipFile.on("end", () => {
          if (!hasContentTypes || !hasDocument) {
            finish(
              new ParserError(
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

async function parseDocx(buffer) {
  await validateDocxArchive(buffer);
  const result = await mammoth.extractRawText({ buffer });
  return usefulText(result.value);
}

async function parsePdf(buffer) {
  let loadingTask;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
    });
    const document = await loadingTask.promise;
    try {
      if (document.numPages > MAX_PDF_PAGES) {
        throw new ParserError("RESUME_PARSE_FAILED", "PDF 页数超过 30 页安全上限。");
      }
      const pages = [];
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
      return usefulText(pages.join("\n\n"));
    } finally {
      document.cleanup();
    }
  } catch (error) {
    if (error instanceof ParserError) throw error;
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    if (name === "PasswordException") {
      throw new ParserError("RESUME_ENCRYPTED", "暂不支持加密 PDF。");
    }
    throw new ParserError("RESUME_PARSE_FAILED", "PDF 无法解析。");
  } finally {
    await loadingTask?.destroy();
  }
}

async function readInput() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_INPUT_BYTES) {
      throw new ParserError("RESUME_PARSE_FAILED", "简历文件超过隔离解析上限。");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main() {
  const operation = process.argv[2];
  if (!new Set(["parse-pdf", "parse-docx", "validate-docx"]).has(operation)) {
    throw new ParserError("RESUME_PARSE_FAILED", "解析操作无效。");
  }
  const buffer = await readInput();
  if (operation === "validate-docx") {
    await validateDocxArchive(buffer);
    return { ok: true };
  }
  const text = operation === "parse-pdf" ? await parsePdf(buffer) : await parseDocx(buffer);
  return { ok: true, text };
}

try {
  process.stdout.write(JSON.stringify(await main()));
} catch (error) {
  const code = error instanceof ParserError ? error.code : "RESUME_PARSE_FAILED";
  const message =
    error instanceof ParserError ? error.message : "简历解析失败，请改用粘贴文本。";
  process.stdout.write(JSON.stringify({ ok: false, code, message }));
}
