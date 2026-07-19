import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { clearDeletedOwnerCache, removeConfirmedResumeAnalysisCache } from "./privacy-cache";

describe("owner privacy cache", () => {
  it("removes confirmed resume analysis text without discarding the new profile revisions", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["product", "resume-analysis", "analysis-one"], {
      result: { redactedText: "private resume text" },
    });
    queryClient.setQueryData(["product", "profile", "facts"], { revision: 1 });

    removeConfirmedResumeAnalysisCache(queryClient, "analysis-one");

    expect(
      queryClient.getQueryData(["product", "resume-analysis", "analysis-one"]),
    ).toBeUndefined();
    expect(queryClient.getQueryData(["product", "profile", "facts"])).toEqual({ revision: 1 });
  });

  it("clears query and mutation caches after an owner is deleted", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["product", "profile", "evidence"], {
      evidence: [{ originalText: "confirmed but private evidence" }],
    });
    queryClient.setQueryData(["product", "recommendation", "run-one"], { ownerId: "owner-one" });
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: ["product", "resume-tailoring"],
      mutationFn: async () => ({ suggestedText: "private tailored text" }),
    });

    clearDeletedOwnerCache(queryClient);

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
});
