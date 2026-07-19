import type { FieldValue } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { findCrossSourceDuplicateCandidates } from "./dedupe.js";

function locations(values: string[]): FieldValue<string[]> {
  return { state: "known", value: values, evidenceRefs: ["revision#locations"] };
}

describe("cross-source duplicate candidates", () => {
  it("only creates a review candidate and never merges records", () => {
    const result = findCrossSourceDuplicateCandidates([
      {
        id: "job-a",
        sourceId: "source-a",
        companyName: "示例科技",
        title: "产品运营实习生",
        locations: locations(["深圳"]),
        officialDomain: "example.com",
      },
      {
        id: "job-b",
        sourceId: "source-b",
        companyName: "示例科技",
        title: "产品运营（实习生）",
        locations: locations(["深圳"]),
        officialDomain: "example.com",
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      leftJobId: "job-a",
      rightJobId: "job-b",
      reasons: ["same_official_domain", "similar_normalized_title", "overlapping_location"],
    });
  });

  it("does not compare within one source or when known locations conflict", () => {
    expect(
      findCrossSourceDuplicateCandidates([
        {
          id: "same-a",
          sourceId: "source-a",
          companyName: "示例科技",
          title: "产品实习生",
          locations: locations(["深圳"]),
        },
        {
          id: "same-b",
          sourceId: "source-a",
          companyName: "示例科技",
          title: "产品实习生",
          locations: locations(["深圳"]),
        },
        {
          id: "other-city",
          sourceId: "source-b",
          companyName: "示例科技",
          title: "产品实习生",
          locations: locations(["北京"]),
        },
      ]),
    ).toEqual([]);
  });
});
