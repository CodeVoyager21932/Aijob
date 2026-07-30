import { extname } from "node:path";

export const RESUME_PDF_MIME = "application/pdf";
export const RESUME_DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ResumeInputKind = "pdf" | "docx" | "text";
export type PersonalInformationKind = "email" | "mobile" | "chinese_identity_number";

export interface PersonalInformationFinding {
  kind: PersonalInformationKind;
  start: number;
  end: number;
  preview: string;
}

export class ResumeInputError extends Error {
  constructor(
    readonly code:
      | "RESUME_EMPTY"
      | "RESUME_TOO_LARGE"
      | "RESUME_UNSUPPORTED_TYPE"
      | "RESUME_TYPE_MISMATCH"
      | "RESUME_ARCHIVE_UNSAFE"
      | "RESUME_ENCRYPTED"
      | "RESUME_SCANNED_OR_EMPTY"
      | "RESUME_PARSE_FAILED"
      | "RESUME_PARSE_TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "ResumeInputError";
  }
}

function pdfSignatureMatches(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 1_024)).includes(Buffer.from("%PDF-"));
}

function zipSignatureMatches(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const signature = buffer.readUInt32LE(0);
  return signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x08074b50;
}

export function validateResumeUpload(input: {
  filename: string;
  mimetype: string;
  buffer: Buffer;
  maxBytes: number;
}): ResumeInputKind {
  if (input.buffer.length === 0) {
    throw new ResumeInputError("RESUME_EMPTY", "简历文件为空。");
  }
  if (input.buffer.length > input.maxBytes) {
    throw new ResumeInputError(
      "RESUME_TOO_LARGE",
      `简历文件不能超过 ${Math.floor(input.maxBytes / 1024 / 1024)} MiB。`,
    );
  }

  const extension = extname(input.filename).toLowerCase();
  if (extension === ".pdf") {
    if (input.mimetype !== RESUME_PDF_MIME || !pdfSignatureMatches(input.buffer)) {
      throw new ResumeInputError(
        "RESUME_TYPE_MISMATCH",
        "文件扩展名、Content-Type 与 PDF 文件签名不一致。",
      );
    }
    return "pdf";
  }

  if (extension === ".docx") {
    if (input.mimetype !== RESUME_DOCX_MIME || !zipSignatureMatches(input.buffer)) {
      throw new ResumeInputError(
        "RESUME_TYPE_MISMATCH",
        "文件扩展名、Content-Type 与 DOCX 文件签名不一致。",
      );
    }
    return "docx";
  }

  throw new ResumeInputError("RESUME_UNSUPPORTED_TYPE", "仅支持 PDF、DOCX；扫描件请改用粘贴文本。");
}

const PII_PATTERNS: ReadonlyArray<{
  kind: PersonalInformationKind;
  pattern: RegExp;
  placeholder: string;
}> = [
  {
    kind: "chinese_identity_number",
    pattern:
      /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?!\d)/g,
    placeholder: "[身份证号已隐藏]",
  },
  {
    kind: "email",
    pattern: /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?![\w.-])/gi,
    placeholder: "[邮箱已隐藏]",
  },
  {
    kind: "mobile",
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    placeholder: "[手机号已隐藏]",
  },
];

function maskedPreview(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}${"*".repeat(Math.min(8, value.length - 4))}${value.slice(-2)}`;
}

export function findPersonalInformation(text: string): PersonalInformationFinding[] {
  const findings: PersonalInformationFinding[] = [];
  for (const { kind, pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      if (start === undefined) continue;
      findings.push({
        kind,
        start,
        end: start + match[0].length,
        preview: maskedPreview(match[0]),
      });
    }
  }
  return findings.sort((left, right) => left.start - right.start || right.end - left.end);
}

export function redactPersonalInformation(text: string): {
  redactedText: string;
  findings: PersonalInformationFinding[];
} {
  const findings = findPersonalInformation(text);
  let redactedText = text;

  for (const { pattern, placeholder } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    redactedText = redactedText.replace(pattern, placeholder);
  }

  return { redactedText, findings };
}

export function normalizeResumeText(text: string): string {
  return text
    .replaceAll("\u0000", "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
