import type { ApplicationCaseWithJobContext, FieldValue } from "@aijob/contracts";

export interface ApplicationCaseView {
  id: string;
  companyName: string;
  roleTitle: string;
  locationLabel: string;
  locationValues: string[];
  workModeLabel: string;
  deadlineAt: string | null;
  deadlineLabel: string;
  updatedAt: string;
  stage: ApplicationCaseWithJobContext["stage"];
  sourceLabel: string;
  sourceMeta: string;
  sourceKind: "catalog" | "owner_private";
  fixedVersionLabel: string;
  externalUrl: string | null;
  externalUrlVerified: boolean;
}

function displayField<T>(field: FieldValue<T>, format: (value: T) => string): string {
  if (field.state === "known") return format(field.value);
  if (field.state === "conflict") return `信息冲突：${field.rawValues.join(" / ")}`;
  return "未说明";
}

export function toApplicationCaseView(
  applicationCase: ApplicationCaseWithJobContext,
): ApplicationCaseView {
  const locations = applicationCase.jobDisplay.locations;
  const deadline = applicationCase.jobDisplay.deadlineAt;
  const source = applicationCase.jobDisplay.source;
  const sourceMeta =
    source.kind === "catalog"
      ? source.policyStatus === "pending_review"
        ? "仅限本地待复核，不代表已验证官方来源"
        : `最近核验 ${source.lastVerifiedAt.slice(0, 10)}`
      : source.sourceProvided
        ? "仅当前用户可见，平台未核验"
        : "仅当前用户可见，来源待用户核验";

  return {
    id: applicationCase.id,
    companyName: applicationCase.jobDisplay.companyName ?? "公司未说明",
    roleTitle: applicationCase.jobDisplay.title,
    locationLabel: displayField(locations, (value) => value.join("、")),
    locationValues: locations.state === "known" ? locations.value : [],
    workModeLabel: displayField(applicationCase.jobDisplay.workMode, String),
    deadlineAt: deadline.state === "known" ? deadline.value : null,
    deadlineLabel: displayField(deadline, (value) => value.slice(0, 10)),
    updatedAt: applicationCase.updatedAt,
    stage: applicationCase.stage,
    sourceLabel: source.displayName,
    sourceMeta,
    sourceKind: source.kind,
    fixedVersionLabel:
      applicationCase.jobContext.kind === "public"
        ? `岗位版本 ${applicationCase.jobContext.publishedJobVersionId}`
        : `私有快照 ${applicationCase.jobContext.snapshotId} · 内容修订 ${applicationCase.jobContext.contentRevision}`,
    externalUrl:
      applicationCase.jobContext.kind === "public"
        ? applicationCase.jobContext.officialUrl
        : (applicationCase.jobContext.officialUrl ?? null),
    externalUrlVerified: applicationCase.jobContext.kind === "public",
  };
}

export function compareCaseDeadline(left: ApplicationCaseView, right: ApplicationCaseView) {
  if (left.deadlineAt === null && right.deadlineAt === null) {
    return right.updatedAt.localeCompare(left.updatedAt);
  }
  if (left.deadlineAt === null) return 1;
  if (right.deadlineAt === null) return -1;
  return left.deadlineAt.localeCompare(right.deadlineAt) || left.id.localeCompare(right.id);
}
