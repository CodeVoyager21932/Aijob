import { ResumeTextSubmissionSchema, UuidSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { requireOwnerContext } from "../identity/fastify.js";
import { ApiProblem, isApiProblem, sendApiProblem } from "../identity/http.js";
import { getResumeAnalysis, submitResumeAnalysis } from "./repository.js";
import { findPersonalInformation, ResumeInputError, validateResumeUpload } from "./security.js";

const paramsSchema = z.object({ analysisId: UuidSchema });
const idempotencyKeySchema = z.string().trim().min(1).max(200);

function piiSummary(text: string) {
  const counts = new Map<"phone" | "email" | "national_id", number>();
  for (const finding of findPersonalInformation(text)) {
    const kind =
      finding.kind === "mobile"
        ? "phone"
        : finding.kind === "chinese_identity_number"
          ? "national_id"
          : "email";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

function requestIdempotencyKey(headers: Record<string, unknown>): string {
  return idempotencyKeySchema.parse(headers["idempotency-key"]);
}

function isMultipartLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return [
    "FST_REQ_FILE_TOO_LARGE",
    "FST_FILES_LIMIT",
    "FST_FIELDS_LIMIT",
    "FST_PARTS_LIMIT",
  ].includes(String(error.code));
}

export interface ResumeRouteOptions {
  db: Kysely<Database>;
  encryptionKey: string;
  maxBytes: number;
  encryptionKeyVersion?: string;
}

export function registerResumeRoutes(app: FastifyInstance, options: ResumeRouteOptions): void {
  app.register(multipart, {
    limits: {
      files: 1,
      fileSize: options.maxBytes,
      fields: 0,
      parts: 1,
    },
  });

  app.post("/v1/resume-analyses", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const idempotencyKey = requestIdempotencyKey(request.headers);

      if (request.isMultipart()) {
        const file = await request.file({
          limits: { files: 1, fileSize: options.maxBytes, fields: 0, parts: 1 },
        });
        if (!file) {
          throw new ApiProblem(
            400,
            "RESUME_FILE_REQUIRED",
            "没有收到简历文件",
            "请选择 PDF 或 DOCX 文件后重试。",
          );
        }
        const buffer = await file.toBuffer();
        const kind = validateResumeUpload({
          filename: file.filename,
          mimetype: file.mimetype,
          buffer,
          maxBytes: options.maxBytes,
        });
        const result = await submitResumeAnalysis({
          db: options.db,
          owner,
          idempotencyKey,
          inputKind: kind === "pdf" ? "pdf" : "docx",
          filename: file.filename,
          mediaType: file.mimetype,
          plaintext: buffer,
          encryptionKey: options.encryptionKey,
          ...(options.encryptionKeyVersion
            ? { encryptionKeyVersion: options.encryptionKeyVersion }
            : {}),
        });
        return reply.code(202).send(result.analysis);
      }

      const body = ResumeTextSubmissionSchema.parse(request.body);
      const plaintext = Buffer.from(body.text, "utf8");
      if (plaintext.byteLength > options.maxBytes) {
        throw new ResumeInputError(
          "RESUME_TOO_LARGE",
          `简历文本不能超过 ${Math.floor(options.maxBytes / 1024 / 1024)} MiB。`,
        );
      }
      const result = await submitResumeAnalysis({
        db: options.db,
        owner,
        idempotencyKey,
        inputKind: "pasted_text",
        filename: null,
        mediaType: "text/plain",
        plaintext,
        encryptionKey: options.encryptionKey,
        piiSummary: piiSummary(body.text),
        ...(options.encryptionKeyVersion
          ? { encryptionKeyVersion: options.encryptionKeyVersion }
          : {}),
      });
      return reply.code(202).send(result.analysis);
    } catch (error) {
      if (isApiProblem(error)) return sendApiProblem(request, reply, error);
      if (error instanceof ResumeInputError) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(400, error.code, "简历无法接收", error.message),
        );
      }
      if (isMultipartLimitError(error)) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            400,
            "RESUME_TOO_LARGE",
            "简历文件超过安全上限",
            `单个简历文件不能超过 ${Math.floor(options.maxBytes / 1024 / 1024)} MiB，且一次只能提交一个文件。`,
          ),
        );
      }
      if (error instanceof z.ZodError) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            400,
            "INVALID_RESUME_REQUEST",
            "简历请求格式不正确",
            "请粘贴有效简历文本，并为请求提供 Idempotency-Key。",
          ),
        );
      }
      throw error;
    }
  });

  app.get("/v1/resume-analyses/:analysisId", async (request, reply) => {
    try {
      const owner = requireOwnerContext(request);
      const { analysisId } = paramsSchema.parse(request.params);
      const analysis = await getResumeAnalysis({
        db: options.db,
        ownerId: owner.ownerId,
        ownerEpoch: owner.ownerEpoch,
        analysisId,
        encryptionKey: options.encryptionKey,
      });
      if (!analysis) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            404,
            "RESUME_ANALYSIS_NOT_FOUND",
            "没有找到这次简历解析",
            "记录不存在，已被删除，或不属于当前匿名会话。",
          ),
        );
      }
      return reply.send(analysis);
    } catch (error) {
      if (isApiProblem(error)) return sendApiProblem(request, reply, error);
      if (error instanceof z.ZodError) {
        return sendApiProblem(
          request,
          reply,
          new ApiProblem(
            400,
            "INVALID_RESUME_ANALYSIS_ID",
            "简历解析编号不正确",
            "请从当前简历页面重新打开这条记录。",
          ),
        );
      }
      throw error;
    }
  });
}
