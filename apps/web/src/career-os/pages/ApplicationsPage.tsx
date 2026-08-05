import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  areSearchParamsEqual,
  canonicalizeApplicationsSearchParams,
  readApplicationsViewState,
  writeApplicationsViewState,
} from "../applications-state";
import { Icon } from "../components/Icon";
import { StageBadge } from "../components/StageBadge";
import {
  type CareerCase,
  careerCases,
  caseStages,
  getCareerCase,
  getCaseStageLabel,
} from "../domain";

const cityOptions = ["all", ...new Set(careerCases.map((careerCase) => careerCase.location))];

function formatDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${month}-${day}`;
}

function CaseCard({ careerCase, onOpen }: { careerCase: CareerCase; onOpen: () => void }) {
  return (
    <article className="career-case-card">
      <button
        className="career-case-card__open"
        type="button"
        data-case-trigger={careerCase.id}
        aria-label={`侧览 ${careerCase.companyName} ${careerCase.roleTitle}`}
        onClick={onOpen}
      >
        <strong>{careerCase.companyName}</strong>
        <span>{careerCase.roleTitle}</span>
        <small>
          {careerCase.location} · {careerCase.workMode}
        </small>
        <small>截止 {formatDate(careerCase.deadline)}</small>
      </button>
      <div className="career-case-card__source">
        <Icon name="check" size={14} />
        {careerCase.sourceLabel.replace(" · 静态演示", "")}
      </div>
      <Link to={`/applications/${careerCase.id}/overview`}>
        下一步：{careerCase.nextTask}
        <Icon name="chevron" size={15} />
      </Link>
    </article>
  );
}

function CaseListRow({ careerCase, onOpen }: { careerCase: CareerCase; onOpen: () => void }) {
  return (
    <article className="career-case-row">
      <button
        className="career-case-row__open"
        type="button"
        data-case-trigger={careerCase.id}
        onClick={onOpen}
      >
        <span className="career-case-row__identity">
          <strong>{careerCase.companyName}</strong>
          <small>{careerCase.roleTitle}</small>
        </span>
        <span>{careerCase.location}</span>
        <StageBadge stage={careerCase.stage} />
        <span className="career-case-row__task">{careerCase.nextTask}</span>
        <Icon name="chevron" size={17} />
      </button>
    </article>
  );
}

export function ApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const viewState = readApplicationsViewState(searchParams);

  useEffect(() => {
    const canonical = canonicalizeApplicationsSearchParams(searchParams);
    const invalidPeek =
      searchParams.get("peek") && !getCareerCase(searchParams.get("peek") ?? undefined);
    if (invalidPeek) canonical.delete("peek");
    if (!areSearchParamsEqual(searchParams, canonical)) {
      setSearchParams(canonical, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const filteredCases = useMemo(() => {
    const filtered = careerCases.filter(
      (careerCase) =>
        (viewState.stage === "all" || careerCase.stage === viewState.stage) &&
        (viewState.city === "all" || careerCase.location === viewState.city),
    );
    return [...filtered].sort((left, right) =>
      viewState.sort === "deadline"
        ? left.deadline.localeCompare(right.deadline)
        : right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [viewState.city, viewState.sort, viewState.stage]);

  const updateViewState = (patch: Partial<typeof viewState>) => {
    setSearchParams(writeApplicationsViewState(searchParams, { ...viewState, ...patch }));
  };

  const openInspector = (caseId: string) => {
    const next = writeApplicationsViewState(searchParams, viewState);
    next.set("peek", caseId);
    setSearchParams(next);
  };

  const visibleStages =
    viewState.stage === "all"
      ? caseStages
      : caseStages.filter((stage) => stage.value === viewState.stage);

  return (
    <section className="career-applications-page" aria-labelledby="applications-title">
      <header className="career-page-heading">
        <h1 id="applications-title">我的求职</h1>
        <span>{filteredCases.length} 个静态求职项目</span>
      </header>

      <div className="career-view-toolbar" aria-label="求职项目视图工具栏" role="toolbar">
        <fieldset className="career-view-switcher">
          <legend>视图</legend>
          <button
            type="button"
            className={viewState.view === "list" ? "is-active" : undefined}
            aria-pressed={viewState.view === "list"}
            onClick={() => updateViewState({ view: "list" })}
          >
            <Icon name="list" size={17} />
            列表
          </button>
          <button
            type="button"
            className={viewState.view === "board" ? "is-active" : undefined}
            aria-pressed={viewState.view === "board"}
            onClick={() => updateViewState({ view: "board" })}
          >
            <Icon name="board" size={17} />
            看板
          </button>
        </fieldset>

        <label>
          <span>阶段</span>
          <select
            value={viewState.stage}
            onChange={(event) =>
              updateViewState({ stage: event.target.value as typeof viewState.stage })
            }
          >
            <option value="all">全部阶段</option>
            {caseStages.map((stage) => (
              <option key={stage.value} value={stage.value}>
                {stage.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>城市</span>
          <select
            value={viewState.city}
            onChange={(event) => updateViewState({ city: event.target.value })}
          >
            <option value="all">全部城市</option>
            {cityOptions.slice(1).map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>

        <label className="career-view-toolbar__sort">
          <span>排序</span>
          <select
            value={viewState.sort}
            onChange={(event) =>
              updateViewState({ sort: event.target.value as typeof viewState.sort })
            }
          >
            <option value="updated">按更新排序</option>
            <option value="deadline">按截止时间</option>
          </select>
        </label>
      </div>

      {filteredCases.length === 0 ? (
        <div className="career-empty-state">
          <strong>当前筛选下没有求职项目</strong>
          <button
            type="button"
            onClick={() =>
              updateViewState({
                stage: "all",
                city: "all",
              })
            }
          >
            清除筛选
          </button>
        </div>
      ) : viewState.view === "board" ? (
        <section className="career-case-board" aria-label="求职项目看板">
          {visibleStages.map((stage) => {
            const stageCases = filteredCases.filter(
              (careerCase) => careerCase.stage === stage.value,
            );
            return (
              <section
                key={stage.value}
                className={`career-case-column career-case-column--${stage.value}`}
              >
                <header>
                  <h2>{stage.label}</h2>
                  <span>{stageCases.length}</span>
                </header>
                <div className="career-case-column__items">
                  {stageCases.length > 0 ? (
                    stageCases.map((careerCase) => (
                      <CaseCard
                        key={careerCase.id}
                        careerCase={careerCase}
                        onOpen={() => openInspector(careerCase.id)}
                      />
                    ))
                  ) : (
                    <p>暂无{getCaseStageLabel(stage.value)}项目</p>
                  )}
                </div>
              </section>
            );
          })}
        </section>
      ) : (
        <section className="career-case-list" aria-label="求职项目列表">
          <div className="career-case-list__header" aria-hidden="true">
            <span>公司与岗位</span>
            <span>城市</span>
            <span>阶段</span>
            <span>下一步</span>
            <span />
          </div>
          {filteredCases.map((careerCase) => (
            <CaseListRow
              key={careerCase.id}
              careerCase={careerCase}
              onOpen={() => openInspector(careerCase.id)}
            />
          ))}
        </section>
      )}
    </section>
  );
}
