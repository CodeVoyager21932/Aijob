import type {
  ApplicationCaseWithJobContext,
  CaseStage,
  CreateApplicationCaseWithJobContextRequest,
  PrivateApplicationCaseDuplicateHandling,
  PrivateApplicationCaseSourceInput,
} from "@aijob/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  careerOsQueryKeys,
  createApplicationCase,
  getApplicationBoard,
  listApplicationCases,
} from "../../api/career-os";
import { createIdempotencyKey } from "../../api/client";
import { type ApplicationCaseView, toApplicationCaseView } from "../application-case-view";
import {
  areSearchParamsEqual,
  canonicalizeApplicationsSearchParams,
  readApplicationsViewState,
  writeApplicationsViewState,
} from "../applications-state";
import { Icon } from "../components/Icon";
import { ModalSurface } from "../components/ModalSurface";
import { StageBadge } from "../components/StageBadge";
import { useMediaQuery } from "../use-media-query";
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
    <ModalSurface
      className="career-modal-surface--drawer"
      layerClassName="career-modal-layer--drawer"
      labelledBy="private-jd-title"
      describedBy="private-jd-description"
      initialFocusRef={titleRef}
      dismissible={!mutation.isPending}
      closeLabel="关闭私有 JD 导入"
      onClose={onClose}
    >
      <section className="career-private-jd-drawer">
        <header>
          <div>
            <p>仅加入你的求职工作区</p>
            <h2 id="private-jd-title">导入私有 JD</h2>
          </div>
          <button
            className="career-icon-button"
            type="button"
            aria-label="关闭"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <p className="sr-only" id="private-jd-description">
          将用户提供的岗位原文作为私有求职项目保存，不进入公共岗位目录。
        </p>
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
            <button
              className="career-button career-button--quiet"
              type="button"
              disabled={mutation.isPending}
              onClick={onClose}
            >
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
    </ModalSurface>
  );
}

export function ApplicationsPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [privateJdOpen, setPrivateJdOpen] = useState(false);
  const [cityDraft, setCityDraft] = useState("");
  const [boardAppend, setBoardAppend] = useState<
    Partial<
      Record<
        CaseStage,
        {
          identity: string;
          items: ApplicationCaseWithJobContext[];
          nextCursor: string | null;
          total: number;
          loading: boolean;
          error: string | null;
        }
      >
    >
  >({});
  const privateJdTriggerRef = useRef<HTMLButtonElement>(null);
  const viewState = readApplicationsViewState(searchParams);
  const mobileBoard = useMediaQuery("(max-width: 767px)");
  const cityFilter = viewState.city === "all" ? undefined : viewState.city;
  const boardQuery = useQuery({
    queryKey: careerOsQueryKeys.applicationBoard({
      ...(cityFilter ? { city: cityFilter } : {}),
      sort: viewState.sort,
    }),
    queryFn: ({ signal }) =>
      getApplicationBoard(
        {
          ...(cityFilter ? { city: cityFilter } : {}),
          sort: viewState.sort,
          limitPerStage: 20,
        },
        signal,
      ),
    enabled: viewState.view === "board",
  });
  const listQuery = useInfiniteQuery({
    queryKey: careerOsQueryKeys.caseList({
      stage: viewState.stage,
      city: viewState.city,
      sort: viewState.sort,
    }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listApplicationCases(
        {
          limit: 50,
          ...(viewState.stage !== "all" ? { stage: viewState.stage } : {}),
          ...(cityFilter ? { city: cityFilter } : {}),
          sort: viewState.sort,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: viewState.view === "list",
  });
  const boardIdentity = `${boardQuery.data?.generatedAt ?? "pending"}:${viewState.city}:${viewState.sort}`;
  const boardIdentityRef = useRef(boardIdentity);
  boardIdentityRef.current = boardIdentity;

  useEffect(() => {
    let canonical = canonicalizeApplicationsSearchParams(searchParams);
    const canonicalState = readApplicationsViewState(canonical);
    if (mobileBoard && canonicalState.view === "board" && canonicalState.stage === "all") {
      canonical = writeApplicationsViewState(canonical, {
        ...canonicalState,
        stage: caseStages[0].value,
      });
    }
    if (!areSearchParamsEqual(searchParams, canonical)) {
      setSearchParams(canonical, { replace: true });
    }
  }, [mobileBoard, searchParams, setSearchParams]);

  useEffect(() => {
    setCityDraft(viewState.city === "all" ? "" : viewState.city);
  }, [viewState.city]);

  const listCases = useMemo(
    () => (listQuery.data?.pages ?? []).flatMap((page) => page.items).map(toApplicationCaseView),
    [listQuery.data?.pages],
  );
  const boardColumns = useMemo(
    () =>
      (boardQuery.data?.columns ?? []).map((column) => {
        const append = boardAppend[column.stage];
        const activeAppend = append?.identity === boardIdentity ? append : undefined;
        const items = [...column.items, ...(activeAppend?.items ?? [])];
        return {
          ...column,
          items: [...new Map(items.map((item) => [item.id, item])).values()].map(
            toApplicationCaseView,
          ),
          total: activeAppend?.total ?? column.total,
          nextCursor: activeAppend?.nextCursor ?? column.nextCursor,
          loading: activeAppend?.loading ?? false,
          error: activeAppend?.error ?? null,
        };
      }),
    [boardAppend, boardIdentity, boardQuery.data?.columns],
  );
  const citySuggestions = useMemo(() => {
    const rawCases = [
      ...(boardQuery.data?.columns.flatMap((column) => column.items) ?? []),
      ...(listQuery.data?.pages.flatMap((page) => page.items) ?? []),
    ];
    return [
      ...new Set(
        rawCases.flatMap((applicationCase) =>
          applicationCase.jobDisplay.locations.state === "known"
            ? applicationCase.jobDisplay.locations.value
            : [],
        ),
      ),
    ].sort((left, right) => left.localeCompare(right, "zh-CN"));
  }, [boardQuery.data?.columns, listQuery.data?.pages]);

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
  };
  const loadBoardColumn = async (stage: CaseStage) => {
    const column = boardColumns.find((item) => item.stage === stage);
    if (!column?.nextCursor || column.loading) return;
    const identity = boardIdentity;
    const existing = boardAppend[stage]?.identity === identity ? boardAppend[stage] : undefined;
    setBoardAppend((current) => ({
      ...current,
      [stage]: {
        identity,
        items: existing?.items ?? [],
        nextCursor: column.nextCursor,
        total: existing?.total ?? column.total,
        loading: true,
        error: null,
      },
    }));
    try {
      const page = await listApplicationCases({
        stage,
        limit: 20,
        ...(cityFilter ? { city: cityFilter } : {}),
        sort: viewState.sort,
        cursor: column.nextCursor,
      });
      if (boardIdentityRef.current !== identity) return;
      setBoardAppend((current) => {
        const latest = current[stage];
        const previousItems = latest?.identity === identity ? latest.items : [];
        return {
          ...current,
          [stage]: {
            identity,
            items: [...previousItems, ...page.items],
            nextCursor: page.nextCursor,
            total: page.total,
            loading: false,
            error: null,
          },
        };
      });
    } catch (error) {
      if (boardIdentityRef.current !== identity) return;
      setBoardAppend((current) => {
        const latest = current[stage];
        return {
          ...current,
          [stage]: {
            identity,
            items: latest?.identity === identity ? latest.items : [],
            nextCursor: column.nextCursor,
            total: latest?.identity === identity ? latest.total : column.total,
            loading: false,
            error: error instanceof Error ? error.message : "该列暂时无法继续读取。",
          },
        };
      });
    }
  };
  const effectiveBoardStage =
    mobileBoard && viewState.stage === "all" ? caseStages[0].value : viewState.stage;
  const visibleStages =
    effectiveBoardStage === "all"
      ? caseStages
      : caseStages.filter((stage) => stage.value === effectiveBoardStage);
  const visibleBoardColumns = visibleStages
    .map((stage) => boardColumns.find((column) => column.stage === stage.value))
    .filter((column): column is (typeof boardColumns)[number] => Boolean(column));
  const visibleBoardTotal = visibleBoardColumns.reduce((sum, column) => sum + column.total, 0);
  const collectionTotal =
    viewState.view === "board"
      ? visibleBoardTotal
      : (listQuery.data?.pages[0]?.total ?? listCases.length);
  const activeQuery = viewState.view === "board" ? boardQuery : listQuery;
  const collectionEmpty = !activeQuery.isPending && !activeQuery.isError && collectionTotal === 0;

  return (
    <section className="career-applications-page" aria-labelledby="applications-title">
      <header className="career-page-heading">
        <div>
          <h1 id="applications-title">我的求职</h1>
          <p aria-live="polite">当前筛选共 {collectionTotal} 个求职项目</p>
        </div>
        <button
          ref={privateJdTriggerRef}
          data-private-jd-trigger
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

        <label className="career-view-toolbar__stage">
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

        <form
          className="career-city-filter"
          onSubmit={(event) => {
            event.preventDefault();
            updateViewState({ city: cityDraft.trim() || "all" });
          }}
        >
          <label>
            <span>城市</span>
            <input
              type="search"
              list="career-application-city-options"
              maxLength={120}
              placeholder="全部城市"
              value={cityDraft}
              onChange={(event) => setCityDraft(event.target.value)}
            />
          </label>
          <datalist id="career-application-city-options">
            {citySuggestions.map((city) => (
              <option key={city} value={city} />
            ))}
          </datalist>
          <button
            className="career-icon-button"
            type="submit"
            aria-label="应用城市筛选"
            title="应用城市筛选"
          >
            <Icon name="search" size={17} />
          </button>
          {viewState.city !== "all" ? (
            <button
              className="career-icon-button"
              type="button"
              aria-label="清除城市筛选"
              title="清除城市筛选"
              onClick={() => updateViewState({ city: "all" })}
            >
              <Icon name="close" size={16} />
            </button>
          ) : null}
        </form>

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

      {viewState.view === "board" ? (
        <fieldset className="career-mobile-stage-control">
          <legend>看板阶段</legend>
          {caseStages.map((stage) => {
            const count = boardColumns.find((column) => column.stage === stage.value)?.total ?? 0;
            return (
              <button
                key={stage.value}
                type="button"
                className={effectiveBoardStage === stage.value ? "is-active" : undefined}
                aria-pressed={effectiveBoardStage === stage.value}
                onClick={() => updateViewState({ stage: stage.value })}
              >
                {stage.label}
                <span>{count}</span>
              </button>
            );
          })}
        </fieldset>
      ) : null}

      {activeQuery.isPending ? (
        <output className="career-request-state">正在读取求职项目…</output>
      ) : activeQuery.isError ? (
        <div className="career-request-state career-inline-error" role="alert">
          <strong>求职项目暂时无法读取</strong>
          <span>
            {activeQuery.error instanceof Error ? activeQuery.error.message : "请稍后重试。"}
          </span>
          <button type="button" onClick={() => void activeQuery.refetch()}>
            重新读取
          </button>
        </div>
      ) : collectionEmpty && viewState.stage === "all" && viewState.city === "all" ? (
        <div className="career-empty-state career-empty-state--actions">
          <strong>还没有求职项目</strong>
          <p>从本地离线岗位开始，或导入一份只对你可见的 JD。</p>
          <div>
            <Link className="career-button career-button--quiet" to="/jobs">
              去岗位目录选择岗位
            </Link>
            <button
              ref={privateJdTriggerRef}
              data-private-jd-trigger
              className="career-button career-button--primary"
              type="button"
              onClick={() => setPrivateJdOpen(true)}
            >
              导入私有 JD
            </button>
          </div>
        </div>
      ) : collectionEmpty ? (
        <div className="career-empty-state">
          <strong>当前筛选下没有求职项目</strong>
          <button type="button" onClick={() => updateViewState({ stage: "all", city: "all" })}>
            清除筛选
          </button>
        </div>
      ) : viewState.view === "board" ? (
        <section className="career-case-board" aria-label="求职项目看板">
          {visibleBoardColumns.map((column) => (
            <section
              key={column.stage}
              className={`career-case-column career-case-column--${column.stage}`}
            >
              <header>
                <h2>{getCaseStageLabel(column.stage)}</h2>
                <span title={`${column.total} 个项目`}>{column.total}</span>
              </header>
              <div className="career-case-column__items">
                {column.items.length > 0 ? (
                  column.items.map((applicationCase) => (
                    <CaseCard
                      key={applicationCase.id}
                      applicationCase={applicationCase}
                      onOpen={() => openInspector(applicationCase.id)}
                    />
                  ))
                ) : (
                  <p>暂无{getCaseStageLabel(column.stage)}项目</p>
                )}
              </div>
              {column.error ? (
                <div className="career-case-column__error" role="alert">
                  <span>{column.error}</span>
                  <button type="button" onClick={() => void loadBoardColumn(column.stage)}>
                    重试
                  </button>
                </div>
              ) : null}
              {column.nextCursor ? (
                <button
                  className="career-case-column__more"
                  type="button"
                  disabled={column.loading}
                  onClick={() => void loadBoardColumn(column.stage)}
                >
                  {column.loading
                    ? "正在加载…"
                    : `继续加载（已显示 ${column.items.length}/${column.total}）`}
                </button>
              ) : null}
            </section>
          ))}
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
          {listCases.map((applicationCase) => (
            <CaseListRow
              key={applicationCase.id}
              applicationCase={applicationCase}
              onOpen={() => openInspector(applicationCase.id)}
            />
          ))}
        </section>
      )}

      {viewState.view === "list" && listQuery.hasNextPage ? (
        <div className="career-load-more">
          <button
            className="career-button career-button--quiet"
            type="button"
            disabled={listQuery.isFetchingNextPage}
            onClick={() => void listQuery.fetchNextPage()}
          >
            {listQuery.isFetchingNextPage
              ? "正在加载…"
              : `继续加载（已显示 ${listCases.length}/${collectionTotal}）`}
          </button>
        </div>
      ) : null}

      <PrivateJdDrawer open={privateJdOpen} onClose={closePrivateJd} />
    </section>
  );
}
