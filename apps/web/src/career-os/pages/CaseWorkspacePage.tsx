import type { ApplicationCaseWithJobContext } from "@aijob/contracts";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  careerOsQueryKeys,
  getApplicationCase,
  getApplicationCaseRequirements,
} from "../../api/career-os";
import { ProductApiError } from "../../api/client";
import { toApplicationCaseView } from "../application-case-view";
import { CaseHeader } from "../components/CaseHeader";
import { CaseTabs } from "../components/CaseTabs";
import { Icon } from "../components/Icon";
import { summarizeRequirementProgress } from "../requirements-view";
import { type CaseTab, caseStages, isCaseTab } from "../workspace-model";

const CaseRequirementsWorkspace = lazy(() =>
  import("./CaseRequirementsWorkspace").then((module) => ({
    default: module.CaseRequirementsWorkspace,
  })),
);
const CaseResumeWorkspace = lazy(() =>
  import("./CaseResumeWorkspace").then((module) => ({
    default: module.CaseResumeWorkspace,
  })),
);

type PlaceholderCaseTab = Exclude<CaseTab, "overview" | "requirements" | "resume">;

const phaseContent: Record<PlaceholderCaseTab, { title: string; copy: string }> = {
  application: {
    title: "投递记录不在 M1 范围内",
    copy: "打开外部页面与手动确认已投递仍是两个独立事件；当前版本不会根据链接点击改变阶段。",
  },
  interview: {
    title: "文字面试不在 M1 范围内",
    copy: "M1 只完成 Case、要求核对与派生简历只读闭环，不提前扩建面试领域。",
  },
  debrief: {
    title: "复盘不在 M1 范围内",
    copy: "复盘将在后续闭环中建设，当前不会自动形成或回写任何经历表达。",
  },
};

function CaseProgress({ stage }: { stage: ApplicationCaseWithJobContext["stage"] }) {
  const activeIndex = caseStages.findIndex((item) => item.value === stage);
  return (
    <ol className="career-case-progress" aria-label="求职项目阶段">
      {caseStages.map((item, index) => (
        <li
          key={item.value}
          className={
            index === activeIndex ? "is-current" : index < activeIndex ? "is-complete" : undefined
          }
          aria-current={index === activeIndex ? "step" : undefined}
        >
          <span>{index <= activeIndex ? <Icon name="check" size={16} /> : index + 1}</span>
          {item.label}
        </li>
      ))}
    </ol>
  );
}

function CaseOverview({ applicationCase }: { applicationCase: ApplicationCaseWithJobContext }) {
  const requirementsQuery = useQuery({
    queryKey: careerOsQueryKeys.requirements(applicationCase.id),
    queryFn: ({ signal }) => getApplicationCaseRequirements(applicationCase.id, signal),
  });
  const summary = requirementsQuery.data
    ? summarizeRequirementProgress(requirementsQuery.data)
    : null;

  return (
    <div className="career-case-overview">
      <section className="career-case-overview__next">
        <div>
          <h2>当前可执行步骤</h2>
          <strong>逐项核对固定 JD 要求</strong>
          <p>
            {summary
              ? `${summary.total} 项要求中，${summary.unconfirmed} 项仍未确认。`
              : "正在读取固定岗位要求…"}
          </p>
        </div>
        <Link
          className="career-button career-button--primary"
          to={`/applications/${applicationCase.id}/requirements`}
        >
          查看 JD 能力
          <Icon name="chevron" size={17} />
        </Link>
      </section>

      {requirementsQuery.isError ? (
        <div className="career-inline-error" role="alert">
          <strong>要求进度暂时无法读取</strong>
          <span>
            {requirementsQuery.error instanceof Error
              ? requirementsQuery.error.message
              : "请稍后重试。"}
          </span>
        </div>
      ) : (
        <section className="career-case-overview__axes" aria-labelledby="case-axes-heading">
          <header>
            <h2 id="case-axes-heading">分别核对，不合并成匹配等级</h2>
            <p>只展示已经保存的状态，不自动劝退。</p>
          </header>
          <div>
            <article>
              <span>要求状态</span>
              <strong>{summary ? `${summary.confirmed} 项已有证据` : "读取中"}</strong>
              <small>{summary ? `${summary.needsWork} 项证据待补充` : "等待要求数据"}</small>
            </article>
            <article>
              <span>经历证据</span>
              <strong>{summary ? `${summary.linkedEvidenceCount} 个关联` : "读取中"}</strong>
              <small>只关联用户已确认的证据</small>
            </article>
            <article>
              <span>偏好</span>
              <strong>尚未在当前工作区核对</strong>
              <small>M1 不使用静态偏好结论</small>
            </article>
          </div>
        </section>
      )}
    </div>
  );
}

function PhasePlaceholder({ tab }: { tab: PlaceholderCaseTab }) {
  const content = phaseContent[tab];
  return (
    <section className="career-case-phase-placeholder">
      <span>
        <Icon name={tab === "interview" ? "interview" : "briefcase"} />
      </span>
      <div>
        <p>M1 未开放</p>
        <h2>{content.title}</h2>
        <p>{content.copy}</p>
      </div>
    </section>
  );
}

function renderCaseTab(tab: CaseTab, applicationCase: ApplicationCaseWithJobContext): ReactNode {
  if (tab === "overview") return <CaseOverview applicationCase={applicationCase} />;
  if (tab === "requirements") {
    return (
      <Suspense fallback={<output className="career-request-state">正在打开要求工作区…</output>}>
        <CaseRequirementsWorkspace key={applicationCase.id} applicationCase={applicationCase} />
      </Suspense>
    );
  }
  if (tab === "resume") {
    return (
      <Suspense fallback={<output className="career-request-state">正在打开简历工作区…</output>}>
        <CaseResumeWorkspace key={applicationCase.id} applicationCase={applicationCase} />
      </Suspense>
    );
  }
  return <PhasePlaceholder tab={tab} />;
}

export function CaseWorkspacePage() {
  const { caseId = "", tab } = useParams();
  const applicationCaseQuery = useQuery({
    queryKey: careerOsQueryKeys.caseDetail(caseId),
    queryFn: ({ signal }) => getApplicationCase(caseId, signal),
    enabled: Boolean(caseId),
    retry: (failureCount, error) =>
      error instanceof ProductApiError && error.status === 404 ? false : failureCount < 1,
  });

  if (!isCaseTab(tab)) {
    return <Navigate to={`/applications/${encodeURIComponent(caseId)}/overview`} replace />;
  }
  if (applicationCaseQuery.isPending) {
    return <output className="career-request-state">正在读取真实求职项目…</output>;
  }
  if (applicationCaseQuery.isError) {
    const notFound =
      applicationCaseQuery.error instanceof ProductApiError &&
      applicationCaseQuery.error.status === 404;
    return (
      <section className="career-not-found">
        <h1>{notFound ? "没有找到这个求职项目" : "求职项目暂时不可用"}</h1>
        <p>
          {notFound
            ? "它可能不存在、已删除，或不属于当前用户。"
            : applicationCaseQuery.error instanceof Error
              ? applicationCaseQuery.error.message
              : "请稍后重试。"}
        </p>
        <Link to="/applications">返回我的求职</Link>
      </section>
    );
  }

  const applicationCase = applicationCaseQuery.data;
  const view = toApplicationCaseView(applicationCase);
  return (
    <section className="career-case-workspace">
      <CaseHeader applicationCase={view} />
      <CaseTabs caseId={applicationCase.id} />
      <CaseProgress stage={applicationCase.stage} />
      <div className="career-case-version-note" role="note">
        <Icon name="check" size={17} />
        {view.fixedVersionLabel}。外部页面更新不会静默替换当前 Case 的固定内容。
      </div>
      {renderCaseTab(tab, applicationCase)}
    </section>
  );
}
