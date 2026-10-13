import {
  type ExperienceRecord,
  type JobGraphResult,
  type JobGraphScope,
  LegacyResumeEvidenceSchema,
  PersonalGraphComparisonSchema,
  type ResumeEvidenceRevision,
  ResumeEvidenceSchema,
  ResumeStudioEntrySchema,
  resumeRichPlain,
} from "@aijob/contracts";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { assertActiveOwnerEpoch, type OwnerScope } from "../identity/session-repository.js";
import { ServiceError } from "../lib/service-error.js";
import { inferCapabilities } from "../matching/capabilities.js";
import { getCurrentJobGraph } from "./current-graph.js";
import { getPrivateJobGraph } from "./private-graph.js";

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().trim();
export function relatedGraphEvidence(
  item: Pick<JobGraphResult["items"][number], "key" | "kind" | "label">,
  evidence: ResumeEvidenceRevision["evidence"],
) {
  if (!["tool", "task", "deliverable"].includes(item.kind)) return [];
  const label = normalize(item.label);
  return evidence
    .filter((value) => value.confirmed)
    .flatMap((value) => {
      const statement = "statement" in value ? value.statement : value.claim;
      const text = [statement, ...value.skills, ...value.outcomes].join("\n");
      const explicitSkill = value.skills.some((skill) => normalize(skill) === label);
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const mentioned = /^[a-z0-9 .+#-]+$/i.test(label)
        ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(normalize(text))
        : normalize(text).includes(label);
      const capability =
        item.kind === "task" &&
        inferCapabilities(text).some((cap) => `task:${cap.key}` === item.key);
      if (!explicitSkill && !mentioned && !capability) return [];
      return [
        {
          evidenceId: value.id,
          statement,
          section: value.section,
          reason: explicitSkill
            ? "已确认技能中出现同一工具"
            : mentioned
              ? "已确认经历中出现相同表述"
              : "已确认经历包含相关任务线索",
        },
      ];
    })
    .slice(0, 10);
}
export function relatedGraphExperiences(
  item: Pick<JobGraphResult["items"][number], "key" | "kind" | "label">,
  experiences: Pick<ExperienceRecord, "id" | "kind" | "title" | "entry" | "revision">[],
) {
  if (!["tool", "task", "deliverable"].includes(item.kind)) return [];
  const label = normalize(item.label);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return experiences
    .flatMap((experience) => {
      const statement = resumeRichPlain(experience.entry.body);
      const text = [
        experience.title,
        experience.entry.organization,
        experience.entry.role,
        statement,
      ].join("\n");
      const mentioned = /^[a-z0-9 .+#-]+$/i.test(label)
        ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(normalize(text))
        : normalize(text).includes(label);
      const capability =
        item.kind === "task" &&
        inferCapabilities(text).some((cap) => `task:${cap.key}` === item.key);
      if (!mentioned && !capability) return [];
      return [
        {
          evidenceId: null,
          experienceId: experience.id,
          experienceRevision: experience.revision,
          title: experience.title,
          statement,
          section:
            [experience.entry.organization, experience.entry.role].filter(Boolean).join(" · ") ||
            experience.title,
          reason: mentioned ? "经历中出现相同表述" : "经历包含相关任务线索",
        },
      ];
    })
    .slice(0, 10);
}

export async function comparePersonalGraphItem(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  item: Pick<JobGraphResult["items"][number], "key" | "kind" | "label">;
}) {
  return input.db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, input.owner.ownerId, input.owner.ownerEpoch);
    const revision = await tx
      .selectFrom("profile.resume_evidence_revisions")
      .select(["id", "evidence"])
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .orderBy("revision", "desc")
      .executeTakeFirst();
    const evidence = revision
      ? z
          .array(z.union([ResumeEvidenceSchema, LegacyResumeEvidenceSchema]))
          .parse(revision.evidence)
      : [];
    const { rows } = await sql<
      Pick<ExperienceRecord, "id" | "kind" | "title" | "revision"> & { entry: unknown }
    >`SELECT id,kind,title,revision,entry FROM profile.experiences WHERE owner_id=${input.owner.ownerId} AND owner_epoch=${input.owner.ownerEpoch} ORDER BY updated_at DESC,id`.execute(
      tx,
    );
    const current = relatedGraphExperiences(
      input.item,
      rows.map((row) => ({ ...row, entry: ResumeStudioEntrySchema.parse(row.entry) })),
    );
    const statements = new Set(current.map((candidate) => normalize(candidate.statement)));
    const legacy = relatedGraphEvidence(input.item, evidence).filter(
      (candidate) => !statements.has(normalize(candidate.statement)),
    );
    return PersonalGraphComparisonSchema.parse({
      key: input.item.key,
      evidenceRevisionId: revision?.id ?? null,
      mode: "rules-reference",
      candidates: [...current, ...legacy].slice(0, 10),
    });
  });
}

export async function comparePersonalGraph(input: {
  db: Kysely<Database>;
  owner: OwnerScope;
  scope: JobGraphScope;
  dataset: "public" | "private";
  key: string;
  local: boolean;
}) {
  const graph =
    input.dataset === "private" ? await getPrivateJobGraph(input) : await getCurrentJobGraph(input);
  const item = graph.items.find((value) => value.key === input.key);
  if (!item)
    throw new ServiceError(404, "GRAPH_REQUIREMENT_NOT_FOUND", "这个范围已无该要求，请刷新图谱。");
  return comparePersonalGraphItem({ db: input.db, owner: input.owner, item });
}
