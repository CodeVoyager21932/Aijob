import { describe, expect, it } from "vitest";
import { getWorkspaceBreadcrumbs, workspaceNavigation } from "./navigation";

describe("Career OS workspace navigation", () => {
  it("keeps one global navigation with the approved labels", () => {
    expect(workspaceNavigation.map((item) => item.label)).toEqual([
      "今日",
      "发现岗位",
      "我的求职",
      "简历资产",
    ]);
  });

  it("restores case and tab context from a deep link", () => {
    expect(
      getWorkspaceBreadcrumbs("/applications/case-starbridge-product/requirements").map(
        (item) => item.label,
      ),
    ).toEqual(["我的求职", "求职项目", "JD能力"]);
  });
});
