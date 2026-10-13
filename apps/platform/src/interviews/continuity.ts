import { type JobRequirement, ResumeSemanticContentSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import {
  joinNativeResumeDocument,
  type NativeResumeDocument,
  nativeExperienceEntries,
} from "@aijob/resume-core";
import { load } from "cheerio";
import { type Kysely, sql, type Transaction } from "kysely";
import { z } from "zod";
import type { OwnerScope } from "../identity/session-repository.js";
import { semanticContent } from "../resume-documents/export-service.js";
import { nativeOutputText } from "../resume-documents/native-output-content.js";
export const CONTINUOUS_INTERVIEW_VERSION = "deterministic-zh-cn-v2-continuity";
const SeedSchema = z.object({ content: z.string(), requirementIds: z.array(z.string()) });
const ContextSchema = z.object({
  version: z.literal("interview-continuity-v1"),
  materialKind: z.enum(["submitted", "working_resume"]),
  materialId: z.string().uuid(),
  materialTitle: z.string(),
  materialQuotes: z.array(z.string()),
  previousAnswers: z.array(z.string()),
  plan: z.array(SeedSchema).min(1).max(6),
});
export type InterviewContinuity = z.infer<typeof ContextSchema>;
export function buildContinuousInterviewPlan(input: {
  requirements: JobRequirement[];
  persisted: ReadonlySet<string>;
  materialKind: "submitted" | "working_resume";
  quotes: string[];
  previousAnswers: string[];
}) {
  // Prioritize the requirements the owner has already worked on; a new user can still practice without setting every requirement state.
  const focused = input.persisted.size
    ? input.requirements.filter((value) => input.persisted.has(value.id))
    : input.requirements;
  const seeds = focused
    .filter(
      (value) => value.sourceText.trim() && value.operator !== "unknown" && value.kind !== "other",
    )
    .slice(0, 3)
    .map((value) => ({
      content: `目标岗位原文：“${value.sourceText.slice(0, 2000)}”。请结合真实经历说明你做过什么、如何完成；没有经历可以说明准备方向。`,
      requirementIds: input.persisted.has(value.id) ? [value.id] : [],
    }));
  const quote = input.quotes[0];
  const materialQuestion = quote
    ? `你${input.materialKind === "submitted" ? "实际投递的简历" : "当前保存的简历"}中写道：“${quote.slice(0, 1600)}”。请说明这段经历与目标要求的关系，以及个人职责、具体方法与可核对产物。`
    : "";
  if (materialQuestion && seeds[0])
    seeds[0] = { ...seeds[0], content: `${seeds[0].content}\n\n${materialQuestion}` };
  const previous = input.previousAnswers[0];
  seeds.push({
    content: `${!seeds.length && materialQuestion ? `${materialQuestion}\n\n` : ""}${previous ? `此前你回答过：“${previous.slice(0, 700)}”。现在有哪些补充或修正？\n\n` : ""}回到这个岗位：请选出一项最需要准备的能力，说明已有证据、尚缺的产物和下一步行动。`,
    requirementIds: [],
  });
  return seeds;
}
export function continueFromAnswer(
  seed: z.infer<typeof SeedSchema>,
  answer: string,
  earlierAnswers: string[],
) {
  const visible = answer.trim().slice(0, 500);
  const missing = !/(我|本人|负责|独立|主导)/.test(answer)
    ? "请说清你自己的职责与行动。"
    : !/(产出|结果|报告|交付|完成|指标|结论|提升|下降|增长|%|％)/.test(answer)
      ? "请补充实际产物或结果；没有量化数据时直接说明。"
      : "请补充一次具体取舍，以及用于核对结果的证据。";
  const prior = earlierAnswers.at(-1);
  return {
    ...seed,
    content: `你刚才回答：“${visible}”。${missing}${prior ? `\n此前还提到：“${prior.slice(0, 250)}”。如有关联，请说明两者如何对应。` : ""}\n\n接着讨论：${seed.content}`,
  };
}
function nativeQuotes(document: NativeResumeDocument) {
  const entries = nativeExperienceEntries(document, { visibleOnly: true })
    .map((item) => load(item.entry.description).text().trim())
    .filter(Boolean);
  return [...new Set([...entries, ...nativeOutputText(document)])];
}
export async function prepareInterviewContinuity(input: {
  tx: Transaction<Database>;
  owner: OwnerScope;
  caseId: string;
  resumeContentRevisionId: string;
  requirements: JobRequirement[];
  persisted: ReadonlySet<string>;
}) {
  const submitted = await input.tx
    .selectFrom("application.submitted_materials")
    .selectAll()
    .where("owner_id", "=", input.owner.ownerId)
    .where("owner_epoch", "=", input.owner.ownerEpoch)
    .where("case_id", "=", input.caseId)
    .orderBy("submitted_at", "desc")
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  let materialKind: InterviewContinuity["materialKind"],
    materialId: string,
    materialTitle: string,
    quotes: string[];
  if (submitted) {
    materialKind = "submitted";
    materialId = submitted.id;
    materialTitle = submitted.title;
    quotes =
      typeof submitted.content === "object" &&
      submitted.content !== null &&
      "schemaVersion" in submitted.content &&
      submitted.content.schemaVersion === "aijob-native-resume-v1"
        ? nativeQuotes(joinNativeResumeDocument(submitted.content, submitted.layout))
        : ResumeSemanticContentSchema.parse(submitted.content).sections.flatMap((section) =>
            section.blocks.map((block) => block.text),
          );
  } else {
    const revision = await input.tx
      .selectFrom("profile.resume_document_revisions")
      .select([
        "schema_version",
        "sections",
        "studio_content",
        "document_id",
        "result_document_revision",
      ])
      .where("id", "=", input.resumeContentRevisionId)
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .executeTakeFirstOrThrow();
    materialKind = "working_resume";
    materialId = input.resumeContentRevisionId;
    materialTitle = "当前岗位简历";
    if (revision.schema_version === "aijob-native-content-v1") {
      const layout = await input.tx
        .selectFrom("profile.resume_layout_revisions")
        .select("studio_layout")
        .where("owner_id", "=", input.owner.ownerId)
        .where("owner_epoch", "=", input.owner.ownerEpoch)
        .where("document_id", "=", revision.document_id)
        .where("result_document_revision", "=", revision.result_document_revision)
        .executeTakeFirstOrThrow();
      quotes = nativeQuotes(
        joinNativeResumeDocument(revision.studio_content, layout.studio_layout),
      );
    } else
      quotes = semanticContent(revision.schema_version, revision.sections).sections.flatMap(
        (section) => section.blocks.map((block) => block.text),
      );
  }
  const answers = await input.tx
    .selectFrom("application.interview_turns as turn")
    .innerJoin(
      "application.interview_sessions as session",
      "session.id",
      "turn.interview_session_id",
    )
    .select("turn.content")
    .where("turn.owner_id", "=", input.owner.ownerId)
    .where("turn.owner_epoch", "=", input.owner.ownerEpoch)
    .where("session.case_id", "=", input.caseId)
    .where("session.deleted_at", "is", null)
    .where("turn.kind", "=", "answer")
    .orderBy("turn.created_at", "desc")
    .limit(3)
    .execute();
  const previousAnswers = answers.map((answer) => answer.content.slice(0, 1000));
  quotes = quotes.slice(0, 5).map((quote) => quote.slice(0, 2000));
  return ContextSchema.parse({
    version: "interview-continuity-v1",
    materialKind,
    materialId,
    materialTitle,
    materialQuotes: quotes,
    previousAnswers,
    plan: buildContinuousInterviewPlan({ ...input, materialKind, quotes, previousAnswers }),
  });
}
export async function saveInterviewContinuity(
  tx: Transaction<Database>,
  owner: OwnerScope,
  sessionId: string,
  context: InterviewContinuity,
) {
  await sql`INSERT INTO application.interview_continuity(session_id,owner_id,owner_epoch,context) VALUES (${sessionId}::uuid,${owner.ownerId}::uuid,${owner.ownerEpoch},${JSON.stringify(context)}::jsonb)`.execute(
    tx,
  );
}
export async function loadInterviewContinuity(
  db: Kysely<Database> | Transaction<Database>,
  owner: OwnerScope,
  sessionId: string,
) {
  const { rows } = await sql<{
    context: unknown;
  }>`SELECT context FROM application.interview_continuity WHERE session_id=${sessionId}::uuid AND owner_id=${owner.ownerId}::uuid AND owner_epoch=${owner.ownerEpoch}`.execute(
    db,
  );
  return rows[0] ? ContextSchema.parse(rows[0].context) : null;
}
