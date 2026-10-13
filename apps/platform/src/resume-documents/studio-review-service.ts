import { randomUUID } from "node:crypto";
import {
  type AdoptAssistantResultSchema,
  AssistantContextSchema,
  AssistantResultSchema,
  blankResumeEntry,
  CreateMaterialSnippetRequestSchema,
  CreatePlannerItemRequestSchema,
  ExperienceRecordSchema,
  type ResumeStudioContent,
  ResumeStudioDraftSchema,
  ResumeStudioEntrySchema,
  resumeRichText,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { parseNativeExperience } from "@aijob/resume-core";
import { type Kysely, sql } from "kysely";
import type { z } from "zod";
import type { nativeAssistantDocument } from "../ai/assistant-document.js";
import { blockedPreparationChanges } from "../ai/resume-preparation.js";
import {
  assertActiveOwnerEpoch,
  type OwnerScope,
  retainOwnerAssetsAfterMaterialSave,
} from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { ServiceError } from "../lib/service-error.js";
import { insertPlannerItemInTransaction } from "../planner/service.js";
import { insertMaterialSnippetInTransaction } from "./material-snippets.js";
import { adoptNativeAssistantChanges } from "./native-assistant-adoption.js";
import { updateNativeExperienceInTransaction } from "./native-experiences.js";
import { experienceCaptureHash } from "./studio-content.js";
import {
  getStudioDraft,
  saveStudioDraftInTransaction,
  studioConflict,
  studioJson,
} from "./studio-service.js";

/** ResumeReview owns adopting model edits; the assistant worker only records suggestions. */
export async function adoptAssistantResult(
  db: Kysely<Database>,
  owner: OwnerScope,
  turnId: string,
  request: z.infer<typeof AdoptAssistantResultSchema>,
  key: string,
  local: boolean,
) {
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    const hash = hashCanonicalJson({ turnId, request });
    const replay = (
      await sql<{
        request_hash: string;
        result: unknown;
      }>`SELECT request_hash,result FROM profile.assistant_adoptions WHERE owner_id=${owner.ownerId} AND (idempotency_key=${key} OR (turn_id=${turnId} AND request_hash=${hash}))`.execute(
        tx,
      )
    ).rows[0];
    if (replay) {
      if (replay.request_hash !== hash)
        throw new ServiceError(409, "IDEMPOTENCY_KEY_REUSED", "请求编号对应其他修改。");
      return replay.result;
    }
    const source = (
      await sql<{
        result: unknown;
        input_snapshot: unknown;
        context: unknown;
        options: unknown;
        task: string;
      }>`SELECT t.result,t.input_snapshot,s.context,s.options,s.task FROM profile.assistant_turns t JOIN profile.assistant_sessions s ON s.id=t.session_id AND s.owner_id=t.owner_id WHERE t.id=${turnId} AND t.owner_id=${owner.ownerId} AND t.owner_epoch=${owner.ownerEpoch} AND t.status='completed'`.execute(
        tx,
      )
    ).rows[0];
    if (!source) throw new ServiceError(404, "AI_RESULT_NOT_FOUND", "本轮没有可以采用的 AI 结果。");
    const result = AssistantResultSchema.parse(source.result),
      context = AssistantContextSchema.parse(source.context);
    if (request.target === "resume" && request.changeIds.some((id) => blockedPreparationChanges(result).has(id)))
      throw new ServiceError(422, "AI_REVIEW_UNSUPPORTED_FACT", "这项建议在审阅中发现缺少个人事实依据，尚不能直接采用；当前稿保持不变。");
    let adopted: unknown;
    if (request.target === "resume") {
      if (!context.documentId || request.expectedDraftRevision === undefined)
        throw new ServiceError(422, "RESUME_TARGET_REQUIRED", "请选择要修改的简历。");
      const nativeSource = (
        source.input_snapshot as { document?: ReturnType<typeof nativeAssistantDocument> }
      ).document;
      if (nativeSource?.editorCore === "native-v1") {
        adopted = await adoptNativeAssistantChanges(
          tx,
          owner,
          context.documentId,
          request.expectedDraftRevision,
          nativeSource,
          result,
          request.changeIds,
          key,
        );
      } else {
        const draft = await getStudioDraft(tx, owner, context.documentId);
        if (draft.revision !== request.expectedDraftRevision) throw studioConflict();
        const sourceDoc = ResumeStudioDraftSchema.safeParse(
          (source.input_snapshot as { document?: unknown }).document,
        );
        const changes = result.changes.filter((c) => request.changeIds.includes(c.id));
        if (!changes.length) throw new ServiceError(422, "AI_CHANGE_REQUIRED", "先选择一项修改。");
        const content: ResumeStudioContent = structuredClone(draft.content);
        for (const change of changes) {
          if (change.target === "section_order") {
            if (
              change.sectionIds.length !== content.sections.length ||
              new Set(change.sectionIds).size !== content.sections.length ||
              change.sectionIds.some((id) => !content.sections.some((s) => s.id === id))
            )
              throw new ServiceError(422, "AI_SECTION_ORDER_INVALID", "模型给出的模块顺序不完整。");
            if (
              sourceDoc.success &&
              JSON.stringify(sourceDoc.data.content.sections.map((s) => s.id)) !==
                JSON.stringify(draft.content.sections.map((s) => s.id))
            )
              throw studioConflict();
            content.sections = change.sectionIds.map(
              (id) => content.sections.find((s) => s.id === id)!,
            );
          } else if (change.target === "headline") {
            if (
              sourceDoc.success &&
              sourceDoc.data.content.basics.headline !== draft.content.basics.headline
            )
              throw studioConflict();
            content.basics.headline = change.text.slice(0, 200);
          } else {
            const entry = content.sections
              .flatMap((s) => s.entries)
              .find((e) => e.id === change.entryId);
            if (!entry)
              throw new ServiceError(409, "AI_ENTRY_CHANGED", "原条目已调整，请重新审阅后采用。");
            const previous = sourceDoc.success
              ? sourceDoc.data.content.sections
                  .flatMap((s) => s.entries)
                  .find((e) => e.id === entry.id)
              : null;
            if (
              previous &&
              (change.target === "entry_body"
                ? JSON.stringify(previous.body) !== JSON.stringify(entry.body)
                : previous.title !== entry.title)
            )
              throw studioConflict();
            if (change.target === "entry_body") entry.body = resumeRichText(change.text);
            else entry.title = change.text.slice(0, 500);
          }
        }
        await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE document_id=${context.documentId} AND owner_id=${owner.ownerId}`.execute(
          tx,
        );
        adopted = {
          target: "resume",
          draft: await saveStudioDraftInTransaction(
            tx,
            owner,
            context.documentId,
            { expectedRevision: draft.revision, title: draft.title, content, layout: draft.layout },
            `ai-adopt:${key}`,
          ),
        };
      }
    } else if (request.target === "expression") {
      const body = request.editedBody ?? result.artifact?.body;
      if (!body)
        throw new ServiceError(
          422,
          "AI_ARTIFACT_REQUIRED",
          "本轮还没有成稿，可以继续回答或先形成一版。",
        );
      const options = source.options as { expressionKind?: string };
      adopted = {
        target: "expression",
        material: await insertMaterialSnippetInTransaction(
          tx,
          owner,
          CreateMaterialSnippetRequestSchema.parse({
            title: request.title ?? result.artifact?.title ?? "常用表达",
            kind: options.expressionKind ?? "other",
            body,
            sourceDocumentId: context.documentId ?? null,
            sourceContentRevisionId: null,
            sourceExperienceIds: context.experienceIds,
          }),
        ),
      };
    } else if (request.target === "experience") {
      const body = request.editedBody ?? result.artifact?.body;
      if (!body) throw new ServiceError(422, "AI_ARTIFACT_REQUIRED", "请先形成一版经历。");
      if (source.task === "experience" && context.experienceIds.length === 1) {
        const experienceId = context.experienceIds[0];
        const rawSnapshots =
          (
            source.input_snapshot as {
              experiences?: { id: string; experience?: unknown; revision: number }[];
            }
          ).experiences ?? [];
        const nativeSnapshot = rawSnapshots.find(
          (item) => item.id === experienceId && item.experience,
        );
        if (nativeSnapshot && experienceId) {
          const experience = parseNativeExperience(nativeSnapshot.experience);
          experience.entry.description = body
            .split(/\n/)
            .map(
              (line) =>
                `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
            )
            .join("");
          const updated = await updateNativeExperienceInTransaction(
            tx,
            owner,
            experienceId,
            nativeSnapshot.revision,
            experience,
          );
          adopted = {
            target: "experience",
            experienceId,
            revision: updated?.revision,
            updated: true,
          };
        } else {
          const snapshots = ExperienceRecordSchema.array().parse(
            (source.input_snapshot as { experiences?: unknown }).experiences ?? [],
          );
          const snapshot = snapshots.find((item) => item.id === experienceId);
          if (!snapshot)
            throw new ServiceError(
              409,
              "EXPERIENCE_SOURCE_CHANGED",
              "这段经历的原始上下文不可用，请重新打开整理任务。",
            );
          const entry = ResumeStudioEntrySchema.parse({
            ...snapshot.entry,
            title: request.title ?? snapshot.entry.title,
            body: resumeRichText(body),
            experienceId: null,
            experienceRevision: null,
          });
          const updated = (
            await sql<{
              revision: number;
            }>`UPDATE profile.experiences SET entry=${studioJson(entry)}::jsonb,title=${entry.title || entry.organization || snapshot.title},revision=revision+1,updated_at=now() WHERE id=${experienceId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND revision=${snapshot.revision} RETURNING revision`.execute(
              tx,
            )
          ).rows[0];
          if (!updated)
            throw new ServiceError(
              409,
              "EXPERIENCE_REVISION_CONFLICT",
              "原经历已有修改，请重新整理后采用；现有简历不受影响。",
            );
          await sql`UPDATE profile.resume_experience_links SET capture_open=false WHERE owner_id=${owner.ownerId} AND experience_id=${experienceId}`.execute(
            tx,
          );
          await sql`INSERT INTO profile.experience_revisions(id,owner_id,owner_epoch,experience_id,revision,entry) VALUES(${randomUUID()},${owner.ownerId},${owner.ownerEpoch},${experienceId},${updated.revision},${studioJson(entry)}::jsonb)`.execute(
            tx,
          );
          adopted = {
            target: "experience",
            experienceId,
            revision: Number(updated.revision),
            updated: true,
          };
        }
      } else {
        const entry = {
            ...blankResumeEntry(randomUUID()),
            title: request.title ?? result.artifact?.title ?? "我的经历",
            body: resumeRichText(body),
          },
          hash = experienceCaptureHash("custom", entry),
          id = randomUUID();
        await sql`INSERT INTO profile.experiences(id,owner_id,owner_epoch,kind,title,entry,capture_hash) VALUES(${id},${owner.ownerId},${owner.ownerEpoch},'custom',${entry.title},${studioJson(entry)}::jsonb,${hash}) ON CONFLICT(owner_id,owner_epoch,capture_hash) DO NOTHING`.execute(
          tx,
        );
        const actual = (
          await sql<{
            id: string;
            revision: number;
          }>`SELECT id,revision FROM profile.experiences WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND capture_hash=${hash}`.execute(
            tx,
          )
        ).rows[0]!;
        await sql`INSERT INTO profile.experience_revisions(id,owner_id,owner_epoch,experience_id,revision,entry) VALUES(${randomUUID()},${owner.ownerId},${owner.ownerEpoch},${actual.id},${actual.revision},${studioJson(entry)}::jsonb) ON CONFLICT(owner_id,experience_id,revision) DO NOTHING`.execute(
          tx,
        );
        adopted = { target: "experience", experienceId: actual.id };
      }
    } else {
      const selected = result.preparation.filter(
        (_item, index) =>
          !request.changeIds.length || request.changeIds.includes(`preparation:${index}`),
      );
      if (!selected.length)
        throw new ServiceError(422, "PREPARATION_REQUIRED", "本轮还没有准备建议。");
      const items = [];
      for (const item of selected)
        items.push(
          await insertPlannerItemInTransaction(
            tx,
            owner,
            CreatePlannerItemRequestSchema.parse({
              kind: "preparation",
              title: item.title,
              note: item.detail,
              caseId: context.caseId ?? null,
              sourceExperienceIds: context.experienceIds,
            }),
            local,
          ),
        );
      adopted = { target: "preparation", items };
    }
    await retainOwnerAssetsAfterMaterialSave(tx, owner);
    await sql`INSERT INTO profile.assistant_adoptions(owner_id,owner_epoch,turn_id,idempotency_key,request_hash,result) VALUES(${owner.ownerId},${owner.ownerEpoch},${turnId},${key},${hash},${studioJson(adopted)}::jsonb)`.execute(
      tx,
    );
    return adopted;
  });
}
