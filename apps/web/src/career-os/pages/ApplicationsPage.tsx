import type {
  CreateApplicationCaseWithJobContextRequest,
  PrivateApplicationCaseDuplicateHandling,
  PrivateApplicationCaseSourceInput,
} from "@aijob/contracts";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  careerOsQueryKeys,
  createApplicationCase,
  listApplicationCases,
} from "../../api/career-os";
import { createIdempotencyKey } from "../../api/client";
import {
  compareCaseDeadline,
  type ApplicationCaseView,
  toApplicationCaseView,
} from "../application-case-view";
import {
  areSearchParamsEqual,
  canonicalizeApplicationsSearchParams,
  readApplicationsViewState,
  writeApplicationsViewState,
} from "../applications-state";
import { Icon } from "../components/Icon";
import { StageBadge } from "../components/StageBadge";
import { caseStages, getCaseStageLabel } from "../workspace-model";

interface CaseEntryProps {
  applicationCase: ApplicationCaseView;
  onOpen: () => void;
}

function CaseCard({ applicationCase, onOpen }: CaseEntryProps) {
  return (
    <article className="career-case-card">
      <button
        className="career-case-card__open"
        type="button"
        data-case-trigger={applicationCase.id}
        aria-label={`侧览 ${applicationCase.companyName} ${applicationCase.roleTitle}`}
        onClick={onOpen}
      >
        <strong>{applicationCase.companyName}</strong>
        <span>{applicationCase.roleTitle}</span>
        <small>
          {applicationCase.locationLabel} · {applicationCase.workModeLabel}
        </small>
        <small>截止 {applicationCase.deadlineLabel}</small>
      </button>
      <div className="career-case-card__source" title={applicationCase.sourceMeta}>
        <Icon name={applicationCase.sourceKind === "catalog" ? "check" : "document"} size={14} />
        {applicationCase.sourceLabel}
      </div>
      <Link to={`/applications/${applicationCase.id}/overview`}>
        打开工作区
        <Icon name="chevron" size={15} />
      </Link>
    </article>
  );
}

function CaseListRow({ applicationCase, onOpen }: CaseEntryProps) {
  return (
    <article className="career-case-row">
      <button
        className="career-case-row__open"
        type="button"
        data-case-trigger={applicationCase.id}
        aria-label={`侧览 ${applicationCase.companyName} ${applicationCase.roleTitle}`}
        onClick={onOpen}
      >
        <span className="career-case-row__identity">
          <strong>{applicationCase.companyName}</strong>
          <small>{applicationCase.roleTitle}</small>
        </span>
        <span>{applicationCase.locationLabel}</span>
        <StageBadge stage={applicationCase.stage} />
        <span className="career-case-row__task">{applicationCase.sourceLabel}</span>
        <Icon name="chevron" size={17} />
      </button>
    </article>
  );
}

interface PrivateJdDrawerProps {
  open: boolean;
  onClose: () => void;
}

function PrivateJdDrawer({ open, onClose }: PrivateJdDrawerProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [contentText, setContentText] = useState("");
  const [sourceKind, setSourceKind] =
    useState<PrivateApplicationCaseSourceInput["kind"]>("unspecified");
  const [sourceUrl, setSourceUrl] = useState("");
  const [duplicateHandling, setDuplicateHandling] =
    useState<PrivateApplicationCaseDuplicateHandling>("reuse");
  const commandRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => titleRef.current?.focus());
  }, [open]);

  const mutation = useMutation({
    mutationFn: ({
      request,
      idempotencyKey,
    }: {
      request: CreateApplicationCaseWithJobContextRequest;
      idempotencyKey: string;
    }) => createApplicationCase(request, idempotencyKey),
    retry: false,
    onSuccess: async ({ applicationCase }) => {
      await queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.cases });
      navigate(`/applications/${applicationCase.id}/requirements`);
    },
  });

  if (!open) return null;

  const submit = () => {
    const source: PrivateApplicationCaseSourceInput =
      sourceKind === "provided_url"
        ? { kind: "provided_url", url: sourceUrl.trim() }
        : sourceKind === "referral"
          ? { kind: "referral" }
          : { kind: "unspecified" };
    const request: CreateApplicationCaseWithJobContextRequest = {
      jobContext: {
        kind: "private_input",
        title: title.trim(),
        companyName: companyName.trim() || null,
        contentText,
        source,
        duplicateHandling,
      },
    };
    const signature = JSON.stringify(request);
    if (!commandRef.current || commandRef.current.signature !== signature) {
      commandRef.current = {
        signature,
        idempotencyKey: createIdempotencyKey("private-jd"),
      };
    }
    mutation.mutate({ request, idempotencyKey: commandRef.current.idempotencyKey });
  };

  return (
    <div className="career-drawer-layer">
      <button
        className="career-inspector-backdrop"
        type="button"
        aria-label="关闭私有 JD 导入"
        onClick={onClose}
      />
      <section
        className="career-private-jd-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="private-jd-title"
      >
        <header>
          <div>
            <p>仅加入你的求职工作区</p>
            <h2 id="private-jd-title">导入私有 JD</h2>
          </div>
          <button className="career-icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <form
          className="career-private-jd-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label>
            <span>岗位名称</span>
            <input
              ref={titleRef}
              required
              maxLength={240}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>公司名称（可不填）</span>
            <input
              maxLength={240}
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
            />
          </label>
          <label>
            <span>JD 原文</span>
            <textarea
              required
              maxLength={200_000}
              rows={12}
              value={contentText}
              onChange={(event) => setContentText(event.target.value)}
            />
            <small>{contentText.length.toLocaleString("zh-CN")} / 200,000 字符</small>
          </label>

          <fieldset>
            <legend>来源</legend>
            <label>
              <input
                type="radio"
                name="private-source"
                checked={sourceKind === "provided_url"}
                onChange={() => setSourceKind("provided_url")}
              />
              用户提供链接
            </label>
            <label>
              <input
                type="radio"
                name="private-source"
                checked={sourceKind === "referral"}
                onChange={() => setSourceKind("referral")}
              />
              内推转发
            </label>
            <label>
              <input
                type="radio"
                name="private-source"
                checked={sourceKind === "unspecified"}
                onChange={() => setSourceKind("unspecified")}
              />
              未提供
            </label>
          </fieldset>

          {sourceKind === "provided_url" ? (
            <label>
              <span>HTTPS 链接</span>
              <input
                required
                type="url"
                pattern="https://.*"
                placeholder="https://company.example/jobs/123"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
              />
              <small>平台会保留链接，但不会把它标记为已核验官方来源。</small>
            </label>
          ) : null}

          <fieldset>
            <legend>发现相同 JD 时</legend>
            <label>
              <input
                type="radio"
                name="duplicate-handling"
                checked={duplicateHandling === "reuse"}
                onChange={() => setDuplicateHandling("reuse")}
              />
              打开已有求职项目
            </label>
            <label>
              <input
                type="radio"
                name="duplicate-handling"
                checked={duplicateHandling === "create_separate"}
                onChange={() => setDuplicateHandling("create_separate")}
              />
              另建一份
            </label>
          </fieldset>

          <div className="career-private-jd-notice">
            <strong>隐私与保留</strong>
            <p>内容仅当前用户可见，不进入岗位目录、推荐或其他用户页面。</p>
            <p>结构化职业数据默认长期保存，你可以以后主动删除。</p>
          </div>

          {mutation.isError ? (
            <div className="career-inline-error" role="alert">
              <strong>暂时无法导入</strong>
              <span>
                {mutation.error instanceof Error ? mutation.error.message : "请稍后重试。"}
              </span>
            </div>
          ) : null}

          <footer>
            <button className="career-button career-button--quiet" type="button" onClick={onClose}>
              取消
            </button>
            <button
              className="career-button career-button--primary"
              type="submit"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "正在创建…" : mutation.isError ? "确认后重试" : "加入我的求职"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function ApplicationsPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [privateJdOpen, setPrivateJdOpen] = useState(false);
  const privateJdTriggerRef = useRef<HTMLButtonElement>(null);
  const viewState = readApplicationsViewState(searchParams);
  const casesQuery = useInfiniteQuery({
    queryKey: careerOsQueryKeys.caseList(),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listApplicationCases({ limit: 100, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  useEffect(() => {
    const canonical = canonicalizeApplicationsSearchParams(searchParams);
    if (!areSearchParamsEqual(searchParams, canonical)) {
      setSearchParams(canonical, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const loadedCases = useMemo(
    () => (casesQuery.data?.pages ?? []).flatMap((page) => page.items).map(toApplicationCaseView),
    [casesQuery.data?.pages],
  );
  const cityOptions = useMemo(
    () =>
      [...new Set(loadedCases.flatMap((applicationCase) => applicationCase.locationValues))].sort(),
    [loadedCases],
  );
  const filteredCases = useMemo(() => {
    const filtered = loadedCases.filter(
      (applicationCase) =>
        (viewState.stage === "all" || applicationCase.stage === viewState.stage) &&
        (viewState.city === "all" || applicationCase.locationValues.includes(viewState.city)),
    );
    return [...filtered].sort((left, right) =>
      viewState.sort === "deadline"
        ? compareCaseDeadline(left, right)
        : right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    );
  }, [loadedCases, viewState.city, viewState.sort, viewState.stage]);

  const updateViewState = (patch: Partial<typeof viewState>) => {
    setSearchParams(writeApplicationsViewState(searchParams, { ...viewState, ...patch }));
  };
  const openInspector = (caseId: string) => {
    const next = writeApplicationsViewState(searchParams, viewState);
    next.set("peek", caseId);
    setSearchParams(next);
  };
  const closePrivateJd = () => {
    setPrivateJdOpen(false);
    window.requestAnimationFrame(() => privateJdTriggerRef.current?.focus());
  };
  const visibleStages =
    viewState.stage === "all"
      ? caseStages
      : caseStages.filter((stage) => stage.value === viewState.stage);

  return (
    <section className="career-applications-page" aria-labelledby="applications-title">
      <header className="career-page-heading">
        <div>
          <h1 id="applications-title">我的求职</h1>
          <p>
            已加载 {loadedCases.length} 个真实求职项目
            {casesQuery.hasNextPage ? "，还有更多" : ""}
          </p>
        </div>
        <button
          ref={privateJdTriggerRef}
          className="career-button career-button--primary"
          type="button"
          onClick={() => setPrivateJdOpen(true)}
        >
          导入私有 JD
        </button>
      </header>

      {(location.state as { careerNotice?: string } | null)?.careerNotice ? (
        <output className="career-resume-assets__notice">
          <Icon name="check" size={18} />
          <span>{(location.state as { careerNotice: string }).careerNotice}</span>
        </output>
      ) : null}

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
            {viewState.city !== "all" && !cityOptions.includes(viewState.city) ? (
              <option value={viewState.city}>{viewState.city}</option>
            ) : null}
            {cityOptions.map((city) => (
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

      {casesQuery.isPending ? (
        <output className="career-request-state">正在读取求职项目…</output>
      ) : casesQuery.isError ? (
        <div className="career-request-state career-inline-error" role="alert">
          <strong>求职项目暂时无法读取</strong>
          <span>
            {casesQuery.error instanceof Error ? casesQuery.error.message : "请稍后重试。"}
          </span>
          <button type="button" onClick={() => void casesQuery.refetch()}>
            重新读取
          </button>
        </div>
      ) : loadedCases.length === 0 ? (
        <div className="career-empty-state career-empty-state--actions">
          <strong>还没有求职项目</strong>
          <p>从本地离线岗位开始，或导入一份只对你可见的 JD。</p>
          <div>
            <Link className="career-button career-button--quiet" to="/jobs">
              去岗位目录选择岗位
            </Link>
            <button
              ref={privateJdTriggerRef}
              className="career-button career-button--primary"
              type="button"
              onClick={() => setPrivateJdOpen(true)}
            >
              导入私有 JD
            </button>
          </div>
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="career-empty-state">
          <strong>当前筛选下没有求职项目</strong>
          <button type="button" onClick={() => updateViewState({ stage: "all", city: "all" })}>
            清除筛选
          </button>
        </div>
      ) : viewState.view === "board" ? (
        <section className="career-case-board" aria-label="求职项目看板">
          {visibleStages.map((stage) => {
            const stageCases = filteredCases.filter(
              (applicationCase) => applicationCase.stage === stage.value,
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
                    stageCases.map((applicationCase) => (
                      <CaseCard
                        key={applicationCase.id}
                        applicationCase={applicationCase}
                        onOpen={() => openInspector(applicationCase.id)}
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
            <span>来源</span>
            <span />
          </div>
          {filteredCases.map((applicationCase) => (
            <CaseListRow
              key={applicationCase.id}
              applicationCase={applicationCase}
              onOpen={() => openInspector(applicationCase.id)}
            />
          ))}
        </section>
      )}

      {casesQuery.hasNextPage ? (
        <div className="career-load-more">
          <button
            className="career-button career-button--quiet"
            type="button"
            disabled={casesQuery.isFetchingNextPage}
            onClick={() => void casesQuery.fetchNextPage()}
          >
            {casesQuery.isFetchingNextPage ? "正在加载…" : "继续加载"}
          </button>
        </div>
      ) : null}

      <PrivateJdDrawer open={privateJdOpen} onClose={closePrivateJd} />
    </section>
  );
}
