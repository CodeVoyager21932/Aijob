import { readFile } from "node:fs/promises";
import type { JobFamily } from "@aijob/contracts";
import { JobFamilySchema } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";

interface GoldenCase {
  caseId: string;
  title: string;
  sourceKey: string;
  officialCategory: string;
  expectedFamily: string;
  conflictUnknown: "known" | "conflict" | "unknown";
  requiresManualReview: boolean;
  annotatorA: string;
  annotatorB: string;
  disagreementResolution: string;
  labeledAt: string;
}

async function loadGoldenCases(): Promise<GoldenCase[]> {
  const text = await readFile(
    new URL("../../../../fixtures/gold/job-family-classification.golden.csv", import.meta.url),
    "utf8",
  );
  const [header, ...rows] = text.trim().split(/\r?\n/);
  expect(header).toBe(
    "case_id,title,sourceKey,officialCategory,expectedFamily,conflictUnknown,requiresManualReview,annotatorA,annotatorB,disagreementResolution,labeledAt",
  );
  return rows.map((row) => {
    const columns = row.split(",");
    if (columns.length !== 11) {
      throw new Error(`GOLDEN_CASE_COLUMN_COUNT_INVALID:${row}`);
    }
    const [
      caseId,
      title,
      sourceKey,
      officialCategory,
      expectedFamily,
      conflictUnknown,
      requiresManualReview,
      annotatorA,
      annotatorB,
      disagreementResolution,
      labeledAt,
    ] = columns as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    return {
      caseId,
      title,
      sourceKey,
      officialCategory,
      expectedFamily,
      conflictUnknown: conflictUnknown as GoldenCase["conflictUnknown"],
      requiresManualReview: requiresManualReview === "true",
      annotatorA,
      annotatorB,
      disagreementResolution,
      labeledAt,
    };
  });
}

describe("job family classification golden set", () => {
  it("keeps at least 50 independently labeled cases across every family", async () => {
    const cases = await loadGoldenCases();
    expect(cases.length).toBeGreaterThanOrEqual(50);
    expect(new Set(cases.map((testCase) => testCase.caseId)).size).toBe(cases.length);
    expect(cases.every((testCase) => testCase.annotatorA.length > 0)).toBe(true);
    expect(cases.every((testCase) => testCase.annotatorB.length > 0)).toBe(true);
    expect(cases.every((testCase) => testCase.disagreementResolution.length > 0)).toBe(true);
    expect(cases.every((testCase) => testCase.labeledAt === "2026-07-30")).toBe(true);

    for (const family of JobFamilySchema.options) {
      const count = cases.filter((testCase) =>
        testCase.expectedFamily.split("|").includes(family),
      ).length;
      expect(count, family).toBeGreaterThanOrEqual(2);
    }
  });

  it("replays every frozen classification decision", async () => {
    const cases = await loadGoldenCases();
    for (const testCase of cases) {
      const result = classifyOfficialJobFamily({
        title: testCase.title,
        sourceLabels: testCase.officialCategory ? [testCase.officialCategory] : [],
        sourceEvidenceRef: `${testCase.sourceKey}#category`,
        titleEvidenceRef: `${testCase.sourceKey}#title`,
      });
      expect(result.requiresManualReview, testCase.caseId).toBe(testCase.requiresManualReview);
      expect(result.value.state, testCase.caseId).toBe(testCase.conflictUnknown);
      if (result.value.state === "known") {
        expect(result.value.value, testCase.caseId).toBe(testCase.expectedFamily as JobFamily);
      } else if (result.value.state === "conflict") {
        expect(new Set(result.value.rawValues), testCase.caseId).toEqual(
          new Set(testCase.expectedFamily.split("|") as JobFamily[]),
        );
      } else {
        expect(testCase.expectedFamily, testCase.caseId).toBe("");
      }
    }
  });
});
