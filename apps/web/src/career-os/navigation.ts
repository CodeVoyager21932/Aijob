import type { IconName } from "./components/Icon";
import { caseTabs } from "./workspace-model";

export interface WorkspaceNavigationItem {
  to: string;
  label: string;
  icon: IconName;
}

export const workspaceNavigation: WorkspaceNavigationItem[] = [
  { to: "/today", label: "今日", icon: "home" },
  { to: "/jobs", label: "发现岗位", icon: "search" },
  { to: "/applications", label: "我的求职", icon: "briefcase" },
  { to: "/resumes", label: "简历资产", icon: "document" },
];

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

const routeLabels = new Map([
  ["/today", "今日"],
  ["/jobs", "发现岗位"],
  ["/applications", "我的求职"],
  ["/resumes", "简历资产"],
  ["/settings/data", "数据与设置"],
]);

export function getWorkspaceBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const directLabel = routeLabels.get(pathname);
  if (directLabel) return [{ label: directLabel }];

  if (pathname === "/jobs/recommended" || /^\/jobs\/recommended\/[^/]+$/.test(pathname)) {
    return [{ label: "发现岗位", to: "/jobs" }, { label: "证据推荐" }];
  }

  if (pathname === "/jobs/insights" || /^\/jobs\/insights\/[^/]+$/.test(pathname)) {
    return [{ label: "发现岗位", to: "/jobs" }, { label: "岗位洞察" }];
  }

  if (/^\/jobs\/[^/]+$/.test(pathname)) {
    return [{ label: "发现岗位", to: "/jobs" }, { label: "岗位详情" }];
  }

  const caseMatch = pathname.match(/^\/applications\/([^/]+)\/([^/]+)$/);
  if (caseMatch) {
    const activeTab = caseTabs.find((tab) => tab.value === caseMatch[2]);
    return [
      { label: "我的求职", to: "/applications" },
      { label: "求职项目" },
      ...(activeTab ? [{ label: activeTab.label }] : []),
    ];
  }

  if (/^\/resumes\/import\/confirm\/[^/]+$/.test(pathname)) {
    return [
      { label: "简历资产", to: "/resumes" },
      { label: "准备简历", to: "/resumes/import" },
      { label: "确认资料" },
    ];
  }

  if (pathname === "/resumes/import") {
    return [{ label: "简历资产", to: "/resumes" }, { label: "准备简历" }];
  }

  if (/^\/resumes\/[^/]+$/.test(pathname)) {
    return [{ label: "简历资产", to: "/resumes" }, { label: "基础简历" }];
  }

  const legacyLabels = new Map([["/data-control", "数据控制"]]);
  return [{ label: legacyLabels.get(pathname) ?? "Aijob" }];
}
