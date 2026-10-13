import { randomUUID } from "node:crypto";
import {
  blankResumeEntry,
  JobGraphItemSchema,
  ResumeEvidenceSchema,
  resumeRichText,
} from "@aijob/contracts";
import { expect, it } from "vitest";
import { relatedGraphEvidence, relatedGraphExperiences } from "./personal-comparison.js";

const item = (key: string, label: string, kind: "tool" | "task" | "education") =>
  JobGraphItemSchema.parse({
    key,
    label,
    kind,
    jobCount: 1,
    companyCount: 1,
    mentionRate: 1,
    companyCoverage: 1,
    requiredJobCount: 1,
    preferredJobCount: 0,
    unknownJobCount: 0,
    negatedJobCount: 0,
    conditionalJobCount: 0,
    examples: [],
  });
const evidence = (statement: string, skills: string[] = []) =>
  ResumeEvidenceSchema.parse({
    id: randomUUID(),
    sourceBlockId: randomUUID(),
    resumeAnalysisId: null,
    section: "课程项目",
    evidenceType: "project",
    statement,
    skills,
    outcomes: [],
    confirmed: true,
  });
it("matches exact tools without treating NoSQL as SQL, and keeps original statements", () => {
  const rows = [evidence("使用 NoSQL 保存数据"), evidence("使用 SQL 分析留存率")];
  expect(relatedGraphEvidence(item("tool:sql", "SQL", "tool"), rows)).toEqual([
    {
      evidenceId: rows[1]?.id,
      statement: "使用 SQL 分析留存率",
      section: "课程项目",
      reason: "已确认经历中出现相同表述",
    },
  ]);
});
it("offers task cues for manual review and never infers eligibility from resume evidence", () => {
  const rows = [evidence("组织用户访谈并整理反馈")];
  expect(relatedGraphEvidence(item("task:user_research", "用户研究", "task"), rows)).toHaveLength(
    1,
  );
  expect(
    relatedGraphEvidence(item("education:硕士", "硕士", "education"), [
      evidence("参与硕士研究项目"),
    ]),
  ).toEqual([]);
});

it("matches a whole experience without a confirmed-evidence record and preserves project context", () => {
  const statement = "为课程项目整理 12 份访谈，使用 SQL 比较使用频率。交付包含过程和限制的报告。";
  const experience = {
    id: randomUUID(),
    kind: "project" as const,
    title: "课程调研",
    revision: 3,
    entry: {
      ...blankResumeEntry(randomUUID()),
      title: "课程调研",
      organization: "课程小组",
      role: "研究成员",
      body: resumeRichText(statement),
    },
  };
  expect(relatedGraphExperiences(item("tool:sql", "SQL", "tool"), [experience])).toEqual([
    {
      evidenceId: null,
      experienceId: experience.id,
      experienceRevision: 3,
      title: "课程调研",
      section: "课程小组 · 研究成员",
      statement,
      reason: "经历中出现相同表述",
    },
  ]);
  expect(
    relatedGraphExperiences(item("tool:sql", "SQL", "tool"), [
      {
        ...experience,
        entry: { ...experience.entry, body: resumeRichText("使用 NoSQL 保存记录") },
      },
    ]),
  ).toEqual([]);
  expect(
    relatedGraphExperiences(item("education:硕士", "硕士", "education"), [experience]),
  ).toEqual([]);
});
