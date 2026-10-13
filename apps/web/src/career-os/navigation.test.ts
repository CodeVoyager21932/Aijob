import { describe, expect, it } from "vitest";
import { getWorkspaceBreadcrumbs, isDeletionReceiptRoute, workspaceNavigation, isWorkspaceItemActive } from "./navigation";

describe("Career OS workspace navigation", () => {
  it("keeps one global navigation with the approved labels", () => {
    expect(workspaceNavigation.map((item) => item.label)).toEqual(["今日工作台", "岗位发现", "方向图谱", "我的简历", "经历与材料", "投递管理", "准备与日程", "面试练习"]);
  });

  it("keeps only the task destination active for graph and planner deep links", () => {
    expect(isWorkspaceItemActive("/jobs", "/jobs/insights")).toBe(false);
    expect(isWorkspaceItemActive("/jobs/insights", "/jobs/insights")).toBe(true);
    expect(isWorkspaceItemActive("/applications", "/applications/planner")).toBe(false);
    expect(isWorkspaceItemActive("/applications/planner", "/applications/planner")).toBe(true);
  });
  it("restores case and tab context from a deep link", () => {
    expect(
      getWorkspaceBreadcrumbs("/applications/case-starbridge-product/requirements").map(
        (item) => item.label,
      ),
    ).toEqual(["申请", "求职项目", "JD能力"]);
  });

  it("keeps canonical job and resume deep links inside their workspace", () => {
    expect(getWorkspaceBreadcrumbs("/jobs/recommended/run-one")).toEqual([
      { label: "机会", to: "/jobs" },
      { label: "证据推荐" },
    ]);
    expect(getWorkspaceBreadcrumbs("/jobs/insights/run-one")).toEqual([
      { label: "机会", to: "/jobs" },
      { label: "方向图谱" },
    ]);
    expect(getWorkspaceBreadcrumbs("/resumes/import/confirm/analysis-one")).toEqual([
      { label: "我的简历", to: "/resumes" },
      { label: "准备简历", to: "/resumes/import" },
      { label: "继续旧导入" },
    ]);
    expect(getWorkspaceBreadcrumbs("/settings/data/deletion")).toEqual([{ label: "删除回执" }]);
    expect(getWorkspaceBreadcrumbs("/resume-tailorings/history-one")).toEqual([
      { label: "我的简历", to: "/resumes" },
      { label: "旧版优化历史" },
    ]);
  });

  it("keeps canonical and compatibility deletion receipts outside session bootstrap", () => {
    expect(isDeletionReceiptRoute("/settings/data/deletion")).toBe(true);
    expect(isDeletionReceiptRoute("/data-control/deletion")).toBe(true);
    expect(isDeletionReceiptRoute("/data-control/deletion/legacy-tail")).toBe(true);
    expect(isDeletionReceiptRoute("/settings/data")).toBe(false);
    expect(isDeletionReceiptRoute("/data-control")).toBe(false);
  });
});
