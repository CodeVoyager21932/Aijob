import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAtsResumeDocx } from "./export-docx.js";
import {
  parseResumeBuffer,
  resumeParserEnvironment,
  runResumeParserProcess,
} from "./parse.js";

describe("isolated resume parser", () => {
  it("extracts DOCX text through the child process", async () => {
    const document = await createAtsResumeDocx({
      title: "测试简历",
      sections: [
        {
          id: "experience",
          heading: "项目经历",
          paragraphs: ["使用 SQL 分析 100 条用户反馈，并完成 3 次需求评审。"],
        },
      ],
    });

    await expect(parseResumeBuffer({ kind: "docx", buffer: document })).resolves.toContain(
      "使用 SQL 分析 100 条用户反馈",
    );
  });

  it("does not inherit database, AI or resume encryption secrets", () => {
    const environment = resumeParserEnvironment({
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      DATABASE_URL: "postgresql://secret",
      AI_API_KEY: "provider-secret",
      RESUME_ENCRYPTION_KEY: "resume-secret",
      NODE_OPTIONS: "--inspect",
    });

    expect(environment.SYSTEMROOT).toBe("C:\\Windows");
    expect(environment.TEMP).toBe("C:\\Temp");
    expect(environment.DATABASE_URL).toBeUndefined();
    expect(environment.AI_API_KEY).toBeUndefined();
    expect(environment.RESUME_ENCRYPTION_KEY).toBeUndefined();
    expect(environment.NODE_OPTIONS).toBeUndefined();
  });

  it("kills a parser that exceeds the hard timeout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aijob-parser-timeout-"));
    const childPath = join(directory, "hang.mjs");
    writeFileSync(childPath, "process.stdin.resume(); setInterval(() => {}, 1000);", "utf8");
    try {
      await expect(
        runResumeParserProcess({
          operation: "parse-docx",
          buffer: Buffer.from("fixture"),
          timeoutMs: 50,
          childPath,
        }),
      ).rejects.toMatchObject({ code: "RESUME_PARSE_TIMEOUT" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("kills the parser when the owning task is aborted", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aijob-parser-abort-"));
    const childPath = join(directory, "hang.mjs");
    writeFileSync(childPath, "process.stdin.resume(); setInterval(() => {}, 1000);", "utf8");
    const controller = new AbortController();
    const parsing = runResumeParserProcess({
      operation: "parse-pdf",
      buffer: Buffer.from("fixture"),
      timeoutMs: 5_000,
      signal: controller.signal,
      childPath,
    });
    controller.abort();
    try {
      await expect(parsing).rejects.toThrow("RESUME_PARSE_ABORTED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
