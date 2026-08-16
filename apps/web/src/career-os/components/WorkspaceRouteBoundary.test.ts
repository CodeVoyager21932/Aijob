import { describe, expect, it } from "vitest";
import { workspaceRouteBoundaryKey } from "./WorkspaceRouteBoundary";

describe("workspace route boundary identity", () => {
  it("keeps the same boundary while Resume Studio deep-link parameters change", () => {
    expect(
      workspaceRouteBoundaryKey({
        pathname: "/applications/case-1/resume",
        search: "?studio=document&block=b1",
      }),
    ).toBe(
      workspaceRouteBoundaryKey({
        pathname: "/applications/case-1/resume",
        search: "?studio=review&requirement=r1",
      }),
    );
  });

  it("resets the boundary when the routed workspace path changes", () => {
    expect(workspaceRouteBoundaryKey({ pathname: "/applications/case-1/resume" })).not.toBe(
      workspaceRouteBoundaryKey({ pathname: "/applications/case-1/requirements" }),
    );
  });
});
