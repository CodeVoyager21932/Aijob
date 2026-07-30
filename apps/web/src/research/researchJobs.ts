import type { ResearchJob, ResearchOfficialTarget } from "./types";

const reviewedAt = "2026-07-18T13:01:09.669+08:00";
const officialPageNotSpecified = "官方页面未说明";
const tencentOfficialTarget: ResearchOfficialTarget = {
  scheme: "https",
  host: "join.qq.com",
  port: 443,
  pathPrefix: "/post_detail.html",
  allowedQueryParameters: ["postid"],
};

/**
 * Only coco or a designated human reviewer may add rows here, and only after the
 * corresponding official page has been checked and coco has explicitly confirmed
 * it for the local G0 research sample. Collector candidates never enter this
 * catalog without that human confirmation.
 */
export const approvedResearchJobs: readonly ResearchJob[] = [
  {
    id: "G0-CAND-001",
    organizationSlug: "tencent",
    organizationName: "腾讯",
    title: "游戏用户研究",
    family: { state: "known", value: "operations" },
    cities: { state: "known", value: [{ key: "shenzhen", label: "深圳总部" }] },
    weeklyAttendanceDays: { state: "unknown", reason: officialPageNotSpecified },
    durationMonths: { state: "unknown", reason: officialPageNotSpecified },
    recruitmentBatch: { state: "known", value: "日常实习" },
    earliestStartDate: { state: "unknown", reason: officialPageNotSpecified },
    graduationYears: { state: "unknown", reason: officialPageNotSpecified },
    responsibilitiesExcerpt: "洞察游戏行业、积累用户画像、运用用户行为分析并输出产品运营决策支持",
    requirementsExcerpt: "心理学等相关专业；用户研究、数据意识、访谈沟通与分析能力",
    sourceType: "企业官网",
    sourceUrl: "https://join.qq.com/post_detail.html?postid=1257021174874167296",
    officialTarget: tencentOfficialTarget,
    activityState: { state: "known", value: "active" },
    lastVerifiedAt: "2026-07-17T13:20:36.511+08:00",
    reviewedAt,
  },
  {
    id: "G0-CAND-002",
    organizationSlug: "tencent",
    organizationName: "腾讯",
    title: "业务管理运营",
    family: { state: "known", value: "operations" },
    cities: {
      state: "known",
      value: [
        { key: "shenzhen", label: "深圳总部" },
        { key: "beijing", label: "北京" },
      ],
    },
    weeklyAttendanceDays: { state: "unknown", reason: officialPageNotSpecified },
    durationMonths: { state: "unknown", reason: officialPageNotSpecified },
    recruitmentBatch: { state: "known", value: "日常实习" },
    earliestStartDate: { state: "unknown", reason: officialPageNotSpecified },
    graduationYears: { state: "unknown", reason: officialPageNotSpecified },
    responsibilitiesExcerpt: "梳理业务指标、分析问题、提出策略并推动落地，设计数据可视化方案",
    requirementsExcerpt: "经营分析背景；数据思维；沟通协调；熟悉 SQL、Python 或 R 等工具",
    sourceType: "企业官网",
    sourceUrl: "https://join.qq.com/post_detail.html?postid=1234496944370743296",
    officialTarget: tencentOfficialTarget,
    activityState: { state: "known", value: "active" },
    lastVerifiedAt: "2026-07-17T13:20:34.753+08:00",
    reviewedAt,
  },
  {
    id: "G0-CAND-003",
    organizationSlug: "tencent",
    organizationName: "腾讯",
    title: "产品经理(技术背景)",
    family: { state: "known", value: "product" },
    cities: {
      state: "known",
      value: [
        { key: "shenzhen", label: "深圳总部" },
        { key: "shanghai", label: "上海" },
      ],
    },
    weeklyAttendanceDays: { state: "unknown", reason: officialPageNotSpecified },
    durationMonths: { state: "unknown", reason: officialPageNotSpecified },
    recruitmentBatch: { state: "known", value: "日常实习" },
    earliestStartDate: { state: "unknown", reason: officialPageNotSpecified },
    graduationYears: { state: "unknown", reason: officialPageNotSpecified },
    responsibilitiesExcerpt: "负责 toB/toG 产品策划和运营、行业合作、技术产品落地及业务体系建设",
    requirementsExcerpt: "计算机等相关专业；热爱技术与产品策划；沟通、执行和服务意识",
    sourceType: "企业官网",
    sourceUrl: "https://join.qq.com/post_detail.html?postid=1224696103971292160",
    officialTarget: tencentOfficialTarget,
    activityState: { state: "known", value: "active" },
    lastVerifiedAt: "2026-07-17T13:20:24.669+08:00",
    reviewedAt,
  },
  {
    id: "G0-CAND-004",
    organizationSlug: "tencent",
    organizationName: "腾讯",
    title: "产品运营",
    family: { state: "conflict", rawValues: ["product", "operations"] },
    cities: {
      state: "known",
      value: [
        { key: "shenzhen", label: "深圳总部" },
        { key: "beijing", label: "北京" },
        { key: "shanghai", label: "上海" },
        { key: "guangzhou", label: "广州" },
      ],
    },
    weeklyAttendanceDays: { state: "unknown", reason: officialPageNotSpecified },
    durationMonths: { state: "unknown", reason: officialPageNotSpecified },
    recruitmentBatch: { state: "known", value: "日常实习" },
    earliestStartDate: { state: "unknown", reason: officialPageNotSpecified },
    graduationYears: { state: "unknown", reason: officialPageNotSpecified },
    responsibilitiesExcerpt: "负责产品推广、平台运营、运营策略、数据体系以及推动产品和服务质量提升",
    requirementsExcerpt: "本科或以上学历；了解开发、测试、运营、设计；逻辑、创造、文字和沟通能力",
    sourceType: "企业官网",
    sourceUrl: "https://join.qq.com/post_detail.html?postid=1218257147532668928",
    officialTarget: tencentOfficialTarget,
    activityState: { state: "known", value: "active" },
    lastVerifiedAt: "2026-07-17T13:20:21.329+08:00",
    reviewedAt,
  },
  {
    id: "G0-CAND-005",
    organizationSlug: "tencent",
    organizationName: "腾讯",
    title: "产品策划",
    family: { state: "known", value: "product" },
    cities: {
      state: "known",
      value: [
        { key: "shenzhen", label: "深圳总部" },
        { key: "beijing", label: "北京" },
        { key: "shanghai", label: "上海" },
        { key: "guangzhou", label: "广州" },
      ],
    },
    weeklyAttendanceDays: { state: "unknown", reason: officialPageNotSpecified },
    durationMonths: { state: "unknown", reason: officialPageNotSpecified },
    recruitmentBatch: { state: "known", value: "日常实习" },
    earliestStartDate: { state: "unknown", reason: officialPageNotSpecified },
    graduationYears: { state: "unknown", reason: officialPageNotSpecified },
    responsibilitiesExcerpt: "负责产品规划、市场与需求分析、数据监控、研发协同和上线后迭代",
    requirementsExcerpt:
      "本科或以上学历；了解开发、测试、运营、设计；产品热情、洞察、逻辑和沟通能力",
    sourceType: "企业官网",
    sourceUrl: "https://join.qq.com/post_detail.html?postid=1212183855952704514",
    officialTarget: tencentOfficialTarget,
    activityState: { state: "known", value: "active" },
    lastVerifiedAt: "2026-07-17T13:20:16.217+08:00",
    reviewedAt,
  },
];

export async function loadApprovedResearchJobs(signal?: AbortSignal): Promise<ResearchJob[]> {
  if (signal?.aborted) {
    throw new DOMException("The research catalog request was aborted", "AbortError");
  }
  return approvedResearchJobs.filter(
    (job) => job.activityState.state === "known" && job.activityState.value === "active",
  );
}

export async function findApprovedResearchJob(
  id: string,
  signal?: AbortSignal,
): Promise<ResearchJob | null> {
  const jobs = await loadApprovedResearchJobs(signal);
  return jobs.find((job) => job.id === id) ?? null;
}
