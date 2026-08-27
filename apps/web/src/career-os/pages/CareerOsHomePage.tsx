import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { careerOsQueryKeys, getApplicationBoard } from "../../api/career-os";
import { toApplicationCaseView } from "../application-case-view";
import { Icon } from "../components/Icon";
import { StageBadge } from "../components/StageBadge";
import { caseStages, type CaseStage } from "../workspace-model";

const activeStages = caseStages.filter((stage) => stage.value !== "resolved");

function todayAction(stage: CaseStage): { label: string; tab: string } {
  if (stage === "interested") return { label: "核对 JD 要求", tab: "requirements" };
  if (stage === "preparing") return { label: "完善岗位简历", tab: "resume" };
  if (stage === "applied") return { label: "准备模板面试", tab: "interview" };
  if (stage === "interviewing") return { label: "继续面试与复盘", tab: "interview" };
  return { label: "查看求职项目", tab: "overview" };
}

export function CareerOsHomePage() {
  const casesQuery = useQuery({
    queryKey: careerOsQueryKeys.applicationBoard({ sort: "updated" }),
    queryFn: ({ signal }) => getApplicationBoard({ sort: "updated", limitPerStage: 20 }, signal),
  });
  const activeColumns = (casesQuery.data?.columns ?? []).filter(
    (column) => column.stage !== "resolved",
  );
  const activeTotal = activeColumns.reduce((total, column) => total + column.total, 0);
  const activeCases = activeColumns
    .flatMap((column) => column.items)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 4)
    .map(toApplicationCaseView);

  return (
    <section className="career-home-page" aria-labelledby="today-title">
      <header className="career-page-heading career-page-heading--today">
        <div>
          <h1 id="today-title">今日</h1>
          <p>这里只展示真实求职项目，不生成站外提醒。</p>
        </div>
        <Link className="career-button career-button--primary" to="/applications">
          查看我的求职
          <Icon name="chevron" size={17} />
        </Link>
      </header>

      <section className="career-today-stage-summary" aria-label="进行中项目阶段摘要">
        {activeStages.map((stage) => {
          const count = activeColumns.find((column) => column.stage === stage.value)?.total ?? 0;
          return (
            <Link key={stage.value} to={`/applications?stage=${stage.value}`}>
              <span>{stage.label}</span>
              <strong>{count}</strong>
            </Link>
          );
        })}
      </section>

      <div className="career-today-layout">
        <section className="career-today-tasks" aria-labelledby="today-tasks-heading">
          <header>
            <h2 id="today-tasks-heading">进行中的求职项目</h2>
            <span>{activeTotal} 项进行中 · 显示最近 {activeCases.length} 项</span>
          </header>
          {casesQuery.isPending ? (
            <output className="career-request-state">正在读取真实 Case…</output>
          ) : casesQuery.isError ? (
            <div className="career-inline-error" role="alert">
              <strong>暂时无法读取求职项目</strong>
              <span>
                {casesQuery.error instanceof Error ? casesQuery.error.message : "请稍后重试。"}
              </span>
              <button type="button" onClick={() => void casesQuery.refetch()}>
                重新读取
              </button>
            </div>
          ) : activeCases.length === 0 ? (
            <div className="career-empty-state career-empty-state--compact">
              <strong>还没有进行中的求职项目</strong>
              <Link to="/applications">创建第一个求职项目</Link>
            </div>
          ) : (
            <ol>
              {activeCases.map((applicationCase) => {
                const action = todayAction(applicationCase.stage);
                return (
                  <li key={applicationCase.id}>
                  <Link to={`/applications/${applicationCase.id}/${action.tab}`}>
                    <span className="career-today-task__icon">
                      <Icon name="briefcase" />
                    </span>
                    <span>
                      <strong>{applicationCase.roleTitle}</strong>
                      <small>
                        {applicationCase.companyName} · {applicationCase.locationLabel}
                      </small>
                      <small className="career-today-task__action">{action.label}</small>
                    </span>
                    <StageBadge stage={applicationCase.stage} />
                    <Icon name="chevron" size={17} />
                  </Link>
                </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside className="career-today-note">
          <Icon name="check" />
          <h2>每一步都由你确认</h2>
          <p>打开外部页面不会自动标记为已投递；未说明的信息继续保持未知。</p>
          <Link to="/settings/data">查看数据保留与删除</Link>
        </aside>
      </div>
    </section>
  );
}
