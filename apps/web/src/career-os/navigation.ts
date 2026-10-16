import type { IconName } from "./components/Icon";
import { caseTabs } from "./workspace-model";

export interface WorkspaceNavigationItem {
  to: string;
  label: string;
  icon: IconName;
}

export const workspaceNavigationGroups: { label: string; items: WorkspaceNavigationItem[] }[] = [
  {
    label: "",
    items: [
      { to: "/today", label: "今日", icon: "home" },
      { to: "/jobs", label: "找岗位", icon: "search" },
      { to: "/resumes", label: "简历与经历", icon: "document" },
      { to: "/applications", label: "投递管理", icon: "briefcase" },
      { to: "/applications/planner", label: "日程", icon: "calendar" },
    ],
  },
];
export const workspaceNavigation: WorkspaceNavigationItem[] = workspaceNavigationGroups.flatMap(
  (group) => group.items,
);
export const workspaceAuxiliaryNavigation: WorkspaceNavigationItem[] = [
  { to: "/materials", label: "经历与材料", icon: "book" },
  { to: "/jobs/insights", label: "方向探索", icon: "board" },
  { to: "/interviews", label: "面试练习", icon: "interview" },
  { to: "/guides", label: "求职指南", icon: "book" },
  { to: "/settings/data", label: "资料与设置", icon: "settings" },
  { to: "/settings/ai", label: "连接与运行", icon: "settings" },
];
export function isWorkspaceItemActive(to: string, pathname: string) {
  if (to === "/jobs") return pathname.startsWith("/jobs");
  if (to === "/resumes")
    return (
      pathname.startsWith("/resumes") ||
      pathname.startsWith("/materials") ||
      pathname === "/assistant"
    );
  if (to === "/applications")
    return (
      (pathname.startsWith("/applications") && !pathname.startsWith("/applications/planner")) ||
      pathname.startsWith("/interviews")
    );
  if (to === "/materials") return pathname.startsWith("/materials") || pathname === "/assistant";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function workspaceContextNavigation(pathname: string): { to: string; label: string }[] {
  if (pathname.startsWith("/jobs"))
    return [
      { to: "/jobs", label: "岗位与方向" },
      { to: "/jobs/insights", label: "探索方向" },
    ];
  if (/^\/(resumes|materials|assistant)(\/|$)/.test(pathname))
    return [
      { to: "/resumes", label: "我的简历" },
      { to: "/materials", label: "经历与原件" },
    ];
  if (pathname.startsWith("/settings"))
    return [
      { to: "/settings/ai", label: "连接与运行" },
      { to: "/settings/data", label: "账户与资料" },
    ];
  if (pathname === "/applications" || pathname.startsWith("/interviews"))
    return [
      { to: "/applications", label: "投递进度" },
      { to: "/interviews", label: "面试练习" },
    ];
  return [];
}

export const workspaceSearchAliases: Record<string, string> = {
  "/jobs": "自动找岗位 搜索网站 抓取 方向 订阅 招聘 实习",
  "/resumes": "导入 上传 拖拽 写简历 模板 编辑 导出 PDF DOCX",
  "/materials": "经历 原件 资料 复用",
  "/settings/ai": "API Key 模型 DeepSeek OpenAI Tavily 搜索 配置",
  "/settings/data": "恢复 账号 找回 删除",
  "/applications/planner": "准备清单 日程 待办",
};

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function isDeletionReceiptRoute(pathname: string): boolean {
  return (
    pathname === "/settings/data/deletion" ||
    pathname === "/data-control/deletion" ||
    pathname.startsWith("/data-control/deletion/")
  );
}

const routeLabels = new Map([
  ["/today", "今日工作台"],
  ["/jobs", "岗位发现"],
  ["/applications", "投递管理"],
  ["/applications/planner", "准备与日程"],
  ["/resumes", "我的简历"],
  ["/resumes/snippets", "自我介绍与材料"],
  ["/settings/data", "资料与设置"],
  ["/settings/ai", "连接与运行"],
  ["/materials", "经历与材料"],
  ["/assistant", "求职助手"],
  ["/interviews", "面试练习"],
  ["/guides", "求职指南"],
  ["/settings/data/deletion", "删除回执"],
]);

export function getWorkspaceBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const directLabel = routeLabels.get(pathname);
  if (directLabel) return [{ label: directLabel }];

  if (pathname === "/jobs/recommended" || /^\/jobs\/recommended\/[^/]+$/.test(pathname)) {
    return [{ label: "机会", to: "/jobs" }, { label: "证据推荐" }];
  }

  if (pathname === "/jobs/insights" || /^\/jobs\/insights\/[^/]+$/.test(pathname)) {
    return [{ label: "机会", to: "/jobs" }, { label: "方向图谱" }];
  }

  if (/^\/jobs\/[^/]+$/.test(pathname)) {
    return [{ label: "机会", to: "/jobs" }, { label: "岗位详情" }];
  }

  const caseMatch = pathname.match(/^\/applications\/([^/]+)\/([^/]+)$/);
  if (caseMatch) {
    const activeTab = caseTabs.find((tab) => tab.value === caseMatch[2]);
    return [
      { label: "申请", to: "/applications" },
      { label: "求职项目" },
      ...(activeTab ? [{ label: activeTab.label }] : []),
    ];
  }

  if (/^\/resumes\/import\/confirm\/[^/]+$/.test(pathname)) {
    return [
      { label: "我的简历", to: "/resumes" },
      { label: "准备简历", to: "/resumes/import" },
      { label: "继续旧导入" },
    ];
  }

  if (pathname === "/resumes/import") {
    return [{ label: "我的简历", to: "/resumes" }, { label: "准备简历" }];
  }

  if (/^\/resumes\/native\/[^/]+$/.test(pathname)) {
    return [{ label: "我的简历", to: "/resumes" }, { label: "编辑简历" }];
  }
  if (/^\/resumes\/[^/]+$/.test(pathname)) {
    return [{ label: "我的简历", to: "/resumes" }, { label: "编辑简历" }];
  }

  if (/^\/resume-tailorings\/[^/]+$/.test(pathname)) {
    return [{ label: "我的简历", to: "/resumes" }, { label: "旧版优化历史" }];
  }

  const legacyLabels = new Map([["/data-control", "数据控制"]]);
  return [{ label: legacyLabels.get(pathname) ?? "Aijob" }];
}
