import { describe, expect, it } from "vitest";
import { loadSourceCandidateRegistry } from "./source-candidates.js";

describe("source candidate registry", () => {
  it("locks the priority order and keeps unassessed companies non-runnable", async () => {
    const registry = await loadSourceCandidateRegistry();
    expect(registry.priorityBatch.map((candidate) => candidate.displayName)).toEqual([
      "腾讯",
      "美团",
      "好未来",
      "字节跳动",
      "阿里巴巴",
      "京东",
      "百度",
      "华为",
      "小米",
      "滴滴",
      "快手",
      "网易",
    ]);
    expect(registry.liveProbeRequiresExplicitApproval).toBe(true);
    expect(registry.priorityBatch.find((candidate) => candidate.companyKey === "baidu")).toEqual(
      expect.objectContaining({
        assessmentStatus: "configured_pending_review",
        sourceKeys: ["baidu-internships"],
      }),
    );
    expect(registry.priorityBatch.find((candidate) => candidate.companyKey === "jd")).toEqual(
      expect.objectContaining({
        assessmentStatus: "configured_pending_review",
        sourceKeys: ["jd-campus-internships"],
      }),
    );
    expect(
      registry.priorityBatch.find((candidate) => candidate.companyKey === "bytedance"),
    ).toEqual(
      expect.objectContaining({
        assessmentStatus: "configured_pending_review",
        sourceKeys: ["bytedance-campus-manual"],
      }),
    );
    expect(
      registry.priorityBatch
        .filter((candidate) => candidate.companyKey === "alibaba")
        .every((candidate) => candidate.assessmentStatus === "paused"),
    ).toBe(true);
    expect(
      registry.priorityBatch
        .filter((candidate) => candidate.assessmentStatus === "not_assessed")
        .every((candidate) => candidate.sourceKeys.length === 0),
    ).toBe(true);
  });
});
