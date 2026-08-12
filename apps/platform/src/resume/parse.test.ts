import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAtsResumeDocx } from "./export-docx.js";
import {
  parseResumeBuffer,
  resumeParserContainerArguments,
  resumeParserEnvironment,
  runResumeParserProcess,
} from "./parse.js";

describe("isolated resume parser", () => {
  it(
    "extracts DOCX text through the child process",
    async () => {
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
    },
    15_000,
  );

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

  it("builds a digest-pinned non-root, no-network and read-only container boundary", () => {
    const image = `registry.example.test/aijob/resume-parser@sha256:${"ab".repeat(32)}`;
    const args = resumeParserContainerArguments(image, "parse-pdf");
    expect(args).toEqual(
      expect.arrayContaining([
        "--network",
        "none",
        "--read-only",
        "--user",
        "65532:65532",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--memory",
        "256m",
        "--pids-limit",
        "32",
        image,
        "parse-pdf",
      ]),
    );
    expect(args).not.toContain("--volume");
    expect(args).not.toContain("--mount");
    expect(() => resumeParserContainerArguments("resume-parser:latest", "parse-pdf")).toThrow(
      "RESUME_PARSER_CONTAINER_IMAGE_IMMUTABLE_DIGEST_REQUIRED",
    );
  });

  it("fails closed when the required container runtime is unavailable", async () => {
    await expect(
      runResumeParserProcess({
        operation: "parse-docx",
        buffer: Buffer.from("synthetic"),
        sandbox: {
          mode: "container",
          containerImage: `registry.example.test/aijob/resume-parser@sha256:${"ab".repeat(32)}`,
          containerRuntimeCommand: "aijob-missing-container-runtime",
        },
      }),
    ).rejects.toMatchObject({ code: "RESUME_PARSE_FAILED" });
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
