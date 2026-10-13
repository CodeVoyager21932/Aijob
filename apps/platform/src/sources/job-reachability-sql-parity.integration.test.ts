import { classifyJobReachability } from "@aijob/contracts";
import { createDatabase, migrateToLatest } from "@aijob/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/** Current ADR-0037 semantics must agree across TypeScript and PostgreSQL. */
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

  it.each([
    "本科及以上，3 年以上相关工作经验",
    "至少三年工作经验",
    "无需3年工作经验",
    "3年工作经验优先",
    "3年工作经验或优秀应届生",
    "本科及以上，不限985、211",
    "985院校优先",
    "1-3年工作经验",
  ])("unifies experience and education semantics: %s", async (text) => {
    expect(await sqlVerdict(text)).toBe(classifyJobReachability({ requirements: text }));
  });

  it("keeps the experience exclusion from catching internship months", async () => {
    const text = "本科及以上，具备 3 个月实习经验";
    expect(await sqlVerdict(text)).toBe("reachable");
    expect(classifyJobReachability({ requirements: text })).toBe("reachable");
  });

  it.each([
    ["2年工作经验且硕士优先", "not_reachable_experience_required"],
    ["应届硕士需3年工作经验", "not_reachable_experience_required"],
    ["硕士优先，但需三年工作经验", "not_reachable_experience_required"],
    ["本科或硕士，需3年工作经验", "not_reachable_experience_required"],
    ["本科及以上，3年工作经验，或优秀应届生", "reachable"],
    ["本科及以上，无需三年经验且接受应届生", "reachable"],
    ["硕士，有两年实习经验优先", "reachable"],
  ] as const)("scopes independent conditions: %s", async (text, expected) => {
    expect(classifyJobReachability({ requirements: text })).toBe(expected);
    expect(await sqlVerdict(text)).toBe(expected);
  });
});
