import { randomUUID } from "node:crypto";
import type { Database } from "@aijob/database";
import { sql, type Kysely } from "kysely";
import { materializeLocalCatalog } from "../catalog/materialize.js";
import { reconcilePublication } from "../catalog/publication-reconciliation.js";
import { interpretOfficialJob, JOB_SEMANTICS_VERSION } from "../catalog/job-semantics.js";
export async function provisionBenchmarkJob(
  db: Kysely<Database>,
  label: string,
  content?: { title: string; requirements: string },
) {
  const organizationId = randomUUID();
  const sourceId = randomUUID();
  const recordId = randomUUID();
  const revisionId = randomUUID();
  const host = `${label}.example.test`;

  await db
    .insertInto("source_control.organizations")
    .values({
      id: organizationId,
      slug: `reconcile-${organizationId}`,
      name: `Reconcile ${label}`,
      official_domain: host,
    })
    .execute();
  await db
    .insertInto("source_control.sources")
    .values({
      id: sourceId,
      organization_id: organizationId,
      source_candidate_id: null,
      source_key: `reconcile-${sourceId}`,
      source_type: "organization_career_site",
      name: `Reconcile Source ${label}`,
      current_policy_version: 1,
    })
    .execute();
  await db
    .insertInto("source_control.source_policy_versions")
    .values({
      source_id: sourceId,
      version: 1,
      policy_status: "approved",
      config_registered: true,
      catalog_role: "canonical",
      runtime_scope: "alpha",
      provenance_level: "organization_owned",
      acquisition_mode: "public_api",
      adapter_key: "reconcile-test",
      adapter_version: "1",
      entrypoints: JSON.stringify([`https://${host}/jobs`]),
      crawl_interval: "24h",
      refresh_coverage: "full_scope",
      absence_policy: "close_after_two_complete_absences",
      policy_notes: "Offline reconciliation fixture.",
      reviewed_at: null,
    })
    .execute();
  await db
    .insertInto("source_control.source_runtime_states")
    .values({
      source_id: sourceId,
      policy_version: 1,
      freshness_state: "fresh",
      last_complete_run_at: new Date(),
      consecutive_failures: 0,
      last_error_code: null,
      next_due_at: null,
    })
    .execute();
  await db
    .insertInto("ingestion.source_job_records")
    .values({
      id: recordId,
      source_id: sourceId,
      source_job_id: `job-${recordId}`,
      canonical_source_url: `https://${host}/jobs/${recordId}`,
      first_seen_at: new Date(Date.now() - 60_000),
      last_seen_at: new Date(),
    })
    .execute();
  await db
    .insertInto("ingestion.source_job_revisions")
    .values({
      id: revisionId,
      source_job_record_id: recordId,
      revision_content_hash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
      import_mode: "manual",
      adapter_version: "1",
      normalizer_version: "1",
      company_name: `Reconcile ${label}`,
      title: content?.title ?? `Reconcile ${label} Internship`,
      job_family: JSON.stringify({
        state: "known",
        value: "product",
        evidenceRefs: [`${revisionId}#family`],
      }),
      locations: JSON.stringify({
        state: "known",
        value: ["Shanghai"],
        evidenceRefs: [`${revisionId}#location`],
      }),
      business_groups: JSON.stringify([]),
      entry_scope: "internship",
      source_project_name: null,
      recruit_label_name: "internship",
      recruitment_type: JSON.stringify({
        state: "known",
        value: "internship",
        evidenceRefs: [`${revisionId}#type`],
      }),
      responsibilities: `Responsibilities for ${label}.`,
      requirements: content?.requirements ?? "Current student with product research experience.",
      structured_fields: JSON.stringify({}),
      ingestion_state: "validated",
      publication_state: "review",
      activity_state: "active",
      source_url: `https://${host}/jobs/${recordId}`,
      apply_url: `https://${host}/jobs/${recordId}/apply`,
      quality_flags: JSON.stringify([]),
      created_at: new Date(),
    })
    .execute();

  await materializeLocalCatalog(db);
  const materialized = await db
    .selectFrom("catalog.published_jobs as job")
    .innerJoin("catalog.published_job_versions as version", "version.id", "job.current_version_id")
    .select("job.id as publishedJobId")
    .where("version.source_job_revision_id", "=", revisionId)
    .executeTakeFirstOrThrow();
  // 限定范围，避免动到共享测试库里其他套件的公开指针。
  await reconcilePublication({ db, publishedJobIds: [materialized.publishedJobId] });

  const row = await db
    .selectFrom("catalog.published_jobs")
    .select(["id as publishedJobId", "public_version_id as publicVersionId"])
    .where("id", "=", materialized.publishedJobId)
    .executeTakeFirstOrThrow();
  if (!row.publicVersionId) throw new Error("BENCHMARK_FIXTURE_NOT_PUBLIC");

  const fixture = {
    organizationId,
    sourceId,
    recordId,
    revisionId,
    publishedJobId: row.publishedJobId,
    publishedJobVersionId: row.publicVersionId as string,
  };
  return fixture;
}

/** Synthetic fixtures only. The caller must enforce an empty isolated database. */
export async function seedBenchmarkCatalog(db: Kysely<Database>, count: number, reuse = false) {
  if (reuse) {
    const rows = await sql<{
      count: number;
      unexpected: number;
    }>`SELECT count(*)::int AS count,count(*) FILTER(WHERE source.source_key NOT LIKE 'benchmark-%' AND source.name<>'Reconcile Source benchmark')::int AS unexpected FROM catalog.published_jobs job JOIN catalog.published_job_versions version ON version.id=job.current_version_id JOIN ingestion.source_job_revisions revision ON revision.id=version.source_job_revision_id JOIN ingestion.source_job_records record ON record.id=revision.source_job_record_id JOIN source_control.sources source ON source.id=record.source_id`.execute(
      db,
    );
    if (rows.rows[0]?.count !== count || rows.rows[0]?.unexpected !== 0)
      throw new Error("BENCHMARK_REUSE_DATASET_MISMATCH");
    const row = await sql<{
      organizationId: string;
      sourceId: string;
      recordId: string;
      revisionId: string;
      publishedJobId: string;
      publishedJobVersionId: string;
    }>`SELECT source.organization_id AS "organizationId",source.id AS "sourceId",record.id AS "recordId",revision.id AS "revisionId",job.id AS "publishedJobId",version.id AS "publishedJobVersionId" FROM catalog.published_jobs job JOIN catalog.published_job_versions version ON version.id=job.current_version_id JOIN ingestion.source_job_revisions revision ON revision.id=version.source_job_revision_id JOIN ingestion.source_job_records record ON record.id=revision.source_job_record_id JOIN source_control.sources source ON source.id=record.source_id WHERE source.name='Reconcile Source benchmark'`.execute(
      db,
    );
    if (row.rows.length !== 1) throw new Error("BENCHMARK_BASE_FIXTURE_MISSING");
    return {
      base: row.rows[0] as NonNullable<(typeof row.rows)[0]>,
      count,
      companies: 101,
      largeEmployerShare: 0.4,
      unknownLocationsShare: 0.2,
      unparsedShare: 0.1,
      roleVariants: 6,
      note: "Reused isolated synthetic fixture; empty requirement sets on bulk jobs and short current-version JD text.",
    };
  }
  if ((await db.selectFrom("catalog.published_jobs").select("id").limit(1).execute()).length)
    throw new Error("BENCHMARK_REQUIRES_EMPTY_DATABASE");
  const base = await provisionBenchmarkJob(db, "benchmark", {
    title: "产品运营实习生",
    requirements: "本科、硕士或博士在读；熟悉 SQL；有用户研究经验优先。",
  });
  const titles = [
    "产品运营实习生",
    "后端开发实习生",
    "算法研究校招生",
    "财务实习生",
    "市场营销管培生",
    "法务应届生",
  ];
  const responsibilities = [
    "负责用户研究，编写需求文档。",
    "使用 Java 开发服务，提交测试报告。",
    "设计实验，编写研究论文和实验报告。",
    "核对凭证，编写财务报表。",
    "执行营销活动，提交活动方案。",
    "审查合同，整理法律研究材料。",
  ];
  const requirements = [
    "本科或硕士在读；熟悉 SQL。",
    "本科及以上，掌握 Java 和 SQL。",
    "硕士或博士在读，熟悉 Python；研究论文优先。",
    "本科在读；熟悉 Excel。",
    "学历不限，熟悉 Excel 优先。",
    "硕士在读，法学专业优先。",
  ];
  const variants = titles.map((title, i) => ({
    title,
    responsibilities: responsibilities[i]!,
    requirements: requirements[i]!,
    ...interpretOfficialJob({
      jobVersionId: base.publishedJobVersionId,
      title,
      responsibilities: responsibilities[i]!,
      requirements: requirements[i]!,
    }),
  }));
  await db.transaction().execute(async (tx) => {
    // Bulk fixture preparation is outside measured requests; retain a separate finite limit.
    await sql`SET LOCAL statement_timeout='300s'`.execute(tx);
    await sql`CREATE TEMP TABLE bench_companies ON COMMIT DROP AS SELECT i,gen_random_uuid() AS organization_id,gen_random_uuid() AS source_id FROM generate_series(1,100) i`.execute(
      tx,
    );
    await sql`INSERT INTO source_control.organizations SELECT (prepared.row_value).* FROM (SELECT jsonb_populate_record(NULL::source_control.organizations,to_jsonb(t)||jsonb_build_object('id',c.organization_id,'slug','benchmark-'||c.i,'name','样本企业'||c.i,'official_domain','company'||c.i||'.example.test')) AS row_value FROM source_control.organizations t CROSS JOIN bench_companies c WHERE t.id=${base.organizationId}::uuid OFFSET 0) prepared`.execute(
      tx,
    );
    await sql`INSERT INTO source_control.sources SELECT (prepared.row_value).* FROM (SELECT jsonb_populate_record(NULL::source_control.sources,to_jsonb(t)||jsonb_build_object('id',c.source_id,'organization_id',c.organization_id,'source_key','benchmark-'||c.i,'name','样本企业'||c.i)) AS row_value FROM source_control.sources t CROSS JOIN bench_companies c WHERE t.id=${base.sourceId}::uuid OFFSET 0) prepared`.execute(
      tx,
    );
    await sql`INSERT INTO source_control.source_policy_versions SELECT (prepared.row_value).* FROM (SELECT jsonb_populate_record(NULL::source_control.source_policy_versions,to_jsonb(t)||jsonb_build_object('source_id',c.source_id)) AS row_value FROM source_control.source_policy_versions t CROSS JOIN bench_companies c WHERE t.source_id=${base.sourceId}::uuid OFFSET 0) prepared`.execute(
      tx,
    );
    await sql`INSERT INTO source_control.source_runtime_states SELECT (prepared.row_value).* FROM (SELECT jsonb_populate_record(NULL::source_control.source_runtime_states,to_jsonb(t)||jsonb_build_object('source_id',c.source_id)) AS row_value FROM source_control.source_runtime_states t CROSS JOIN bench_companies c WHERE t.source_id=${base.sourceId}::uuid OFFSET 0) prepared`.execute(
      tx,
    );
    await sql`CREATE TEMP TABLE bench_jobs ON COMMIT DROP AS SELECT n,c.i AS company,c.source_id,gen_random_uuid() AS record_id,gen_random_uuid() AS revision_id,gen_random_uuid() AS job_id,gen_random_uuid() AS version_id FROM generate_series(1,${count - 1}) n JOIN bench_companies c ON c.i=CASE WHEN n%10<4 THEN 1 ELSE 2+n%99 END`.execute(
      tx,
    );
    await sql`CREATE TEMP TABLE bench_variants ON COMMIT DROP AS SELECT (ordinality-1)::int AS i,value AS data FROM jsonb_array_elements(${JSON.stringify(variants)}::jsonb) WITH ORDINALITY`.execute(
      tx,
    );
    await sql`INSERT INTO ingestion.source_job_records SELECT (prepared.row_value).* FROM (SELECT jsonb_populate_record(NULL::ingestion.source_job_records,to_jsonb(t)||jsonb_build_object('id',j.record_id,'source_id',j.source_id,'source_job_id','benchmark-'||j.n,'canonical_source_url','https://company'||j.company||'.example.test/jobs/'||j.n,'last_seen_at',now()-((j.n%3600)||' seconds')::interval)) AS row_value FROM ingestion.source_job_records t CROSS JOIN bench_jobs j WHERE t.id=${base.recordId}::uuid OFFSET 0) prepared`.execute(
      tx,
    );
    await sql`INSERT INTO ingestion.source_job_revisions SELECT (prepared.row_value).* FROM (SELECT jsonb_populate_record(NULL::ingestion.source_job_revisions,to_jsonb(t)||jsonb_build_object('id',j.revision_id,'source_job_record_id',j.record_id,'revision_content_hash',md5(j.n::text)||md5(j.n::text),'company_name','样本企业'||j.company,'title',v.data->>'title','requirements',v.data->>'requirements','responsibilities',v.data->>'responsibilities','job_family',CASE WHEN j.n%10=0 THEN jsonb_build_object('state','unknown','reason','source_not_stated') ELSE jsonb_build_object('state','known','value',v.data->'role'->>'primaryFamily','evidenceRefs',jsonb_build_array('fixture')) END,'locations',CASE WHEN j.n%5=0 THEN jsonb_build_object('state','unknown','reason','source_not_stated') ELSE jsonb_build_object('state','known','value',jsonb_build_array((ARRAY['北京','上海','深圳','广州','杭州','成都','武汉','南京'])[1+j.n%8]),'evidenceRefs',jsonb_build_array('fixture')) END,'source_url','https://company'||j.company||'.example.test/jobs/'||j.n,'apply_url','https://company'||j.company||'.example.test/jobs/'||j.n||'/apply')) AS row_value FROM ingestion.source_job_revisions t CROSS JOIN bench_jobs j JOIN bench_variants v ON v.i=j.n%6 WHERE t.id=${base.revisionId}::uuid OFFSET 0) prepared`.execute(
      tx,
    );
    await sql`INSERT INTO catalog.published_jobs SELECT (prepared.row_value).* FROM (SELECT jsonb_populate_record(NULL::catalog.published_jobs,to_jsonb(t)||jsonb_build_object('id',j.job_id,'source_job_record_id',j.record_id,'current_version_id',NULL,'public_version_id',NULL)) AS row_value FROM catalog.published_jobs t CROSS JOIN bench_jobs j WHERE t.id=${base.publishedJobId}::uuid OFFSET 0) prepared`.execute(
      tx,
    );
    await sql`INSERT INTO catalog.published_job_versions SELECT (prepared.row_value).* FROM (SELECT jsonb_populate_record(NULL::catalog.published_job_versions,to_jsonb(t)||jsonb_build_object('id',j.version_id,'published_job_id',j.job_id,'source_job_revision_id',j.revision_id,'content_hash',md5(j.n::text)||md5(j.n::text),'active_requirement_set_id',NULL,'company_name',r.company_name,'title',r.title,'requirements',r.requirements,'responsibilities',r.responsibilities,'job_family',r.job_family,'locations',r.locations,'source_url',r.source_url,'apply_url',r.apply_url)) AS row_value FROM catalog.published_job_versions t CROSS JOIN bench_jobs j JOIN ingestion.source_job_revisions r ON r.id=j.revision_id WHERE t.id=${base.publishedJobVersionId}::uuid OFFSET 0) prepared`.execute(
      tx,
    );
    await sql`INSERT INTO catalog.job_semantic_indexes(job_version_id,extraction_version,source_hash,primary_family,families,subrole,domains,education_levels,atoms) SELECT j.version_id,${JOB_SEMANTICS_VERSION},md5(j.n::text)||md5(j.n::text),v.data->'role'->>'primaryFamily',ARRAY(SELECT jsonb_array_elements_text(v.data->'role'->'families')),v.data->'role'->>'subrole',ARRAY(SELECT jsonb_array_elements_text(v.data->'role'->'domains')),ARRAY(SELECT jsonb_array_elements_text(v.data->'educationLevels')),v.data->'atoms' FROM bench_jobs j JOIN bench_variants v ON v.i=j.n%6 WHERE j.n%10<>0`.execute(
      tx,
    );
    await sql`INSERT INTO catalog.published_job_version_revision_links(published_job_version_id,source_job_revision_id) SELECT version_id,revision_id FROM bench_jobs`.execute(
      tx,
    );
    await sql`INSERT INTO catalog.job_requirement_sets(id,published_job_version_id,schema_version,extraction_version,source_units,requirements,content_hash)
      SELECT gen_random_uuid(),version_id,'job-requirements-v5','benchmark-fixture','[]'::jsonb,'[]'::jsonb,md5(n::text)||md5(n::text) FROM bench_jobs`.execute(
      tx,
    );
    await sql`INSERT INTO catalog.job_condition_projections
      SELECT (prepared.row_value).* FROM (SELECT jsonb_populate_record(NULL::catalog.job_condition_projections,to_jsonb(p)||jsonb_build_object('published_job_version_id',j.version_id,'requirement_set_id',s.id,'locations',v.locations)) AS row_value FROM catalog.job_condition_projections p CROSS JOIN bench_jobs j JOIN catalog.job_requirement_sets s ON s.published_job_version_id=j.version_id JOIN catalog.published_job_versions v ON v.id=j.version_id
      WHERE p.published_job_version_id=${base.publishedJobVersionId}::uuid OFFSET 0) prepared`.execute(
      tx,
    );
    await sql`UPDATE catalog.published_job_versions v SET active_requirement_set_id=s.id FROM catalog.job_requirement_sets s WHERE s.published_job_version_id=v.id AND s.extraction_version='benchmark-fixture'`.execute(
      tx,
    );
    await sql`UPDATE catalog.published_jobs p SET current_version_id=j.version_id,public_version_id=j.version_id FROM bench_jobs j WHERE p.id=j.job_id`.execute(
      tx,
    );
  });
  await sql`ANALYZE`.execute(db);
  return {
    base,
    count,
    companies: 101,
    largeEmployerShare: 0.4,
    unknownLocationsShare: 0.2,
    unparsedShare: 0.1,
    roleVariants: 6,
    note: "Synthetic current versions; no historical-version depth or production-network behavior represented.",
  };
}
