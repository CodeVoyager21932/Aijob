import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import { migrateToLatest } from "../migrate.js";
import { ALPHA_ONLY_REASON_CODES } from "./037_student_applicable_supply.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/**
 * ADR-0035 第一条的数据库侧验证。
 *
 * 这里只验 SQL 函数自身的分支与视图形状。TypeScript 与 SQL 两份判定的**逐分支对账**放在
 * `apps/platform/src/sources/job-reachability-sql-parity.integration.test.ts`——`@aijob/database`
 * 刻意不依赖 `@aijob/contracts`，不为一个测试反转分层。
 */
describeWithDatabase("student applicable supply migration", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");

  beforeAll(async () => {
    await migrateToLatest(db);
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
  });

  const verdict = async (requirements: string, responsibilities = "") => {
    const { rows } = await sql<{ verdict: string }>`
      SELECT catalog.job_reachability_verdict(${requirements}, ${responsibilities}) AS verdict
    `.execute(db);
    return rows[0]?.verdict ?? "";
  };

  it("classifies each reachability branch from explicit phrases only", async () => {
    expect(await verdict("本科及以上学历，计算机相关专业")).toBe("reachable");
    expect(await verdict("大专及以上即可")).toBe("reachable");
    expect(await verdict("学历不限，欢迎在校生")).toBe("reachable");
    expect(await verdict("本科或硕士均可")).toBe("reachable");
    expect(await verdict("硕士及以上学历")).toBe("not_reachable_postgrad_only");
    expect(await verdict("博士在读优先")).toBe("not_reachable_postgrad_only");
    expect(await verdict("985/211 院校本科及以上")).toBe("not_reachable_school_restricted");
    expect(await verdict("双一流高校优先")).toBe("not_reachable_school_restricted");
    // 没有任何学历信号时归入 unknown，不猜测。
    expect(await verdict("负责数据看板搭建，熟悉 SQL")).toBe("unknown");
    expect(await verdict("每周到岗 4 天，实习 3 个月以上")).toBe("unknown");
    expect(await verdict("")).toBe("unknown");
  });

  it("reads education stated only in the responsibilities section", async () => {
    expect(await verdict("能长期实习", "面向本科三年级学生的培养岗")).toBe("reachable");
  });

  it("excludes years of work experience but not months of internship", async () => {
    // ADR-0035 新增的排除项。刻意只匹配「年」，因为「3 个月实习经验」在校生能满足。
    expect(await verdict("本科及以上，3 年以上相关工作经验")).toBe(
      "not_reachable_experience_required",
    );
    expect(await verdict("本科及以上，具备 3 个月实习经验")).toBe("reachable");
    // 「培养周期 2 年」是培养周期而非经验门槛，不应命中。
    expect(await verdict("本科在读，培养周期 2 年")).toBe("reachable");
  });

  // 两个视图必须同形：本机预览读 `current_job_eligibility`，公开指针对账读
  // `job_version_eligibility`。只改一个会让同一条政策在两处给出不同答案。
  const eligibilityViews = ["current_job_eligibility", "job_version_eligibility"] as const;

  it.each(eligibilityViews)("exposes the verdict and the alpha-only reasons on %s", async (view) => {
    const { rows } = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'catalog'
        AND table_name = ${view}
        AND column_name IN (
          'reachability_verdict',
          'student_applicable',
          'blocking_reasons',
          'alpha_blocking_reasons'
        )
      ORDER BY column_name
    `.execute(db);
    expect(rows.map((row) => row.column_name)).toEqual([
      "alpha_blocking_reasons",
      "blocking_reasons",
      "reachability_verdict",
      "student_applicable",
    ]);

    const { rows: definition } = await sql<{ definition: string }>`
      SELECT pg_get_viewdef(${`catalog.${view}`}::regclass, true) AS definition
    `.execute(db);
    const viewSql = definition[0]?.definition ?? "";

    // ADR-0035 第八条：两项皆缺才算缺，因此旧的两个分项原因码应当彻底消失。
    for (const removed of ["RESPONSIBILITIES_MISSING", "REQUIREMENTS_MISSING"]) {
      expect(viewSql, `${removed} 应已并入 JOB_BODY_MISSING`).not.toContain(removed);
    }
    expect(viewSql).toContain("JOB_BODY_MISSING");
    // 只约束对外可见的四项必须**具名存在**——第一版把它们内联成布尔条件，导致公开指针撤回
    // 时说不出原因。逐项是否落在正确的数组里由 019 的行为用例断言。
    for (const alphaOnly of ALPHA_ONLY_REASON_CODES) {
      expect(viewSql, `${alphaOnly} 必须作为原因码存在`).toContain(alphaOnly);
    }
  });
});
