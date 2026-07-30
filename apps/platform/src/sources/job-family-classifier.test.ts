import type { JobFamily } from "@aijob/contracts";
import { describe, expect, it } from "vitest";
import { classifyOfficialJobFamily } from "./job-family-classifier.js";

describe("official job-family classifier", () => {
  it.each([
    ["产品经理实习生", "product"],
    ["内容运营实习生", "operations"],
    ["后端开发实习生", "engineering"],
    ["大模型算法实习生", "data_ai"],
    ["视觉设计实习生", "design"],
    ["品牌市场实习生", "marketing"],
    ["商务拓展实习生", "sales_business"],
    ["财务会计实习生", "finance"],
    ["法务合规实习生", "people_admin_legal"],
    ["行业研究实习生", "research_consulting"],
    ["供应链采购实习生", "supply_chain_manufacturing"],
  ] satisfies Array<[string, Exclude<JobFamily, "other">]>)(
    "classifies %s as %s",
    (title, expected) => {
      expect(
        classifyOfficialJobFamily({
          title,
          sourceEvidenceRef: "fixture#family",
          titleEvidenceRef: "fixture#title",
        }),
      ).toMatchObject({
        value: { state: "known", value: expected },
        requiresManualReview: true,
      });
    },
  );

  it("accepts an exact official other label without guessing from an empty title", () => {
    expect(
      classifyOfficialJobFamily({
        title: "专项实习生",
        sourceLabels: ["其他"],
        sourceEvidenceRef: "fixture#family",
      }),
    ).toMatchObject({ value: { state: "known", value: "other" }, requiresManualReview: false });
  });

  it("keeps cross-family titles as a conflict", () => {
    expect(
      classifyOfficialJobFamily({
        title: "供应链产品实习生",
        sourceLabels: ["产品"],
        sourceEvidenceRef: "fixture#family",
        titleEvidenceRef: "fixture#title",
      }).value,
    ).toMatchObject({
      state: "conflict",
      rawValues: ["product", "supply_chain_manufacturing"],
    });
  });

  it("keeps enough conflict evidence when both facts came from one frozen page", () => {
    expect(
      classifyOfficialJobFamily({
        title: "供应链产品实习生",
        sourceLabels: ["产品"],
        sourceEvidenceRef: "fixture#page",
        titleEvidenceRef: "fixture#page",
      }).value,
    ).toMatchObject({
      state: "conflict",
      evidenceRefs: ["fixture#page", "fixture#page", "fixture#page"],
    });
  });

  it("keeps unrecognized roles unknown", () => {
    expect(
      classifyOfficialJobFamily({
        title: "专项实习生",
        sourceEvidenceRef: "fixture#family",
      }).value,
    ).toEqual({ state: "unknown", reason: "not_yet_verified" });
  });
});
