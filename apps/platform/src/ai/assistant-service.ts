import { randomUUID } from "node:crypto";
import type { AppConfig } from "@aijob/config";
import {
  AssistantContextSchema,
  AssistantResultSchema,
  AssistantSessionSchema,
  type AssistantTask,
  type CreateAssistantSessionSchema,
  type SubmitAssistantTurnSchema,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { joinNativeResumeDocument } from "@aijob/resume-core";
import { type Kysely, sql, type Transaction } from "kysely";
import type { z } from "zod";
import { getApplicationCase, getApplicationCaseRequirements } from "../applications/service.js";
import { createCatalogRepository } from "../catalog/repository.js";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { listNativeExperiences } from "../resume-documents/native-experiences.js";
import { listExperiences, studioJson } from "../resume-documents/studio-service.js";
import { type OwnerTaskLease, withOwnerTaskLease } from "../workers/owner-task-lease.js";
import { nativeAssistantDocument, readAssistantDocument } from "./assistant-document.js";
import {
  ASSISTANT_PROMPT_VERSION,
  assistantFactSources,
  assistantInstruction,
  fixedAssistantHelp,
  validateAssistantGrounding,
} from "./assistant-strategies.js";
import { runResumePreparation } from "./resume-preparation.js";
import { loadUserAiConnection, userAiAvailability, userBudgetProvider } from "./user-ai-service.js";

type Db = Kysely<Database> | Transaction<Database>;
interface SessionRow {
  id: string;
  task: AssistantTask;
  title: string;
  pace: string;
  status: string;
  revision: number;
  context: unknown;
  snapshot: unknown;
  options: unknown;
  document_id: string | null;
  case_id: string | null;
  creation_hash: string;
  created_at: Date;
  updated_at: Date;
}
interface TurnRow {
  id: string;
  ordinal: number;
  user_message: string;
  intent: string;
  question_id: string | null;
  status: string;
  result: unknown;
  failure_code: string | null;
  model: string | null;
  created_at: Date;
  request_hash: string;
  mode: string;
  input_hash: string;
  input_snapshot: unknown;
  execution_status?: "waiting" | "processing" | null;
  provider_revision: number | null;
  provider_connection_id: string | null;
}
const missing = () =>
  new ServiceError(404, "ASSISTANT_SESSION_NOT_FOUND", "这次练习不存在或已删除。");
async function assistantDocumentExists(db: Db, owner: OwnerScope, documentId: string) {
  return Boolean(
    await db
      .selectFrom("profile.resume_documents")
      .select("id")
      .where("id", "=", documentId)
      .where("owner_id", "=", owner.ownerId)
      .where("owner_epoch", "=", owner.ownerEpoch)
      .where("deleted_at", "is", null)
      .executeTakeFirst(),
  );
}
export async function assistantSession(db: Db, owner: OwnerScope, id: string) {
  const row = (
    await sql<SessionRow>`SELECT * FROM profile.assistant_sessions WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND deleted_at IS NULL`.execute(
      db,
    )
  ).rows[0];
  if (!row) throw missing();
  if (
    row.case_id &&
    !(await db
      .selectFrom("application.application_cases")
      .select("id")
      .where("id", "=", row.case_id)
      .where("owner_id", "=", owner.ownerId)
      .where("deleted_at", "is", null)
      .executeTakeFirst())
  )
    throw missing();
  if (row.document_id && !(await assistantDocumentExists(db, owner, row.document_id)))
    throw missing();
  const turns = (
    await sql<TurnRow>`SELECT turn.*,
      CASE WHEN turn.status <> 'queued' THEN NULL
        WHEN EXISTS (SELECT 1 FROM task_queue.tasks task
          WHERE task.task_type='career_assistant' AND task.owner_id=turn.owner_id
            AND task.owner_epoch=turn.owner_epoch
            AND task.payload->>'sessionId'=turn.session_id::text
            AND task.payload->>'turnId'=turn.id::text
            AND task.status='running' AND task.lease_until>now())
          THEN 'processing' ELSE 'waiting' END AS execution_status
      FROM profile.assistant_turns turn WHERE session_id=${id}
        AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} ORDER BY ordinal`.execute(
      db,
    )
  ).rows;
  const snapshotDocument = (row.snapshot as { document?: { editorCore?: string } } | null)
    ?.document;
  return AssistantSessionSchema.parse({
    workflow: (row.options as { workflow?: string } | null)?.workflow ?? "dialogue",
    documentCore: snapshotDocument
      ? snapshotDocument.editorCore === "native-v1"
        ? "native-v1"
        : "legacy"
      : null,
    id: row.id,
    task: row.task,
    title: row.title,
    pace: row.pace,
    status: row.status,
    revision: Number(row.revision),
    context: row.context,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    turns: turns.map((t) => ({
      id: t.id,
      ordinal: Number(t.ordinal),
      userMessage: t.user_message,
      intent: t.intent,
      questionId: t.question_id,
      status: t.status,
      executionStatus: t.execution_status ?? null,
      result: t.result,
      failureCode: t.failure_code,
      model: t.model,
      createdAt: new Date(t.created_at).toISOString(),
    })),
  });
}
export async function createAssistantSession(
  db: Kysely<Database>,
  owner: OwnerScope,
  input: z.infer<typeof CreateAssistantSessionSchema>,
  key: string,
  local: boolean,
) {
  if (
    input.workflow === "resume_prepare" &&
    (input.task !== "resume_review" || !input.context.documentId)
  )
    throw new ServiceError(422, "RESUME_PREPARATION_DOCUMENT_REQUIRED", "请在一份简历中开始准备。");
  let application: unknown = null,
    requirements: unknown = null,
    job: unknown = null;
  if (input.context.caseId) {
    application = await getApplicationCase({ db, owner, caseId: input.context.caseId });
    if (!application) throw missing();
    requirements = await getApplicationCaseRequirements({
      db,
      owner,
      caseId: input.context.caseId,
    });
  }
  if (input.context.jobId) {
    job = await createCatalogRepository({ db, enableLocalMvp: local }).get(input.context.jobId);
    if (!job)
      throw new ServiceError(404, "JOB_NOT_AVAILABLE", "岗位暂时不可用，可以选择自己的材料继续。");
  }
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    if (input.context.caseId) {
      const active = await tx
        .selectFrom("application.application_cases")
        .select("id")
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("id", "=", input.context.caseId)
        .where("deleted_at", "is", null)
        .forShare()
        .executeTakeFirst();
      if (!active) throw missing();
    }
    const hash = hashCanonicalJson(input),
      existing = (
        await sql<{
          id: string;
          creation_hash: string;
        }>`SELECT id,creation_hash FROM profile.assistant_sessions WHERE owner_id=${owner.ownerId} AND creation_key=${key}`.execute(
          tx,
        )
      ).rows[0];
    if (existing) {
      if (existing.creation_hash !== hash)
        throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应不同的练习。");
      return assistantSession(tx, owner, existing.id);
    }
    let document: unknown = null;
    if (input.context.documentId) {
      if (input.context.contentRevisionId && input.context.layoutRevisionId)
        document = await readAssistantDocument(tx, owner, input.context.documentId, {
          contentRevisionId: input.context.contentRevisionId,
          layoutRevisionId: input.context.layoutRevisionId,
        });
      else document = await readAssistantDocument(tx, owner, input.context.documentId);
      await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE owner_id=${owner.ownerId} AND document_id=${input.context.documentId}`.execute(
        tx,
      );
    } else if (input.context.caseId) {
      const submitted = await tx
        .selectFrom("application.submitted_materials")
        .select([
          "document_id",
          "title",
          "content",
          "layout",
          "content_revision_id",
          "layout_revision_id",
        ])
        .where("owner_id", "=", owner.ownerId)
        .where("owner_epoch", "=", owner.ownerEpoch)
        .where("case_id", "=", input.context.caseId)
        .orderBy("submitted_at", "desc")
        .executeTakeFirst();
      if (
        submitted &&
        typeof submitted.content === "object" &&
        submitted.content !== null &&
        "schemaVersion" in submitted.content &&
        submitted.content.schemaVersion === "aijob-native-resume-v1"
      ) {
        document = {
          ...nativeAssistantDocument(
            submitted.document_id,
            null,
            joinNativeResumeDocument(submitted.content, submitted.layout),
          ),
          source: "实际投递稿",
          title: submitted.title,
        };
      } else if (submitted) {
        const layout = structuredClone(submitted.layout) as { studio?: { resources?: unknown } };
        if (layout.studio) delete layout.studio.resources;
        document = { ...submitted, layout, source: "实际投递稿" };
      }
    }
    const available = [
        ...(await listExperiences(tx, owner)),
        ...(await listNativeExperiences(tx, owner)),
      ],
      experiences = input.context.experienceIds.map((id) => {
        const e = available.find((v) => v.id === id);
        if (!e)
          throw new ServiceError(404, "EXPERIENCE_NOT_FOUND", "选择的经历已删除或不属于当前账户。");
        return e;
      });
    if (input.context.experienceIds.length)
      await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND experience_id IN (${sql.join(input.context.experienceIds)})`.execute(
        tx,
      );
    const id = randomUUID(),
      snapshot = {
        document,
        experiences,
        application,
        requirements,
        job,
        initialText: input.context.initialText,
        direction: input.context.direction,
      };
    await sql`INSERT INTO profile.assistant_sessions(id,owner_id,owner_epoch,task,title,pace,context,snapshot,options,document_id,case_id,creation_key,creation_hash) VALUES(${id},${owner.ownerId},${owner.ownerEpoch},${input.task},${input.title},${input.pace},${studioJson(input.context)}::jsonb,${studioJson(snapshot)}::jsonb,${studioJson({ expressionKind: input.expressionKind, length: input.length, workflow: input.workflow })}::jsonb,${input.context.documentId ?? null},${input.context.caseId ?? null},${key},${hash})`.execute(
      tx,
    );
    return assistantSession(tx, owner, id);
  });
}
export async function submitAssistantTurn(
  db: Kysely<Database>,
  owner: OwnerScope,
  id: string,
  input: z.infer<typeof SubmitAssistantTurnSchema>,
  key: string,
  _config: AppConfig,
) {
  const availability = await userAiAvailability(db, owner);
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const session = await assistantSession(tx, owner, id),
      hash = hashCanonicalJson(input);
    const existing = (
      await sql<{
        request_hash: string;
      }>`SELECT request_hash FROM profile.assistant_turns WHERE owner_id=${owner.ownerId} AND session_id=${id} AND idempotency_key=${key}`.execute(
        tx,
      )
    ).rows[0];
    if (existing) {
      if (existing.request_hash !== hash)
        throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应不同的回答。");
      return session;
    }
    if (input.mode === "ai" && !availability.enabled)
      throw new ServiceError(
        409,
        "AI_NOT_READY",
        "请先接入并启用自己的 API；也可以使用固定自检提示。",
      );
    if (session.revision !== input.expectedRevision)
      throw new ServiceError(
        409,
        "ASSISTANT_REVISION_CONFLICT",
        "练习已更新，回答仍保留，请刷新后再发送。",
      );
    if (session.status !== "active")
      throw new ServiceError(409, "ASSISTANT_PAUSED", "先继续这次练习，再发送回答。");
    if (input.intent === "retry" && !input.questionId)
      throw new ServiceError(422, "INTERVIEW_QUESTION_NOT_FOUND", "请先选择需要重答的原题。");
    if (session.turns.some((t) => t.status === "queued"))
      throw new ServiceError(
        409,
        "ASSISTANT_TURN_PENDING",
        "上一条回答正在处理。可以继续输入，完成后再发送。",
      );
    if (
      input.questionId &&
      !session.turns.some((t) => t.id === input.questionId && t.result?.question)
    )
      throw new ServiceError(422, "INTERVIEW_QUESTION_NOT_FOUND", "这道题不在当前练习中。");
    const turnId = randomUUID(),
      ordinal = session.turns.length + 1,
      source = (
        await sql<{
          snapshot: unknown;
        }>`SELECT snapshot FROM profile.assistant_sessions WHERE id=${id} AND owner_id=${owner.ownerId}`.execute(
          tx,
        )
      ).rows[0];
    const result =
      input.mode === "fixed"
        ? fixedAssistantHelp(session.task, session.workflow === "resume_prepare")
        : null;
    const snapshot = source?.snapshot as Record<string, unknown>;
    if (session.task !== "interview" && session.context.documentId)
      snapshot.document = await readAssistantDocument(tx, owner, session.context.documentId);
    if (session.task !== "interview" && session.context.experienceIds.length) {
      const available = [
        ...(await listExperiences(tx, owner)),
        ...(await listNativeExperiences(tx, owner)),
      ];
      snapshot.experiences = session.context.experienceIds.map((id) => {
        const experience = available.find((item) => item.id === id);
        if (!experience)
          throw new ServiceError(404, "EXPERIENCE_NOT_FOUND", "所选经历已删除，请选择其他材料。");
        return experience;
      });
    }
    await sql`INSERT INTO profile.assistant_turns(id,owner_id,owner_epoch,session_id,ordinal,user_message,intent,question_id,status,result,prompt_version,output_version,input_hash,input_snapshot,mode,idempotency_key,request_hash,completed_at,provider_revision,provider_connection_id) VALUES(${turnId},${owner.ownerId},${owner.ownerEpoch},${id},${ordinal},${input.message},${input.intent},${input.questionId},${input.mode === "fixed" ? "fixed" : "queued"},${result ? studioJson(result) : null}::jsonb,${ASSISTANT_PROMPT_VERSION},'career-assistant-result-v1',${hashCanonicalJson({ snapshot, turns: session.turns.map((t) => [t.userMessage, t.intent, t.result]), input, version: ASSISTANT_PROMPT_VERSION, model: availability.model, connectionId: availability.connectionId, connectionRevision: availability.revision })},${studioJson(snapshot)}::jsonb,${input.mode},${key},${hash},${result ? new Date() : null},${input.mode === "ai" ? availability.revision : null},${input.mode === "ai" ? availability.connectionId : null})`.execute(
      tx,
    );
    await sql`UPDATE profile.assistant_sessions SET revision=revision+1,updated_at=now(),status=${input.intent === "finish" && input.mode === "fixed" ? "completed" : "active"} WHERE id=${id} AND owner_id=${owner.ownerId}`.execute(
      tx,
    );
    if (input.mode === "ai")
      await tx
        .insertInto("task_queue.tasks")
        .values({
          id: randomUUID(),
          task_type: "career_assistant",
          owner_id: owner.ownerId,
          owner_epoch: owner.ownerEpoch,
          payload: studioJson({ sessionId: id, turnId }),
          idempotency_key: `career-assistant:${turnId}`,
          status: "queued",
          attempt: 0,
          max_attempts: 3,
          available_at: new Date(),
          backoff_policy: studioJson({ baseMs: 1000, maxMs: 30000 }),
          lease_owner: null,
          lease_until: null,
          heartbeat_at: null,
          last_error_code: null,
          last_error_summary: null,
          completed_at: null,
        })
        .execute();
    return assistantSession(tx, owner, id);
  });
}
/** Retransmit a failed request with the original answer, intent and material snapshot. */
export async function retryAssistantTurn(
  db: Kysely<Database>,
  owner: OwnerScope,
  turnId: string,
  expectedRevision: number,
  key: string,
) {
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const row = (
      await sql<
        TurnRow & { session_id: string }
      >`SELECT * FROM profile.assistant_turns WHERE id=${turnId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    if (!row) throw missing();
    const session = await assistantSession(tx, owner, row.session_id);
    const taskKey = `career-assistant-retry:${owner.ownerId}:${key}`;
    const previous = await tx
      .selectFrom("task_queue.tasks")
      .select("payload")
      .where("idempotency_key", "=", taskKey)
      .where("owner_id", "=", owner.ownerId)
      .executeTakeFirst();
    if (previous) {
      const payload =
        typeof previous.payload === "string" ? JSON.parse(previous.payload) : previous.payload;
      if ((payload as { turnId: string }).turnId !== turnId)
        throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应不同的回答。");
      return session;
    }
    if (session.revision !== expectedRevision)
      throw new ServiceError(
        409,
        "ASSISTANT_REVISION_CONFLICT",
        "练习已更新，原回答仍在，请刷新后重试。",
      );
    if (session.status !== "active")
      throw new ServiceError(409, "ASSISTANT_PAUSED", "先继续这次练习，再重试。");
    if (row.status !== "failed" || session.turns.at(-1)?.id !== turnId)
      throw new ServiceError(
        409,
        "ASSISTANT_RETRY_UNAVAILABLE",
        "只能重试当前失败的一轮；已有后续内容时可以在输入区继续补充。",
      );
    const availability = await userAiAvailability(tx, owner);
    if (!availability.enabled)
      throw new ServiceError(409, "AI_NOT_READY", "请先接入并启用自己的 API。");
    await sql`UPDATE profile.assistant_turns SET status='queued',result=null,failure_code=null,model=null,completed_at=null,provider_revision=${availability.revision},provider_connection_id=${availability.connectionId},input_hash=${hashCanonicalJson({ previous: row.input_hash, connectionId: availability.connectionId, revision: availability.revision })} WHERE id=${turnId}`.execute(
      tx,
    );
    await sql`UPDATE profile.assistant_sessions SET revision=revision+1,updated_at=now() WHERE id=${session.id}`.execute(
      tx,
    );
    await tx
      .insertInto("task_queue.tasks")
      .values({
        id: randomUUID(),
        task_type: "career_assistant",
        owner_id: owner.ownerId,
        owner_epoch: owner.ownerEpoch,
        payload: studioJson({ sessionId: session.id, turnId }),
        idempotency_key: taskKey,
        status: "queued",
        attempt: 0,
        max_attempts: 3,
        available_at: new Date(),
        backoff_policy: studioJson({ baseMs: 1000, maxMs: 30000 }),
        lease_owner: null,
        lease_until: null,
        heartbeat_at: null,
        last_error_code: null,
        last_error_summary: null,
        completed_at: null,
      })
      .execute();
    return assistantSession(tx, owner, session.id);
  });
}

export async function setAssistantSessionStatus(
  db: Kysely<Database>,
  owner: OwnerScope,
  id: string,
  expectedRevision: number,
  status: "active" | "paused" | "completed",
) {
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const session = await assistantSession(tx, owner, id);
    if (session.status === status && session.revision === expectedRevision + 1) return session;
    if (session.revision !== expectedRevision)
      throw new ServiceError(409, "ASSISTANT_REVISION_CONFLICT", "练习已更新，请刷新后操作。");
    if (session.turns.some((t) => t.status === "queued"))
      throw new ServiceError(
        409,
        "ASSISTANT_TURN_PENDING",
        "这一轮正在处理，完成后可以暂停或结束。",
      );
    await sql`UPDATE profile.assistant_sessions SET status=${status},revision=revision+1,updated_at=now() WHERE id=${id} AND owner_id=${owner.ownerId}`.execute(
      tx,
    );
    return assistantSession(tx, owner, id);
  });
}

export async function processAssistantTurn(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  sessionId: string;
  turnId: string;
  config: AppConfig;
  lease: OwnerTaskLease;
  fetchImpl?: typeof fetch | undefined;
  signal?: AbortSignal | undefined;
}) {
  const { db, owner } = input;
  const row = (
    await sql<SessionRow>`SELECT * FROM profile.assistant_sessions WHERE id=${input.sessionId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND deleted_at IS NULL`.execute(
      db,
    )
  ).rows[0];
  if (!row) return;
  if (row.document_id && !(await assistantDocumentExists(db, owner, row.document_id))) {
    await withOwnerTaskLease(db, input.lease, async (tx) => {
      await sql`DELETE FROM profile.assistant_sessions WHERE id=${input.sessionId} AND owner_id=${owner.ownerId}`.execute(
        tx,
      );
    });
    return;
  }
  const turn = (
    await sql<TurnRow>`SELECT * FROM profile.assistant_turns WHERE id=${input.turnId} AND session_id=${input.sessionId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(
      db,
    )
  ).rows[0];
  if (!turn || turn.status !== "queued") return;
  const session = await assistantSession(db, owner, input.sessionId),
    prior = session.turns.filter((t) => t.ordinal < turn.ordinal);
  const context = AssistantContextSchema.parse(row.context);
  let result: z.infer<typeof AssistantResultSchema> | null = null,
    failureCode: string | null = null,
    model: string | null = null;
  try {
    const connection = await loadUserAiConnection(
      db,
      owner,
      input.config,
      turn.provider_revision,
      turn.provider_connection_id,
    );
    model = connection.model;
    if (row.document_id) await readAssistantDocument(db, owner, row.document_id);
    const source = assistantFactSources(turn.input_snapshot, [
      ...prior.map((t) => t.userMessage),
      turn.user_message,
    ]);
    const payload = {
      ...source,
      task: row.task,
      pace: row.pace,
      options: row.options,
      previousTurns: prior,
      intent: turn.intent,
      userMessage: turn.user_message,
      question: turn.question_id
        ? prior.find((t) => t.id === turn.question_id)?.result?.question
        : null,
      direction: context.direction,
    };
    const cached = (
      await sql<{
        result: unknown;
      }>`SELECT result FROM profile.assistant_turns WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND session_id=${input.sessionId} AND input_hash=${turn.input_hash} AND status='completed' AND id<>${turn.id} LIMIT 1`.execute(
        db,
      )
    ).rows[0];
    if (cached) result = AssistantResultSchema.parse(cached.result);
    else if (session.workflow === "resume_prepare") {
      const provider = userBudgetProvider({
        db,
        owner,
        connection,
        purpose: "resume_prepare",
        fetchImpl: input.fetchImpl,
      });
      const saved = AssistantResultSchema.safeParse(turn.result);
      result = await runResumePreparation({
        personalFacts: source.personalFacts,
        payload,
        ...(saved.success ? { savedDraft: saved.data } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
        complete: (request) =>
          provider.completeStructured({
            systemInstruction: request.systemInstruction,
            untrustedPayload: request.payload,
            schema: request.schema,
            ...(input.signal ? { signal: input.signal } : {}),
          }),
        retainDraft: (draft) =>
          withOwnerTaskLease(db, input.lease, async (tx) => {
            await sql`UPDATE profile.assistant_turns SET result=${studioJson(draft)}::jsonb WHERE id=${turn.id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND status='queued'`.execute(
              tx,
            );
          }),
      });
    } else
      result = validateAssistantGrounding(
        await userBudgetProvider({
          db,
          owner,
          connection,
          purpose: row.task,
          fetchImpl: input.fetchImpl,
        }).completeStructured({
          systemInstruction: assistantInstruction(row.task),
          untrustedPayload: payload,
          schema: AssistantResultSchema,
          ...(input.signal ? { signal: input.signal } : {}),
        }),
        source.personalFacts,
        { jobContext: source.jobContext, allowJobArtifact: row.task === "job_explanation" },
      );
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (error instanceof Error && "code" in error && error.code === "AI_CONCURRENCY_LIMIT")
      throw error;
    failureCode =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "AI_RESPONSE_INVALID";
  }
  await withOwnerTaskLease(db, input.lease, async (tx) => {
    const current = (
      await sql<SessionRow>`SELECT * FROM profile.assistant_sessions WHERE id=${input.sessionId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND deleted_at IS NULL FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    if (!current) return;
    if (current.document_id && !(await assistantDocumentExists(tx, owner, current.document_id))) {
      await sql`DELETE FROM profile.assistant_sessions WHERE id=${input.sessionId} AND owner_id=${owner.ownerId}`.execute(
        tx,
      );
      return;
    }
    if (result && session.workflow !== "resume_prepare") delete result.preparationReview;
    if (result && turn.intent === "finish") result = { ...result, question: null };
    const changed = (
      await sql`UPDATE profile.assistant_turns SET result=${result ? studioJson(result) : null}::jsonb,status=${result ? "completed" : "failed"},failure_code=${failureCode},model=${result ? model : null},completed_at=now() WHERE id=${turn.id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND status='queued' RETURNING id`.execute(
        tx,
      )
    ).rows.length;
    if (changed)
      await sql`UPDATE profile.assistant_sessions SET revision=revision+1,updated_at=now(),status=${result && turn.intent === "finish" ? "completed" : current.status} WHERE id=${input.sessionId} AND owner_id=${owner.ownerId}`.execute(
        tx,
      );
  });
}
