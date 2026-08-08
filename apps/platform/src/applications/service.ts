import { randomUUID } from "node:crypto";
import {
  ApplicationCaseCursorSchema,
  type ApplicationCaseWithJobContext,
  ApplicationCaseWithJobContextSchema,
  type CreateApplicationCaseResponse,
  CreateApplicationCaseResponseSchema,
  type CreateApplicationCaseWithJobContextRequest,
  type ListApplicationCasesQuery,
  type ListApplicationCasesResponse,
  ListApplicationCasesResponseSchema,
  PublicJobReferenceSchema,
} from "@aijob/contracts";
import type { Database, JsonValue } from "@aijob/database";
import { type Kysely, sql, type Transaction } from "kysely";
import { z } from "zod";
import { assertActiveOwnerEpoch, type OwnerContext } from "../identity/session-repository.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { lockOwnerIdempotencyKey } from "../lib/idempotency.js";
import { ServiceError } from "../lib/service-error.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

interface ApplicationCaseReadRow {
  id: string;
  owner_id: string;
  owner_epoch: number;
  job_context_kind: string;
  published_job_id: string | null;
  published_job_version_id: string | null;
  requirement_set_id: string | null;
  private_job_snapshot_id: string | null;
  job_context_revision: number;
  stage: string;
  outcome: string | null;
  revision: number;
  ended_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  public_official_url: string | null;
  private_title: string | null;
  private_company_name: string | null;
  private_source_label: string | null;
  private_official_url: string | null;
  private_requirement_set_revision: number | null;
  private_source_provided: boolean | null;
}

const CursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    query: z.string().regex(/^[a-f0-9]{16}$/),
    position: ApplicationCaseCursorSchema,
  })
  .strict();

type ResolvedJobContext =
  | {
      kind: "public";
      publishedJobId: string;
      publishedJobVersionId: string;
      requirementSetId: string;
      jobContextRevision: 1;
    }
  | {
      kind: "private";
      snapshotId: string;
      contentRevision: number;
      jobContextRevision: number;
    };

function toIso(value: Date): string {
  return value.toISOString();
}

function caseReadQuery(db: DbExecutor) {
  return db
    .selectFrom("application.application_cases as application_case")
    .leftJoin(
      "catalog.published_job_versions as public_version",
      "public_version.id",
      "application_case.published_job_version_id",
    )
    .leftJoin("application.private_job_snapshot_revisions as private_revision", (join) =>
      join
        .onRef("private_revision.owner_id", "=", "application_case.owner_id")
        .onRef("private_revision.snapshot_id", "=", "application_case.private_job_snapshot_id")
        .onRef("private_revision.content_revision", "=", "application_case.job_context_revision"),
    )
    .select([
      "application_case.id",
      "application_case.owner_id",
      "application_case.owner_epoch",
      "application_case.job_context_kind",
      "application_case.published_job_id",
      "application_case.published_job_version_id",
      "application_case.requirement_set_id",
      "application_case.private_job_snapshot_id",
      "application_case.job_context_revision",
      "application_case.stage",
      "application_case.outcome",
      "application_case.revision",
      "application_case.ended_at",
      "application_case.deleted_at",
      "application_case.created_at",
      "application_case.updated_at",
      sql<string | null>`COALESCE(public_version.apply_url, public_version.source_url)`.as(
        "public_official_url",
      ),
      "private_revision.title as private_title",
      "private_revision.company_name as private_company_name",
      "private_revision.source_label as private_source_label",
      "private_revision.official_url as private_official_url",
      "private_revision.requirement_set_revision as private_requirement_set_revision",
      "private_revision.source_provided as private_source_provided",
    ]);
}

function mapCaseRow(row: ApplicationCaseReadRow): ApplicationCaseWithJobContext {
  const common = {
    id: row.id,
    ownerId: row.owner_id,
    ownerEpoch: Number(row.owner_epoch),
    stage: row.stage,
    outcome: row.outcome,
    revision: Number(row.revision),
    endedAt: row.ended_at ? toIso(row.ended_at) : null,
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };

  if (row.job_context_kind === "public") {
    return ApplicationCaseWithJobContextSchema.parse({
      ...common,
      jobContext: {
        kind: "public",
        publishedJobId: row.published_job_id,
        publishedJobVersionId: row.published_job_version_id,
        requirementSetId: row.requirement_set_id,
        officialUrl: row.public_official_url,
      },
    });
  }

  return ApplicationCaseWithJobContextSchema.parse({
    ...common,
    jobContext: {
      kind: "private",
      snapshotId: row.private_job_snapshot_id,
      ownerId: row.owner_id,
      title: row.private_title,
      companyName: row.private_company_name,
      sourceLabel: row.private_source_label,
      ...(row.private_official_url ? { officialUrl: row.private_official_url } : {}),
      contentRevision: Number(row.job_context_revision),
      requirementSetRevision: Number(row.private_requirement_set_revision),
      sourceProvided: row.private_source_provided,
    },
  });
}

async function loadCaseById(
  db: DbExecutor,
  owner: OwnerContext,
  caseId: string,
): Promise<ApplicationCaseWithJobContext | null> {
  const row = await caseReadQuery(db)
    .where("application_case.id", "=", caseId)
    .where("application_case.owner_id", "=", owner.ownerId)
    .where("application_case.owner_epoch", "=", owner.ownerEpoch)
    .where("application_case.deleted_at", "is", null)
    .executeTakeFirst();
  return row ? mapCaseRow(row as ApplicationCaseReadRow) : null;
}

function cursorQueryHash(query: Pick<ListApplicationCasesQuery, "stage">): string {
  return hashCanonicalJson({ stage: query.stage ?? null }).slice(0, 16);
}

function encodeCursor(applicationCase: ApplicationCaseWithJobContext, queryHash: string): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      query: queryHash,
      position: { updatedAt: applicationCase.updatedAt, id: applicationCase.id },
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value: string, queryHash: string) {
  try {
    const cursor = CursorEnvelopeSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (cursor.query !== queryHash) throw new Error("CURSOR_QUERY_MISMATCH");
    return cursor.position;
  } catch {
    throw new ServiceError(
      400,
      "INVALID_APPLICATION_CASE_CURSOR",
      "求职项目列表游标无效，请从第一页重新加载。",
    );
  }
}

export async function listApplicationCases(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  query: ListApplicationCasesQuery;
}): Promise<ListApplicationCasesResponse> {
  const queryHash = cursorQueryHash(input.query);
  const cursor = input.query.cursor ? decodeCursor(input.query.cursor, queryHash) : null;
  let query = caseReadQuery(input.db)
    .where("application_case.owner_id", "=", input.owner.ownerId)
    .where("application_case.owner_epoch", "=", input.owner.ownerEpoch)
    .where("application_case.deleted_at", "is", null);

  if (input.query.stage) {
    query = query.where("application_case.stage", "=", input.query.stage);
  }
  if (cursor) {
    const updatedAt = new Date(cursor.updatedAt);
    query = query.where((expression) =>
      expression.or([
        expression("application_case.updated_at", "<", updatedAt),
        expression.and([
          expression("application_case.updated_at", "=", updatedAt),
          expression("application_case.id", "<", cursor.id),
        ]),
      ]),
    );
  }

  const rows = await query
    .orderBy("application_case.updated_at", "desc")
    .orderBy("application_case.id", "desc")
    .limit(input.query.limit + 1)
    .execute();
  const hasMore = rows.length > input.query.limit;
  const items = rows
    .slice(0, input.query.limit)
    .map((row) => mapCaseRow(row as ApplicationCaseReadRow));
  const lastItem = items.at(-1);
  return ListApplicationCasesResponseSchema.parse({
    items,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem, queryHash) : null,
  });
}

export async function getApplicationCase(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  caseId: string;
}): Promise<ApplicationCaseWithJobContext | null> {
  return loadCaseById(input.db, input.owner, input.caseId);
}

async function resolvePublicJobContext(
  db: Transaction<Database>,
  request: Extract<CreateApplicationCaseWithJobContextRequest["jobContext"], { kind: "public" }>,
  enableLocalMvp: boolean,
): Promise<ResolvedJobContext> {
  let query = db
    .selectFrom("catalog.published_job_versions as version")
    .innerJoin("catalog.published_jobs as job", "job.id", "version.published_job_id")
    .innerJoin(
      "catalog.job_version_eligibility as eligibility",
      "eligibility.published_job_version_id",
      "version.id",
    )
    .innerJoin(
      "catalog.job_requirement_sets as requirement_set",
      "requirement_set.id",
      "version.active_requirement_set_id",
    )
    .leftJoin("catalog.company_quota_selections as quota", "quota.published_job_id", "job.id")
    .select([
      "job.id as publishedJobId",
      "version.id as publishedJobVersionId",
      "requirement_set.id as requirementSetId",
      "version.apply_url as officialUrl",
    ])
    .where("job.id", "=", request.publishedJobId)
    .where("version.id", "=", request.publishedJobVersionId)
    .whereRef(
      enableLocalMvp ? "job.current_version_id" : "job.public_version_id",
      "=",
      "version.id",
    )
    .where(
      enableLocalMvp ? "eligibility.eligible_for_local_mvp" : "eligibility.eligible_for_alpha",
      "=",
      true,
    )
    .forUpdate("job");
  if (enableLocalMvp) {
    query = query.where(sql<boolean>`COALESCE(quota.selected, TRUE)`);
  }
  const row = await query.executeTakeFirst();
  const parsed = row
    ? PublicJobReferenceSchema.safeParse({
        kind: "public",
        publishedJobId: row.publishedJobId,
        publishedJobVersionId: row.publishedJobVersionId,
        requirementSetId: row.requirementSetId,
        officialUrl: row.officialUrl,
      })
    : null;
  if (!parsed?.success) {
    throw new ServiceError(
      422,
      "PUBLIC_JOB_CONTEXT_UNAVAILABLE",
      "该岗位版本当前不在可创建求职项目的目录范围内，请刷新岗位后重试。",
    );
  }
  return {
    kind: "public",
    publishedJobId: parsed.data.publishedJobId,
    publishedJobVersionId: parsed.data.publishedJobVersionId,
    requirementSetId: parsed.data.requirementSetId,
    jobContextRevision: 1,
  };
}

async function resolvePrivateJobContext(
  db: Transaction<Database>,
  owner: OwnerContext,
  request: Extract<CreateApplicationCaseWithJobContextRequest["jobContext"], { kind: "private" }>,
): Promise<ResolvedJobContext> {
  const row = await db
    .selectFrom("application.private_job_snapshots as snapshot")
    .innerJoin("application.private_job_snapshot_revisions as revision", (join) =>
      join
        .onRef("revision.owner_id", "=", "snapshot.owner_id")
        .onRef("revision.snapshot_id", "=", "snapshot.id"),
    )
    .select(["snapshot.id as snapshotId", "revision.content_revision as contentRevision"])
    .where("snapshot.id", "=", request.snapshotId)
    .where("snapshot.owner_id", "=", owner.ownerId)
    .where("snapshot.owner_epoch", "=", owner.ownerEpoch)
    .where("snapshot.deleted_at", "is", null)
    .where("revision.owner_epoch", "=", owner.ownerEpoch)
    .where("revision.content_revision", "=", request.contentRevision)
    .forUpdate("snapshot")
    .executeTakeFirst();
  if (!row) {
    throw new ServiceError(
      404,
      "PRIVATE_JOB_CONTEXT_NOT_FOUND",
      "私有岗位不存在、已删除或不属于当前账户。",
    );
  }
  return {
    kind: "private",
    snapshotId: row.snapshotId,
    contentRevision: Number(row.contentRevision),
    jobContextRevision: Number(row.contentRevision),
  };
}

async function findActiveCaseId(
  db: Transaction<Database>,
  owner: OwnerContext,
  context: ResolvedJobContext,
): Promise<string | null> {
  let query = db
    .selectFrom("application.application_cases")
    .select("id")
    .where("owner_id", "=", owner.ownerId)
    .where("owner_epoch", "=", owner.ownerEpoch)
    .where("ended_at", "is", null)
    .where("deleted_at", "is", null)
    .where("job_context_kind", "=", context.kind);
  query =
    context.kind === "public"
      ? query.where("published_job_id", "=", context.publishedJobId)
      : query.where("private_job_snapshot_id", "=", context.snapshotId);
  return (await query.executeTakeFirst())?.id ?? null;
}

function contextLockKey(context: ResolvedJobContext): string {
  return context.kind === "public"
    ? `public:${context.publishedJobId}`
    : `private:${context.snapshotId}`;
}

export async function createApplicationCase(input: {
  db: Kysely<Database>;
  owner: OwnerContext;
  request: CreateApplicationCaseWithJobContextRequest;
  idempotencyKey: string;
  enableLocalMvp: boolean;
}): Promise<CreateApplicationCaseResponse> {
  const requestHash = hashCanonicalJson(input.request);
  return input.db.transaction().execute(async (transaction) => {
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: "application-case-create",
      idempotencyKey: input.idempotencyKey,
    });
    await assertActiveOwnerEpoch(transaction, input.owner.ownerId, input.owner.ownerEpoch);

    const replay = await transaction
      .selectFrom("application.application_cases")
      .select(["id", "creation_request_hash"])
      .where("owner_id", "=", input.owner.ownerId)
      .where("owner_epoch", "=", input.owner.ownerEpoch)
      .where("creation_idempotency_key", "=", input.idempotencyKey)
      .executeTakeFirst();
    if (replay) {
      if (replay.creation_request_hash !== requestHash) {
        throw new ServiceError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "同一个请求编号不能用于不同的求职项目创建请求。",
        );
      }
      const applicationCase = await loadCaseById(transaction, input.owner, replay.id);
      if (!applicationCase) {
        throw new ServiceError(
          410,
          "APPLICATION_CASE_DELETED",
          "该请求曾创建的求职项目已经删除，请使用新的请求编号。",
        );
      }
      return CreateApplicationCaseResponseSchema.parse({ applicationCase, created: true });
    }

    const context =
      input.request.jobContext.kind === "public"
        ? await resolvePublicJobContext(transaction, input.request.jobContext, input.enableLocalMvp)
        : await resolvePrivateJobContext(transaction, input.owner, input.request.jobContext);
    await lockOwnerIdempotencyKey(transaction, {
      ownerId: input.owner.ownerId,
      scope: "application-case-context",
      idempotencyKey: contextLockKey(context),
    });

    const activeCaseId = await findActiveCaseId(transaction, input.owner, context);
    if (activeCaseId) {
      const applicationCase = await loadCaseById(transaction, input.owner, activeCaseId);
      if (!applicationCase) throw new Error("APPLICATION_CASE_ACTIVE_ROW_UNREADABLE");
      return CreateApplicationCaseResponseSchema.parse({ applicationCase, created: false });
    }

    const caseId = randomUUID();
    await transaction
      .insertInto("application.application_cases")
      .values({
        id: caseId,
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        published_job_id: context.kind === "public" ? context.publishedJobId : null,
        published_job_version_id: context.kind === "public" ? context.publishedJobVersionId : null,
        requirement_set_id: context.kind === "public" ? context.requirementSetId : null,
        job_context_kind: context.kind,
        private_job_snapshot_id: context.kind === "private" ? context.snapshotId : null,
        job_context_revision: context.jobContextRevision,
        stage: "interested",
        outcome: null,
        revision: 1,
        creation_idempotency_key: input.idempotencyKey,
        creation_request_hash: requestHash,
        expires_at: null,
        ended_at: null,
        deleted_at: null,
      })
      .execute();
    await transaction
      .insertInto("application.case_events")
      .values({
        id: randomUUID(),
        owner_id: input.owner.ownerId,
        owner_epoch: input.owner.ownerEpoch,
        case_id: caseId,
        sequence: 1,
        event_type: "case_created",
        actor_type: "owner",
        event_data: JSON.stringify({
          schemaVersion: "case-event-v1",
          initialStage: "interested",
          jobContextKind: context.kind,
          jobContextRevision: context.jobContextRevision,
        }) as unknown as JsonValue,
        idempotency_scope: "application-case:create",
        idempotency_key: input.idempotencyKey,
        request_hash: requestHash,
      })
      .execute();

    const applicationCase = await loadCaseById(transaction, input.owner, caseId);
    if (!applicationCase) throw new Error("APPLICATION_CASE_INSERT_NOT_READABLE");
    return CreateApplicationCaseResponseSchema.parse({ applicationCase, created: true });
  });
}
