import { describe, expect, it } from "vitest";
import {
  canonicalizeApplicationsSearchParams,
  readApplicationsViewState,
  writeApplicationsViewState,
} from "./applications-state";

describe("Career OS applications URL state", () => {
  it("falls back to the canonical view for invalid URL values", () => {
    const state = readApplicationsViewState(
      new URLSearchParams("view=tiles&stage=ranking&city=&sort=score"),
    );

    expect(state).toEqual({
      view: "board",
      stage: "all",
      city: "all",
      sort: "updated",
    });
  });

  it("writes every required view field while preserving the selected peek case", () => {
    const next = writeApplicationsViewState(new URLSearchParams("peek=case-one"), {
      view: "list",
      stage: "interviewing",
      city: "北京",
      sort: "deadline",
    });

    expect(next.get("view")).toBe("list");
    expect(next.get("stage")).toBe("interviewing");
    expect(next.get("city")).toBe("北京");
    expect(next.get("sort")).toBe("deadline");
    expect(next.get("peek")).toBe("case-one");
  });

  it("canonicalizes a partial deep link without losing its side inspector", () => {
    const canonical = canonicalizeApplicationsSearchParams(
      new URLSearchParams("view=list&peek=case-starbridge-product"),
    );

    expect(canonical.toString()).toBe(
      "view=list&peek=case-starbridge-product&stage=all&city=all&sort=updated",
    );
  });
});
