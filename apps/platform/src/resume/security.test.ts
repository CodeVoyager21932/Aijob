import { describe, expect, it } from "vitest";
import { decryptResumePayload, encryptResumePayload } from "./crypto.js";
import {
  findPersonalInformation,
  RESUME_DOCX_MIME,
  RESUME_PDF_MIME,
  ResumeInputError,
  redactPersonalInformation,
  validateResumeUpload,
} from "./security.js";

describe("resume upload validation", () => {
  it("accepts matching PDF metadata and signature", () => {
    expect(
      validateResumeUpload({
        filename: "resume.pdf",
        mimetype: RESUME_PDF_MIME,
        buffer: Buffer.from("%PDF-1.7\n"),
        maxBytes: 1_024,
      }),
    ).toBe("pdf");
  });

  it("rejects an extension, MIME and signature mismatch", () => {
    expect(() =>
      validateResumeUpload({
        filename: "resume.docx",
        mimetype: RESUME_DOCX_MIME,
        buffer: Buffer.from("%PDF-1.7\n"),
        maxBytes: 1_024,
      }),
    ).toThrowError(ResumeInputError);
  });

  it("rejects files over the configured size", () => {
    expect(() =>
      validateResumeUpload({
        filename: "resume.pdf",
        mimetype: RESUME_PDF_MIME,
        buffer: Buffer.from("%PDF-1.7\n"),
        maxBytes: 4,
      }),
    ).toThrowError(/不能超过/);
  });
});

describe("resume PII handling", () => {
  const source =
    "电话 13812345678，邮箱 coco@example.com，身份证 11010519900101123X。项目经历保留。";

  it("finds common direct identifiers without returning their plaintext preview", () => {
    const findings = findPersonalInformation(source);
    expect(findings.map((finding) => finding.kind)).toEqual([
      "mobile",
      "email",
      "chinese_identity_number",
    ]);
    expect(findings.every((finding) => !finding.preview.includes("12345678"))).toBe(true);
  });

  it("redacts identifiers while retaining resume evidence text", () => {
    const result = redactPersonalInformation(source);
    expect(result.redactedText).toContain("[手机号已隐藏]");
    expect(result.redactedText).toContain("[邮箱已隐藏]");
    expect(result.redactedText).toContain("[身份证号已隐藏]");
    expect(result.redactedText).toContain("项目经历保留");
  });
});

describe("temporary resume encryption", () => {
  it("round trips AES-GCM payloads and rejects the wrong key", () => {
    const key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const wrongKey = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const plaintext = Buffer.from("confirmed resume evidence");
    const encrypted = encryptResumePayload(plaintext, key);

    expect(decryptResumePayload(encrypted, key)).toEqual(plaintext);
    expect(() => decryptResumePayload(encrypted, wrongKey)).toThrow();
    expect(encrypted.ciphertext).not.toEqual(plaintext);
  });
});
