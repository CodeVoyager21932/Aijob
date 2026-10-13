import { RecruitmentPlanResponseSchema } from "@aijob/contracts";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../api/client";
export function RecruitmentPlan({ jobId, caseId }: { jobId?: string; caseId?: string }) {
  const query = useQuery({
    queryKey: ["career-os", "recruitment-plan", caseId ?? jobId, Boolean(caseId)],
    queryFn: ({ signal }) =>
      apiRequest(
        caseId
          ? `/v1/application-cases/${caseId}/recruitment-plan`
          : `/v1/jobs/${jobId}/recruitment-plan`,
        { signal, responseSchema: RecruitmentPlanResponseSchema },
      ),
    enabled: Boolean(jobId || caseId),
    refetchInterval: caseId ? false : 60000,
  });
  if (query.isPending) return <output>正在读取招聘计划…</output>;
  if (query.isError)
    return (
      <p role="alert">
        招聘计划暂时不可用。
        <button type="button" onClick={() => void query.refetch()}>
          重试
        </button>
      </p>
    );
  const plan = query.data.plan;
  return (
    <section className="career-job-workspace__section">
      <h2>招聘计划</h2>
      <p>{query.data.notice}</p>
      {plan ? (
        <>
          <h3>{plan.title}</h3>
          <dl>
            <dt>招聘年份 / 批次</dt>
            <dd>
              {plan.recruitmentYear} / {plan.batch}
            </dd>
            <dt>毕业月份窗口</dt>
            <dd>
              {plan.graduationWindow
                ? `${plan.graduationWindow.from} 至 ${plan.graduationWindow.to}`
                : "未说明"}
            </dd>
            <dt>志愿规则</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{plan.volunteerRules?.value ?? "未说明"}</dd>
          </dl>
          <details>
            <summary>查看官方依据与核验时间</summary>
            <p>
              核验于 {new Date(plan.verifiedAt).toLocaleString("zh-CN")}，修订 {plan.revision}
            </p>
            <blockquote style={{ whiteSpace: "pre-wrap" }}>{plan.evidenceText}</blockquote>
            <a href={plan.evidenceUrl} target="_blank" rel="noopener noreferrer">
              打开官方原文
            </a>
          </details>
        </>
      ) : null}
    </section>
  );
}
