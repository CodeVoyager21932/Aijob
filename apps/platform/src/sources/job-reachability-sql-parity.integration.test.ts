import { classifyJobReachability } from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/**
 * ADR-0035 第一条：可达性判定同时存在于两处——`packages/contracts` 的
 * `classifyJobReachability`（供 planner 与审计使用）与迁移 037 建立的
 * `catalog.job_reachability_verdict`（供资格视图使用）。
 *
 * 两份实现必然走偏，因此逐分支对账。只测总数不够：两处相反的错误会互相抵消而总数仍相等。
 *
 * 契约侧目前**没有**「明示多年经验」这一分支，SQL 侧有（ADR-0035 新增）。这个差异是已知且
 * 有意的，在下面显式登记，而不是让它静默存在——契约侧补齐后应删除该登记。
 */
describeWithDatabase("job reachability TypeScript and SQL parity", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");

  beforeAll(async () => {
    await migrateToLatest(db);
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
  });

  const sqlVerdict = async (requirements: string, responsibilities = "") => {
    const { rows } = await sql<{ verdict: string }>`
      SELECT catalog.job_reachability_verdict(${requirements}, ${responsibilities}) AS verdict
    `.execute(db);
    return rows[0]?.verdict ?? "";
  };

  /** 覆盖契约侧每一个判定分支。 */
  const sharedBranches = [
    "本科及以上学历，计算机相关专业",
    "大专及以上即可",
    "专科在读可投",
    "学历不限，欢迎在校生",
    "不限专业，接受在校生",
    "本科或硕士均可",
    "硕士及以上学历",
    "博士在读优先",
    "研究生在读",
    "985/211 院校本科及以上",
    "双一流高校优先",
    "重点院校毕业",
    "负责数据看板搭建，熟悉 SQL",
    "每周到岗 4 天，实习 3 个月以上",
    "",
  ];

  it.each(sharedBranches)("agrees on: %s", async (text) => {
    const fromSql = await sqlVerdict(text);
    const fromTypeScript = classifyJobReachability({ requirements: text });
    expect(fromSql, `SQL 与 TypeScript 判定不一致：「${text}」`).toBe(fromTypeScript);
  });

  it("agrees when the education phrase appears only in responsibilities", async () => {
    const requirements = "能长期实习";
    const responsibilities = "面向本科三年级学生的培养岗";
    expect(await sqlVerdict(requirements, responsibilities)).toBe(
      classifyJobReachability({ requirements, responsibilities }),
    );
  });

  it("registers the one intentional divergence: SQL adds an experience exclusion", async () => {
    const text = "本科及以上，3 年以上相关工作经验";
    // SQL 侧按 ADR-0035 排除明示多年经验；契约侧尚未实现该分支，仍判 reachable。
    expect(await sqlVerdict(text)).toBe("not_reachable_experience_required");
    expect(classifyJobReachability({ requirements: text })).toBe("reachable");
    // 该差异只影响「更严」的方向：SQL 排除得更多，不会让不可投岗位进入 Alpha。
    // 契约侧补齐后请删除本用例，并把该文本移入 sharedBranches。
  });

  it("keeps the experience exclusion from catching internship months", async () => {
    const text = "本科及以上，具备 3 个月实习经验";
    expect(await sqlVerdict(text)).toBe("reachable");
    expect(classifyJobReachability({ requirements: text })).toBe("reachable");
  });
});
