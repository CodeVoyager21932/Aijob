import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeResumeText, ResumeInputError, type ResumeInputKind } from "./security.js";

const MAX_RESUME_TEXT_CHARACTERS = 200_000;
const MIN_USEFUL_TEXT_CHARACTERS = 30;
const MAX_PARSER_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_PARSE_TIMEOUT_MS = 10_000;
const PARSER_CHILD_PATH = fileURLToPath(new URL("./resume-parser-child.js", import.meta.url));
const CHILD_ENVIRONMENT_ALLOWLIST = [
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "TZ",
  "PATH",
] as const;

type ParserOperation = "parse-pdf" | "parse-docx" | "validate-docx";

export interface ResumeParserSandboxOptions {
  mode: "process" | "container";
  containerImage?: string;
  containerRuntimeCommand?: string;
}

const IMMUTABLE_CONTAINER_IMAGE = /^[^\s]+@sha256:[a-f0-9]{64}$/i;

export function resumeParserContainerArguments(
  image: string,
  operation: ParserOperation,
): string[] {
  if (!IMMUTABLE_CONTAINER_IMAGE.test(image)) {
    throw new Error("RESUME_PARSER_CONTAINER_IMAGE_IMMUTABLE_DIGEST_REQUIRED");
  }
  return [
    "run",
    "--rm",
    "--interactive",
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
    "--memory-swap",
    "256m",
    "--cpus",
    "0.50",
    "--pids-limit",
    "32",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=16m",
    image,
    operation,
  ];
}

interface ParserSuccess {
  ok: true;
  text?: string;
}

interface ParserFailure {
  ok: false;
  code: string;
  message: string;
}

function parserFailure(value: unknown): ParserFailure | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return candidate.ok === false &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
    ? { ok: false, code: candidate.code, message: candidate.message }
    : null;
}

function parserSuccess(value: unknown): ParserSuccess | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.ok !== true) return null;
  return typeof candidate.text === "string"
    ? { ok: true, text: candidate.text }
    : { ok: true };
}

function mappedParserError(failure: ParserFailure): ResumeInputError {
  const allowedCodes = new Set([
    "RESUME_TYPE_MISMATCH",
    "RESUME_ARCHIVE_UNSAFE",
    "RESUME_ENCRYPTED",
    "RESUME_SCANNED_OR_EMPTY",
    "RESUME_PARSE_FAILED",
    "RESUME_PARSE_TIMEOUT",
  ]);
  const code = allowedCodes.has(failure.code)
    ? (failure.code as ConstructorParameters<typeof ResumeInputError>[0])
    : "RESUME_PARSE_FAILED";
  return new ResumeInputError(code, failure.message);
}

export function resumeParserEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const filtered: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    NO_COLOR: "1",
  };
  for (const allowedName of CHILD_ENVIRONMENT_ALLOWLIST) {
    const actualName = Object.keys(environment).find(
      (name) => name.toUpperCase() === allowedName,
    );
    if (actualName && environment[actualName] !== undefined) {
      filtered[allowedName] = environment[actualName];
    }
  }
  return filtered;
}

export async function runResumeParserProcess(input: {
  operation: ParserOperation;
  buffer: Buffer;
  timeoutMs?: number;
  signal?: AbortSignal;
  childPath?: string;
  sandbox?: ResumeParserSandboxOptions;
}): Promise<string | undefined> {
  if (input.signal?.aborted) throw new Error("RESUME_PARSE_ABORTED");
  const timeoutMs = input.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
  const sandbox = input.sandbox ?? { mode: "process" };
  const command =
    sandbox.mode === "container" ? (sandbox.containerRuntimeCommand ?? "docker") : process.execPath;
  const args =
    sandbox.mode === "container"
      ? resumeParserContainerArguments(sandbox.containerImage ?? "", input.operation)
      : ["--max-old-space-size=192", input.childPath ?? PARSER_CHILD_PATH, input.operation];

  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      args,
      {
        env: resumeParserEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const output: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(text);
    };
    const stopChild = () => {
      if (!child.killed) child.kill();
    };
    const abort = () => {
      stopChild();
      finish(new Error("RESUME_PARSE_ABORTED"));
    };
    const timeout = setTimeout(() => {
      stopChild();
      finish(
        new ResumeInputError(
          "RESUME_PARSE_TIMEOUT",
          "简历解析超时，请压缩文件或改用粘贴文本。",
        ),
      );
    }, timeoutMs);
    timeout.unref();
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_PARSER_OUTPUT_BYTES) {
        stopChild();
        finish(new ResumeInputError("RESUME_PARSE_FAILED", "简历解析结果超过安全上限。"));
        return;
      }
      output.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => {
      finish(new ResumeInputError("RESUME_PARSE_FAILED", "简历解析子进程无法启动。"));
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      if (exitCode !== 0) {
        finish(new ResumeInputError("RESUME_PARSE_FAILED", "简历解析子进程异常退出。"));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(output).toString("utf8"));
      } catch {
        finish(new ResumeInputError("RESUME_PARSE_FAILED", "简历解析结果格式无效。"));
        return;
      }
      const failure = parserFailure(parsed);
      if (failure) {
        finish(mappedParserError(failure));
        return;
      }
      const success = parserSuccess(parsed);
      if (!success) {
        finish(new ResumeInputError("RESUME_PARSE_FAILED", "简历解析结果格式无效。"));
        return;
      }
      finish(undefined, success.text);
    });
    child.stdin.on("error", () => {
      if (!settled) {
        stopChild();
        finish(new ResumeInputError("RESUME_PARSE_FAILED", "简历无法发送到隔离解析进程。"));
      }
    });
    child.stdin.end(input.buffer);
  });
}

export async function validateDocxArchive(buffer: Buffer): Promise<void> {
  await runResumeParserProcess({ operation: "validate-docx", buffer, timeoutMs: 3_000 });
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
  signal?: AbortSignal;
  sandbox?: ResumeParserSandboxOptions;
}): Promise<string> {
  const text = await runResumeParserProcess({
    operation: input.kind === "pdf" ? "parse-pdf" : "parse-docx",
    buffer: input.buffer,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.sandbox === undefined ? {} : { sandbox: input.sandbox }),
  });
  if (text === undefined) {
    throw new ResumeInputError("RESUME_PARSE_FAILED", "简历解析没有返回文本。");
  }
  return usefulResumeText(text);
}

export function parseResumeText(text: string): string {
  return usefulResumeText(text);
}
