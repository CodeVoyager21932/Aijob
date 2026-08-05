import { describe, expect, it } from "vitest";
import { getWorkspaceBreadcrumbs, workspaceNavigation } from "./navigation";

describe("Career OS workspace navigation", () => {
  it("keeps one global navigation with the approved labels", () => {
    expect(workspaceNavigation.map((item) => item.label)).toEqual([
      "今日",
      "发现岗位",
      "我的求职",
      "简历资产",
      "面试训练",
      "经验库",
    ]);
  });

  it("restores case and tab context from a deep link", () => {
    expect(
      getWorkspaceBreadcrumbs("/applications/case-starbridge-product/requirements").map(
        (item) => item.label,
      ),
    ).toEqual(["我的求职", "示例·星桥科技", "JD能力"]);
  });
});
