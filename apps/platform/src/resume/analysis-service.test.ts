import { describe, expect, it } from "vitest";
import { rebuildResumeAnalysisResult } from "./analysis-service.js";

const analysisId = "10000000-0000-4000-8000-000000000001";

describe("resume analysis v2", () => {
  it("splits a 1612-character single-line resume into atomic source blocks", () => {
    const text = "负责用户研究和数据分析".repeat(200).slice(0, 1_612);
    const result = rebuildResumeAnalysisResult({
      analysisId,
      extractedText: text,
      storageMetadata: {
        version: "resume-analysis-storage-v2",
        candidateEvidenceCount: 4,
        documentBlockCount: 4,
      },
    });

    expect(result.version).toBe("resume-analysis-v2");
    if (result.version !== "resume-analysis-v2") throw new Error("unexpected legacy result");
    expect(result.document.sections.flatMap((section) => section.blocks)).toHaveLength(4);
    expect(result.candidateEvidence).toHaveLength(4);
    expect(
      Math.max(...result.candidateEvidence.map(({ statement }) => statement.length)),
    ).toBeLessThanOrEqual(500);
    expect(new Set(result.candidateEvidence.map(({ sourceBlockId }) => sourceBlockId)).size).toBe(
      4,
    );
  });

  it("proposes education, major, graduation year and student status without confirming them", () => {
    const text = "本科在读；专业：计算机科学；预计 2027 年毕业；使用 SQL 和 Figma。";
    const result = rebuildResumeAnalysisResult({
      analysisId,
      extractedText: text,
      storageMetadata: {
        version: "resume-analysis-storage-v2",
        candidateEvidenceCount: 3,
        documentBlockCount: 4,
      },
    });

    if (result.version !== "resume-analysis-v2") throw new Error("unexpected legacy result");
    expect(result.candidateFacts).toEqual(
      expect.arrayContaining([
        { key: "current_student", value: true, confirmed: false },
        { key: "education_level", value: "本科", confirmed: false },
        { key: "graduation_year", value: 2027, confirmed: false },
        { key: "majors", value: ["计算机科学"], confirmed: false },
        { key: "skills", value: ["Figma", "SQL"], confirmed: false },
      ]),
    );
  });

  it("extracts a major written before 专业 without swallowing later education facts", () => {
    const text = "教育经历\nA大学 信息管理专业 本科 2027年毕业 在校生";
    const result = rebuildResumeAnalysisResult({
      analysisId,
      extractedText: text,
      storageMetadata: {
        version: "resume-analysis-storage-v2",
        candidateEvidenceCount: 1,
        documentBlockCount: 1,
      },
    });

    if (result.version !== "resume-analysis-v2") throw new Error("unexpected legacy result");
    expect(result.candidateFacts).toEqual(
      expect.arrayContaining([
        { key: "majors", value: ["信息管理"], confirmed: false },
        { key: "education_level", value: "本科", confirmed: false },
        { key: "graduation_year", value: 2027, confirmed: false },
        { key: "current_student", value: true, confirmed: false },
      ]),
    );
  });
});
