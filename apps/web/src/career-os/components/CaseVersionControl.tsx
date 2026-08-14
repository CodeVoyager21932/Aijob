import type {
  ApplicationCaseJobVersionDiffResponse,
  ApplicationCaseWithJobContext,
  JobVersionDiffField,
} from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  careerOsQueryKeys,
  getApplicationCaseJobVersionDiff,
  upgradeApplicationCaseJobVersion,
} from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import { shortVersionId } from "../case-match-view";
import { Icon } from "./Icon";
import { ModalSurface } from "./ModalSurface";

const fieldLabels: Record<JobVersionDiffField, string> = {
  companyName: "公司名称",
  title: "岗位名称",
  jobFamily: "岗位职能",
  locations: "工作地点",
  department: "部门",
  jobCode: "岗位编号",
  recruitmentType: "招聘类型",
  employmentType: "用工类型",
  recruitmentBatch: "招聘批次",
  weeklyAttendanceDays: "每周出勤",
  durationMonths: "实习时长",
  earliestStartDate: "最早到岗",
  graduationYears: "毕业年份",
  educationLevels: "学历",
  majors: "专业",
  languages: "语言",
  salary: "薪资",
  workMode: "工作方式",
  postedAt: "发布日期",
  deadlineAt: "截止日期",
  responsibilities: "岗位职责",
  requirements: "岗位要求原文",
  structuredFields: "结构化字段",
  activityState: "岗位状态",
  sourceUrl: "来源页面",
  applyUrl: "投递页面",
};

function countVersionChanges(diff: ApplicationCaseJobVersionDiffResponse): number {
  return (
    diff.fieldChanges.length +
    diff.requirementChanges.added.length +
    diff.requirementChanges.removed.length +
    diff.requirementChanges.changed.length
  );
}

function ChangeText({ value }: { value: string | null }) {
  return <p>{value ?? "未说明"}</p>;
}

export function CaseVersionControl({
  applicationCase,
}: {
  applicationCase: ApplicationCaseWithJobContext;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const commandRef = useRef<{ signature: string; key: string } | null>(null);
  const isPublic = applicationCase.jobContext.kind === "public";
  const diffQuery = useQuery({
    queryKey: careerOsQueryKeys.caseJobVersionDiff(applicationCase.id),
    queryFn: ({ signal }) => getApplicationCaseJobVersionDiff(applicationCase.id, signal),
    enabled: isPublic,
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
  });
  const upgradeMutation = useMutation({
    mutationFn: ({
      targetVersionId,
      idempotencyKey,
    }: {
      targetVersionId: string;
      idempotencyKey: string;
    }) =>
      upgradeApplicationCaseJobVersion(
        applicationCase.id,
        {
          expectedRevision: applicationCase.revision,
          targetPublishedJobVersionId: targetVersionId,
        },
        idempotencyKey,
      ),
    retry: false,
    onSuccess: async () => {
      setDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.requirements(applicationCase.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseMatchState(applicationCase.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseJobVersionDiff(applicationCase.id),
        }),
        queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.caseList() }),
      ]);
    },
    onError: (error) => {
      if (
        error instanceof ProductApiError &&
        ["APPLICATION_CASE_REVISION_CONFLICT", "PUBLIC_JOB_CONTEXT_UNAVAILABLE"].includes(
          error.code ?? "",
        )
      ) {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
          }),
          queryClient.invalidateQueries({
            queryKey: careerOsQueryKeys.caseJobVersionDiff(applicationCase.id),
          }),
        ]);
      }
    },
  });

  if (applicationCase.jobContext.kind === "private") {
    return (
      <div className="career-case-version-control is-private" role="note">
        <span>
          <Icon name="document" size={18} />
        </span>
        <div>
          <strong>私有 JD 内容修订 {applicationCase.jobContext.contentRevision}</strong>
          <p>只使用当前 Case 固定的私有快照，不与公共岗位目录合并。</p>
        </div>
      </div>
    );
  }

  const fixedVersion = shortVersionId(applicationCase.jobContext.publishedJobVersionId);
  if (diffQuery.isPending) {
    return (
      <output className="career-case-version-control">
        <span>
          <Icon name="question" size={18} />
        </span>
        <div>
          <strong>固定版本 {fixedVersion}</strong>
          <p>正在核对目录版本状态…</p>
        </div>
      </output>
    );
  }
  if (diffQuery.isError) {
    return (
      <div className="career-case-version-control is-warning" role="alert">
        <span>
          <Icon name="warning" size={18} />
        </span>
        <div>
          <strong>固定版本 {fixedVersion}</strong>
          <p>目录版本状态暂时无法读取，当前 Case 内容没有被替换。</p>
        </div>
        <button type="button" onClick={() => void diffQuery.refetch()}>
          重试
        </button>
      </div>
    );
  }

  const diff = diffQuery.data;
  const targetVersionId = diff.targetPublishedJobVersionId;
  const changeCount = countVersionChanges(diff);
  const submitUpgrade = () => {
    if (!targetVersionId) return;
    const signature = `${applicationCase.id}:${applicationCase.revision}:${targetVersionId}`;
    if (!commandRef.current || commandRef.current.signature !== signature) {
      commandRef.current = { signature, key: createIdempotencyKey("case-version-upgrade") };
    }
    upgradeMutation.mutate({
      targetVersionId,
      idempotencyKey: commandRef.current.key,
    });
  };

  return (
    <>
      <div
        className={`career-case-version-control is-${diff.status}`}
        role={diff.status === "update_available" ? "alert" : "note"}
      >
        <span>
          <Icon name={diff.status === "up_to_date" ? "check" : "warning"} size={18} />
        </span>
        <div>
          <strong>
            {diff.status === "up_to_date"
              ? `固定版本 ${fixedVersion} 与目录一致`
              : diff.status === "update_available"
                ? `目录有新版本，当前仍固定在 ${fixedVersion}`
                : `固定版本 ${fixedVersion} 暂无可升级目标`}
          </strong>
          <p>
            {diff.status === "up_to_date"
              ? "刷新页面仍使用同一岗位版本和要求集。"
              : diff.status === "update_available"
                ? `${changeCount} 处可追溯变化；只有确认后才会升级 Case。`
                : "目录状态变化不会静默替换当前 Case 内容。"}
          </p>
        </div>
        {diff.status === "update_available" ? (
          <button
            ref={openButtonRef}
            className="career-button career-button--quiet"
            type="button"
            onClick={() => setDialogOpen(true)}
          >
            查看变化
          </button>
        ) : null}
      </div>

      {dialogOpen && targetVersionId ? (
        <ModalSurface
          className="career-version-dialog"
          layerClassName="career-modal-layer--version"
          labelledBy="career-version-dialog-title"
          describedBy="career-version-dialog-description"
          initialFocusRef={closeButtonRef}
          returnFocus={() => openButtonRef.current}
          dismissible={!upgradeMutation.isPending}
          closeLabel="关闭岗位版本差异"
          onClose={() => {
            if (!upgradeMutation.isPending) setDialogOpen(false);
          }}
        >
          <header>
            <div>
              <p>岗位版本变化</p>
              <h2 id="career-version-dialog-title">确认是否升级当前 Case</h2>
              <span id="career-version-dialog-description">
                {shortVersionId(diff.pinnedPublishedJobVersionId)} →{" "}
                {shortVersionId(targetVersionId)}
              </span>
            </div>
            <button
              ref={closeButtonRef}
              className="career-icon-button"
              type="button"
              aria-label="关闭岗位版本差异"
              disabled={upgradeMutation.isPending}
              onClick={() => setDialogOpen(false)}
            >
              <Icon name="close" size={19} />
            </button>
          </header>

          <div className="career-version-dialog__body">
            {diff.fieldChanges.length > 0 ? (
              <section>
                <h3>岗位字段</h3>
                <div className="career-version-diff-list">
                  {diff.fieldChanges.map((change) => (
                    <article key={change.field}>
                      <strong>{fieldLabels[change.field]}</strong>
                      <div>
                        <span>当前固定</span>
                        <ChangeText value={change.fromValue} />
                      </div>
                      <div>
                        <span>目录新版本</span>
                        <ChangeText value={change.toValue} />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h3>要求变化</h3>
              <div className="career-version-requirements">
                {diff.requirementChanges.added.map((item) => (
                  <p className="is-added" key={`added-${item.id}`}>
                    <span>新增</span>
                    {item.sourceText}
                  </p>
                ))}
                {diff.requirementChanges.removed.map((item) => (
                  <p className="is-removed" key={`removed-${item.id}`}>
                    <span>移除</span>
                    {item.sourceText}
                  </p>
                ))}
                {diff.requirementChanges.changed.map((item) => (
                  <article key={`changed-${item.from.id}-${item.to.id}`}>
                    <span>修改</span>
                    <p>{item.from.sourceText}</p>
                    <Icon name="chevron" size={16} />
                    <p>{item.to.sourceText}</p>
                  </article>
                ))}
                {diff.requirementChanges.added.length === 0 &&
                diff.requirementChanges.removed.length === 0 &&
                diff.requirementChanges.changed.length === 0 ? (
                  <p className="is-empty">要求拆解没有语义变化。</p>
                ) : null}
              </div>
            </section>

            {upgradeMutation.isError ? (
              <div className="career-revision-conflict" role="alert">
                <strong>版本升级没有完成</strong>
                <p>{upgradeMutation.error.message} 当前固定版本仍然保留。</p>
              </div>
            ) : null}
          </div>

          <footer>
            <button
              className="career-button career-button--quiet"
              type="button"
              disabled={upgradeMutation.isPending}
              onClick={() => setDialogOpen(false)}
            >
              继续使用当前版本
            </button>
            <button
              className="career-button career-button--primary"
              type="button"
              disabled={upgradeMutation.isPending}
              onClick={submitUpgrade}
            >
              {upgradeMutation.isPending ? "正在升级…" : "确认升级 Case"}
            </button>
          </footer>
        </ModalSurface>
      ) : null}
    </>
  );
}
