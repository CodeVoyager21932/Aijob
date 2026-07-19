import { useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { ResearchJobRow } from "./ResearchJobRow";
import { loadApprovedResearchJobs } from "./researchJobs";
import {
  countAppliedResearchFilters,
  emptyResearchFilters,
  parseResearchFilters,
  researchAvailableDaysOptions,
  researchAvailableMonthsOptions,
  searchResearchJobs,
  serializeResearchFilters,
} from "./search";
import type {
  ResearchFacetOption,
  ResearchFamily,
  ResearchFilters,
  ResearchJob,
  ResearchSearchResult,
  ResearchSourceType,
  ResearchUnknownDimension,
} from "./types";

const familyOptions: ResearchFacetOption[] = [
  { key: "product", label: "产品", count: 0 },
  { key: "operations", label: "运营", count: 0 },
];
const loadingRows = ["loading-one", "loading-two", "loading-three", "loading-four", "loading-five"];

type ArrayFilterKey =
  | "cities"
  | "companies"
  | "families"
  | "recruitmentBatches"
  | "arrivalRequirements"
  | "graduationYears"
  | "sourceTypes";

interface ListNavigationState {
  scrollY?: unknown;
  originJobId?: unknown;
}

export function ResearchJobListPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseResearchFilters(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileFilterDraft, setMobileFilterDraft] = useState<ResearchFilters>(filters);
  const mobileFilterToggleRef = useRef<HTMLButtonElement>(null);
  const mobileFilterPanelRef = useRef<HTMLElement>(null);
  const mobileFilterCloseRef = useRef<HTMLButtonElement>(null);
  const restoredNavigationStateRef = useRef<unknown>(null);
  const query = useQuery({
    queryKey: ["research", "approved-jobs"],
    queryFn: ({ signal }) => loadApprovedResearchJobs(signal),
  });

  useEffect(() => {
    setSearchDraft(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (!mobileFiltersOpen) setMobileFilterDraft(filters);
  }, [filters, mobileFiltersOpen]);

  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = mobileFilterPanelRef.current;
    const main = panel?.closest("main");
    const app = panel?.closest(".research-app");
    const searchRegion = panel?.closest(".research-search");
    const inertTargets = [
      ...Array.from(app?.children ?? []).filter((element) => element !== main),
      ...Array.from(main?.children ?? []).filter((element) => !element.contains(panel)),
      ...Array.from(searchRegion?.children ?? []).filter((element) => element !== panel),
    ].filter((element): element is HTMLElement => element instanceof HTMLElement);
    const previousInert = inertTargets.map((element) => ({ element, inert: element.inert }));
    for (const { element } of previousInert) element.inert = true;
    const focusFrame = window.requestAnimationFrame(() => mobileFilterCloseRef.current?.focus());
    const handleDialogKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileFiltersOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = mobileFilterPanelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [href]",
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeyboard);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleDialogKeyboard);
      document.body.style.overflow = previousOverflow;
      for (const { element, inert } of previousInert) element.inert = inert;
      const toggle = mobileFilterToggleRef.current;
      if (toggle && toggle.getClientRects().length > 0) toggle.focus();
    };
  }, [mobileFiltersOpen]);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 720px)");
    const closeDrawerOutsideMobile = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileFiltersOpen(false);
    };
    mobileViewport.addEventListener("change", closeDrawerOutsideMobile);
    return () => mobileViewport.removeEventListener("change", closeDrawerOutsideMobile);
  }, []);

  const jobs = query.data ?? [];
  const result = useMemo(() => searchResearchJobs(jobs, filters), [filters, jobs]);
  const panelFilters = mobileFiltersOpen ? mobileFilterDraft : filters;
  const panelResult = useMemo(() => searchResearchJobs(jobs, panelFilters), [jobs, panelFilters]);
  const catalogResult = useMemo(() => searchResearchJobs(jobs, emptyResearchFilters), [jobs]);
  const appliedCount = countAppliedResearchFilters(filters);
  const panelAppliedCount = countAppliedResearchFilters(panelFilters);
  const families = familyOptions.map((option) => ({
    ...option,
    count:
      panelResult.facets.families.find((candidate) => candidate.key === option.key)?.count ?? 0,
  }));
  const coverage = hardConditionCoverage(jobs);
  const scopeSummary = researchScopeSummary(jobs, catalogResult.facets);
  const uncertainRecovery = zeroResultRecovery(filters, result);
  const mobileDialogProps = mobileFiltersOpen
    ? ({
        role: "dialog",
        "aria-modal": true,
        "aria-labelledby": "research-mobile-filter-title",
      } as const)
    : {};

  useEffect(() => {
    if (!query.isSuccess) return;
    const state = location.state as ListNavigationState | null;
    const scrollY = state?.scrollY;
    const originJobId = typeof state?.originJobId === "string" ? state.originJobId : null;
    const originIsVisible =
      originJobId !== null && result.items.some((job) => job.id === originJobId);
    const canRestoreScroll =
      typeof scrollY === "number" &&
      Number.isFinite(scrollY) &&
      scrollY >= 0 &&
      !(scrollY > 0 && result.items.length === 0);
    if ((!canRestoreScroll && !originIsVisible) || restoredNavigationStateRef.current === state) {
      return;
    }

    let layoutFrame = 0;
    const renderFrame = window.requestAnimationFrame(() => {
      layoutFrame = window.requestAnimationFrame(() => {
        if (canRestoreScroll) window.scrollTo({ top: scrollY });
        if (originIsVisible) {
          document
            .getElementById(`research-job-link-${originJobId}`)
            ?.focus({ preventScroll: true });
        }
        restoredNavigationStateRef.current = state;
      });
    });
    return () => {
      window.cancelAnimationFrame(renderFrame);
      window.cancelAnimationFrame(layoutFrame);
    };
  }, [location.state, query.isSuccess, result.items]);

  function commitFilters(next: ResearchFilters, replace = false) {
    setSearchParams(serializeResearchFilters(next), { replace });
  }

  function updatePanelFilters(next: ResearchFilters) {
    if (mobileFiltersOpen) {
      setMobileFilterDraft(next);
      return;
    }
    commitFilters(next);
  }

  function openMobileFilters() {
    setMobileFilterDraft(filters);
    setMobileFiltersOpen(true);
  }

  function closeMobileFilters() {
    setMobileFiltersOpen(false);
  }

  function applyMobileFilters() {
    commitFilters(mobileFilterDraft, true);
    setMobileFiltersOpen(false);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    commitFilters({ ...filters, q: searchDraft }, true);
  }

  function toggleArrayValue<Key extends ArrayFilterKey>(
    key: Key,
    value: ResearchFilters[Key][number],
  ) {
    const current = panelFilters[key] as Array<ResearchFilters[Key][number]>;
    const next = current.includes(value)
      ? current.filter((candidate) => candidate !== value)
      : [...current, value];
    const dimension = unknownDimensionForKey(key);
    let includeUnknown = panelFilters.includeUnknown;
    if (
      dimension &&
      next.length > 0 &&
      panelResult.facets.unknownCounts[dimension] > 0 &&
      !includeUnknown.includes(dimension)
    ) {
      includeUnknown = [...includeUnknown, dimension];
    }
    if (dimension && next.length === 0) {
      includeUnknown = includeUnknown.filter((candidate) => candidate !== dimension);
    }
    updatePanelFilters({ ...panelFilters, [key]: next, includeUnknown });
  }

  function toggleUnknown(dimension: ResearchUnknownDimension) {
    const includeUnknown = panelFilters.includeUnknown.includes(dimension)
      ? panelFilters.includeUnknown.filter((candidate) => candidate !== dimension)
      : [...panelFilters.includeUnknown, dimension];
    updatePanelFilters({ ...panelFilters, includeUnknown });
  }

  function updateAvailability(
    key: "availableDaysPerWeek" | "availableMonths",
    rawValue: string,
    dimension: "attendance" | "duration",
  ) {
    const value = rawValue ? Number(rawValue) : null;
    const includeUnknown =
      value === null
        ? panelFilters.includeUnknown.filter((item) => item !== dimension)
        : panelFilters.includeUnknown.includes(dimension) ||
            panelResult.facets.unknownCounts[dimension] === 0
          ? panelFilters.includeUnknown
          : [...panelFilters.includeUnknown, dimension];
    updatePanelFilters({ ...panelFilters, [key]: value, includeUnknown });
  }

  function updateArrivalRequirement(value: string) {
    const arrivalRequirements = value ? [value] : [];
    const includeUnknown = value
      ? panelFilters.includeUnknown.includes("arrival") ||
        panelResult.facets.unknownCounts.arrival === 0
        ? panelFilters.includeUnknown
        : [...panelFilters.includeUnknown, "arrival" as const]
      : panelFilters.includeUnknown.filter((item) => item !== "arrival");
    updatePanelFilters({ ...panelFilters, arrivalRequirements, includeUnknown });
  }

  function updateGraduationYear(value: string) {
    const graduationYears = value ? [Number(value)] : [];
    const includeUnknown = value
      ? panelFilters.includeUnknown.includes("graduation") ||
        panelResult.facets.unknownCounts.graduation === 0
        ? panelFilters.includeUnknown
        : [...panelFilters.includeUnknown, "graduation" as const]
      : panelFilters.includeUnknown.filter((item) => item !== "graduation");
    updatePanelFilters({ ...panelFilters, graduationYears, includeUnknown });
  }

  function removeFilter(kind: string, value?: string) {
    if (kind === "q") commitFilters({ ...filters, q: "" });
    if (kind === "city" && value) {
      const cities = filters.cities.filter((item) => item !== value);
      commitFilters({
        ...filters,
        cities,
        includeUnknown:
          cities.length === 0
            ? filters.includeUnknown.filter((item) => item !== "city")
            : filters.includeUnknown,
      });
    }
    if (kind === "company" && value) {
      commitFilters({
        ...filters,
        companies: filters.companies.filter((item) => item !== value),
      });
    }
    if (kind === "family" && value) {
      const families = filters.families.filter((item) => item !== value);
      commitFilters({
        ...filters,
        families,
        includeUnknown:
          families.length === 0
            ? filters.includeUnknown.filter((item) => item !== "family")
            : filters.includeUnknown,
      });
    }
    if (kind === "batch" && value) {
      const recruitmentBatches = filters.recruitmentBatches.filter((item) => item !== value);
      commitFilters({
        ...filters,
        recruitmentBatches,
        includeUnknown:
          recruitmentBatches.length === 0
            ? filters.includeUnknown.filter((item) => item !== "batch")
            : filters.includeUnknown,
      });
    }
    if (kind === "arrival" && value) {
      const arrivalRequirements = filters.arrivalRequirements.filter((item) => item !== value);
      commitFilters({
        ...filters,
        arrivalRequirements,
        includeUnknown:
          arrivalRequirements.length === 0
            ? filters.includeUnknown.filter((item) => item !== "arrival")
            : filters.includeUnknown,
      });
    }
    if (kind === "graduation" && value) {
      const graduationYears = filters.graduationYears.filter((item) => item !== Number(value));
      commitFilters({
        ...filters,
        graduationYears,
        includeUnknown:
          graduationYears.length === 0
            ? filters.includeUnknown.filter((item) => item !== "graduation")
            : filters.includeUnknown,
      });
    }
    if (kind === "source" && value) {
      commitFilters({
        ...filters,
        sourceTypes: filters.sourceTypes.filter((item) => item !== value),
      });
    }
    if (kind === "unknown" && value) {
      commitFilters({
        ...filters,
        includeUnknown: filters.includeUnknown.filter((item) => item !== value),
      });
    }
    if (kind === "attendance") {
      commitFilters({
        ...filters,
        availableDaysPerWeek: null,
        includeUnknown: filters.includeUnknown.filter((item) => item !== "attendance"),
      });
    }
    if (kind === "duration") {
      commitFilters({
        ...filters,
        availableMonths: null,
        includeUnknown: filters.includeUnknown.filter((item) => item !== "duration"),
      });
    }
  }

  return (
    <>
      <header className="research-heading">
        <div>
          <p className="research-eyebrow">先找到岗位，再核对是否值得投</p>
          <h1>找产品与运营实习</h1>
          <p>搜索岗位或公司，再按城市和方向收窄；未知条件不会被系统猜测。</p>
        </div>
        <div className="research-heading__count">
          <strong>{result.totalCount}</strong>
          <span>条人工样本</span>
        </div>
      </header>

      <section className="research-search" aria-label="岗位搜索与筛选">
        <search aria-label="岗位关键词搜索">
          <form className="research-search__bar" onSubmit={submitSearch}>
            <label htmlFor="research-job-keyword">搜索岗位或公司</label>
            <div>
              <input
                id="research-job-keyword"
                type="search"
                maxLength={80}
                value={searchDraft}
                placeholder="例如：产品运营、腾讯"
                onChange={(event) => setSearchDraft(event.currentTarget.value)}
              />
              <button className="button button--primary" type="submit">
                搜索
              </button>
            </div>
          </form>
        </search>

        <button
          ref={mobileFilterToggleRef}
          className="research-filter-toggle"
          type="button"
          aria-expanded={mobileFiltersOpen}
          aria-controls="research-filter-panel"
          onClick={openMobileFilters}
        >
          筛选岗位{appliedCount > 0 ? `（${appliedCount} 类条件）` : ""}
        </button>

        <section
          ref={mobileFilterPanelRef}
          className={`research-filter-panel${mobileFiltersOpen ? " is-open" : ""}`}
          id="research-filter-panel"
          {...mobileDialogProps}
          aria-label="岗位筛选条件"
        >
          <div className="research-filter-panel__mobile-heading">
            <div>
              <h2 id="research-mobile-filter-title">筛选岗位</h2>
              <p>先确认能不能去，再比较值不值得投</p>
            </div>
            <button
              ref={mobileFilterCloseRef}
              className="research-filter-close"
              type="button"
              aria-label="关闭筛选"
              onClick={closeMobileFilters}
            >
              ×
            </button>
          </div>

          <p className="research-filter-scope">{scopeSummary}</p>

          <FilterGroup title="能直接筛选" description="同一组可多选；组内取其一，跨组同时满足">
            <FilterChoiceGroup
              label="岗位方向"
              description="产品与运营可同时选择"
              options={families}
              selected={panelFilters.families}
              onToggle={(value) => toggleArrayValue("families", value as ResearchFamily)}
              uncertainCount={panelResult.facets.unknownCounts.family}
              uncertainLabel="方向待核对"
              includeUncertain={panelFilters.includeUnknown.includes("family")}
              onToggleUncertain={() => toggleUnknown("family")}
            />
            <FilterChoiceGroup
              label="城市"
              description="一个岗位可能同时开放多个城市"
              options={panelResult.facets.cities}
              selected={panelFilters.cities}
              onToggle={(value) => toggleArrayValue("cities", value)}
              uncertainCount={panelResult.facets.unknownCounts.city}
              uncertainLabel="城市未说明"
              includeUncertain={panelFilters.includeUnknown.includes("city")}
              onToggleUncertain={() => toggleUnknown("city")}
            />
            {catalogResult.facets.companies.length >= 2 || panelFilters.companies.length > 0 ? (
              <FilterChoiceGroup
                label="公司"
                options={panelResult.facets.companies}
                selected={panelFilters.companies}
                onToggle={(value) => toggleArrayValue("companies", value)}
              />
            ) : null}
            {catalogResult.facets.recruitmentBatches.length >= 2 ||
            panelFilters.recruitmentBatches.length > 0 ? (
              <FilterChoiceGroup
                label="招聘类型"
                options={panelResult.facets.recruitmentBatches}
                selected={panelFilters.recruitmentBatches}
                onToggle={(value) => toggleArrayValue("recruitmentBatches", value)}
                uncertainCount={panelResult.facets.unknownCounts.batch}
                uncertainLabel="招聘类型未说明"
                includeUncertain={panelFilters.includeUnknown.includes("batch")}
                onToggleUncertain={() => toggleUnknown("batch")}
              />
            ) : null}
          </FilterGroup>

          <FilterGroup
            title="实习硬条件"
            description="未说明不等于不符合；数据不足时保留岗位并提示去详情核对"
          >
            <div className="research-condition-grid">
              <ConditionFilter
                label="每周出勤"
                knownCount={coverage.attendance}
                totalCount={jobs.length}
                emptyMessage="当前岗位均未说明每周出勤，暂不能可靠筛选"
                value={panelFilters.availableDaysPerWeek?.toString() ?? ""}
                options={researchAvailableDaysOptions.map((days) => ({
                  key: String(days),
                  label: `我每周最多可出勤 ${days} 天`,
                }))}
                unknownCount={panelResult.facets.unknownCounts.attendance}
                includeUnknown={panelFilters.includeUnknown.includes("attendance")}
                onChange={(value) =>
                  updateAvailability("availableDaysPerWeek", value, "attendance")
                }
                onToggleUnknown={() => toggleUnknown("attendance")}
              />
              <ConditionFilter
                label="持续时长"
                knownCount={coverage.duration}
                totalCount={jobs.length}
                emptyMessage="当前岗位均未说明实习时长，暂不能可靠筛选"
                value={panelFilters.availableMonths?.toString() ?? ""}
                options={researchAvailableMonthsOptions.map((months) => ({
                  key: String(months),
                  label: `我可连续实习 ${months} 个月`,
                }))}
                unknownCount={panelResult.facets.unknownCounts.duration}
                includeUnknown={panelFilters.includeUnknown.includes("duration")}
                onChange={(value) => updateAvailability("availableMonths", value, "duration")}
                onToggleUnknown={() => toggleUnknown("duration")}
              />
              <ConditionFilter
                label="最早到岗"
                knownCount={coverage.arrival}
                totalCount={jobs.length}
                emptyMessage="当前岗位均未说明到岗要求，暂不能可靠筛选"
                value={panelFilters.arrivalRequirements[0] ?? ""}
                options={panelResult.facets.arrivalRequirements.map((option) => ({
                  key: option.key,
                  label: option.label,
                }))}
                unknownCount={panelResult.facets.unknownCounts.arrival}
                includeUnknown={panelFilters.includeUnknown.includes("arrival")}
                onChange={updateArrivalRequirement}
                onToggleUnknown={() => toggleUnknown("arrival")}
              />
              <ConditionFilter
                label="毕业年份"
                knownCount={coverage.graduation}
                totalCount={jobs.length}
                emptyMessage="当前岗位均未说明毕业年份，暂不能可靠筛选"
                value={panelFilters.graduationYears[0]?.toString() ?? ""}
                options={panelResult.facets.graduationYears.map((option) => ({
                  key: option.key,
                  label: option.label,
                }))}
                unknownCount={panelResult.facets.unknownCounts.graduation}
                includeUnknown={panelFilters.includeUnknown.includes("graduation")}
                onChange={updateGraduationYear}
                onToggleUnknown={() => toggleUnknown("graduation")}
              />
            </div>
          </FilterGroup>

          <FilterGroup
            title="数据范围与来源"
            description="只有出现两个以上真实选项时才提供筛选，不用无效选项制造丰富感"
          >
            <div className="research-scope-grid">
              <ScopeFact label="公司" value={scopeFacetLabel(catalogResult.facets.companies)} />
              <ScopeFact
                label="招聘类型"
                value={scopeFacetLabel(catalogResult.facets.recruitmentBatches)}
              />
              <ScopeFact label="来源" value={scopeFacetLabel(catalogResult.facets.sourceTypes)} />
              <ScopeFact label="岗位状态" value="仅展示仍在招聘且经人工确认" />
              <ScopeFact label="最后核验" value={latestVerifiedLabel(jobs)} />
            </div>
            {catalogResult.facets.sourceTypes.length >= 2 || panelFilters.sourceTypes.length > 0 ? (
              <FilterChoiceGroup
                label="来源类型"
                options={panelResult.facets.sourceTypes}
                selected={panelFilters.sourceTypes}
                onToggle={(value) => toggleArrayValue("sourceTypes", value as ResearchSourceType)}
              />
            ) : null}
          </FilterGroup>

          {panelResult.clearlyMatchingItems.length === 0 && panelAppliedCount > 0 ? (
            <output className="research-filter-warning" aria-live="polite">
              {panelResult.informationUnknownItems.length > 0
                ? `当前没有明确符合的岗位，另有 ${panelResult.informationUnknownItems.length} 条信息待确认。`
                : "当前组合没有明确符合或信息待确认的岗位。"}
            </output>
          ) : null}

          <div className="research-filter-actions">
            <button
              className="research-clear-button"
              type="button"
              disabled={panelAppliedCount === 0}
              onClick={() => updatePanelFilters(emptyResearchFilters)}
            >
              清除全部
            </button>
            <button className="research-filter-done" type="button" onClick={applyMobileFilters}>
              {filterResultLabel(panelResult)}
            </button>
          </div>
        </section>

        <AppliedFilters
          filters={filters}
          cityOptions={result.facets.cities}
          companyOptions={result.facets.companies}
          batchOptions={result.facets.recruitmentBatches}
          arrivalOptions={result.facets.arrivalRequirements}
          graduationOptions={result.facets.graduationYears}
          sourceOptions={result.facets.sourceTypes}
          onRemove={removeFilter}
        />
      </section>

      <output className="research-result-status" aria-live="polite" aria-atomic="true">
        {query.isFetching
          ? "正在更新岗位结果。"
          : result.informationUnknownItems.length > 0
            ? `共找到 ${result.totalCount} 条岗位：${result.clearlyMatchingItems.length} 条明确符合，${result.informationUnknownItems.length} 条信息待确认。`
            : `共找到 ${result.totalCount} 条岗位。`}
      </output>

      {query.isPending ? <ResearchLoading /> : null}
      {query.isError ? (
        <ResearchState
          title="暂时无法读取研究岗位"
          message="研究样本没有被修改。请稍后重试。"
          actionLabel="重新读取"
          onAction={() => void query.refetch()}
        />
      ) : null}
      {query.isSuccess && result.items.length > 0 ? (
        result.informationUnknownItems.length > 0 ? (
          <div className="research-result-groups">
            {result.clearlyMatchingItems.length > 0 ? (
              <ResearchResultGroup
                id="research-clear-results"
                title="明确符合已选条件"
                description="这些岗位在已选条件上有明确字段支持。"
                jobs={result.clearlyMatchingItems}
              />
            ) : null}
            <ResearchResultGroup
              id="research-uncertain-results"
              title="信息待确认"
              description="这些岗位至少有一个已选条件未说明或存在冲突，请进入详情后到官方页面核对。"
              jobs={result.informationUnknownItems}
              uncertain
            />
          </div>
        ) : (
          <ResearchResultList jobs={result.items} label="研究岗位结果" />
        )
      ) : null}
      {query.isSuccess && result.items.length === 0 ? (
        appliedCount === 0 ? (
          <ResearchState
            title="当前没有可展示的研究岗位"
            message="研究目录只显示已人工确认且当前仍在招聘的样本。请先核对样本状态；系统不会用待复核或已关闭候选填充结果。"
          />
        ) : (
          <ResearchState
            title="当前条件下没有岗位"
            message="当前组合没有已明确符合的岗位。条件已完整保留；“未说明”没有被自动判成“不符合”。"
            actionLabel={
              uncertainRecovery
                ? `同时查看 ${uncertainRecovery.count} 条${uncertainRecovery.label}`
                : "清除全部"
            }
            onAction={() => {
              if (uncertainRecovery) {
                commitFilters({
                  ...filters,
                  includeUnknown: [...filters.includeUnknown, uncertainRecovery.dimension],
                });
                return;
              }
              commitFilters(emptyResearchFilters);
            }}
          />
        )
      ) : null}
    </>
  );
}

function filterResultLabel(result: ResearchSearchResult): string {
  if (result.informationUnknownItems.length === 0) {
    return `查看 ${result.totalCount} 条岗位`;
  }
  return `查看 ${result.clearlyMatchingItems.length} 条明确符合 + ${result.informationUnknownItems.length} 条待确认`;
}

function ResearchResultList({ jobs, label }: { jobs: readonly ResearchJob[]; label: string }) {
  return (
    <ol className="research-results" aria-label={label}>
      {jobs.map((job) => (
        <li key={job.id}>
          <ResearchJobRow job={job} />
        </li>
      ))}
    </ol>
  );
}

function ResearchResultGroup({
  id,
  title,
  description,
  jobs,
  uncertain = false,
}: {
  id: string;
  title: string;
  description: string;
  jobs: readonly ResearchJob[];
  uncertain?: boolean;
}) {
  return (
    <section
      className={`research-result-group${uncertain ? " research-result-group--uncertain" : ""}`}
      aria-labelledby={`${id}-title`}
    >
      <header className="research-result-group__heading">
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="research-result-group__count">{jobs.length} 条</span>
      </header>
      <ResearchResultList jobs={jobs} label={`${title}岗位`} />
    </section>
  );
}

function FilterGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="research-filter-group">
      <header className="research-filter-group__heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      <div className="research-filter-group__body">{children}</div>
    </section>
  );
}

function FilterChoiceGroup({
  label,
  description,
  options,
  selected,
  onToggle,
  uncertainCount = 0,
  uncertainLabel = "未说明或待核对",
  includeUncertain = false,
  onToggleUncertain,
}: {
  label: string;
  description?: string;
  options: ResearchFacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
  uncertainCount?: number;
  uncertainLabel?: string;
  includeUncertain?: boolean;
  onToggleUncertain?: () => void;
}) {
  return (
    <fieldset className="research-choice-group">
      <legend>{label}</legend>
      {description ? <p>{description}</p> : null}
      <div className="research-choice-options">
        {options.map((option) => (
          <label key={option.key} data-selected={selected.includes(option.key)}>
            <input
              type="checkbox"
              checked={selected.includes(option.key)}
              onChange={() => onToggle(option.key)}
            />
            <span>{option.label}</span>
            <small>{option.count}</small>
          </label>
        ))}
        {uncertainCount > 0 && onToggleUncertain ? (
          <label className="research-choice-option--uncertain" data-selected={includeUncertain}>
            <input type="checkbox" checked={includeUncertain} onChange={onToggleUncertain} />
            <span>{uncertainLabel}</span>
            <small>{uncertainCount}</small>
          </label>
        ) : null}
      </div>
    </fieldset>
  );
}

function ConditionFilter({
  label,
  knownCount,
  totalCount,
  emptyMessage,
  value,
  options,
  unknownCount,
  includeUnknown,
  onChange,
  onToggleUnknown,
}: {
  label: string;
  knownCount: number;
  totalCount: number;
  emptyMessage: string;
  value: string;
  options: Array<{ key: string; label: string }>;
  unknownCount: number;
  includeUnknown: boolean;
  onChange: (value: string) => void;
  onToggleUnknown: () => void;
}) {
  const canFilter = knownCount > 0 && options.length > 0;
  return (
    <section className="research-condition-card" data-can-filter={canFilter} aria-label={label}>
      <header>
        <strong>{label}</strong>
        <span>
          {knownCount}/{totalCount} 已说明
        </span>
      </header>
      {canFilter ? (
        <>
          <select
            value={value}
            aria-label={`${label}筛选`}
            onChange={(event) => onChange(event.currentTarget.value)}
          >
            <option value="">不限</option>
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          {value && unknownCount > 0 ? (
            <label className="research-condition-card__unknown">
              <input type="checkbox" checked={includeUnknown} onChange={onToggleUnknown} />
              <span>保留未说明岗位</span>
              <small>{unknownCount}</small>
            </label>
          ) : null}
        </>
      ) : (
        <p>{emptyMessage}</p>
      )}
    </section>
  );
}

function ScopeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="research-scope-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function unknownDimensionForKey(key: ArrayFilterKey): ResearchUnknownDimension | null {
  if (key === "cities") return "city";
  if (key === "families") return "family";
  if (key === "recruitmentBatches") return "batch";
  if (key === "arrivalRequirements") return "arrival";
  if (key === "graduationYears") return "graduation";
  return null;
}

function hardConditionCoverage(jobs: readonly ResearchJob[]) {
  return {
    attendance: jobs.filter((job) => job.weeklyAttendanceDays.state === "known").length,
    duration: jobs.filter((job) => job.durationMonths.state === "known").length,
    arrival: jobs.filter((job) => job.earliestStartDate.state === "known").length,
    graduation: jobs.filter((job) => job.graduationYears.state === "known").length,
  };
}

function scopeFacetLabel(options: ResearchFacetOption[]): string {
  if (options.length === 0) return "未说明";
  if (options.length === 1) return options[0]?.label ?? "未说明";
  return `${options.length} 个可选范围`;
}

function latestVerifiedLabel(jobs: readonly ResearchJob[]): string {
  const latest = jobs
    .map((job) => job.lastVerifiedAt)
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0];
  if (!latest) return "未记录";
  const date = new Date(latest);
  if (Number.isNaN(date.getTime())) return "时间待核对";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function researchScopeSummary(
  jobs: readonly ResearchJob[],
  facets: Pick<ResearchSearchResult["facets"], "companies" | "recruitmentBatches" | "sourceTypes">,
): string {
  const companies =
    facets.companies.length === 1
      ? facets.companies[0]?.label
      : `${facets.companies.length} 家公司`;
  const batches =
    facets.recruitmentBatches.length === 1
      ? facets.recruitmentBatches[0]?.label
      : `${facets.recruitmentBatches.length} 类招聘`;
  const sources =
    facets.sourceTypes.length === 1
      ? facets.sourceTypes[0]?.label
      : `${facets.sourceTypes.length} 类来源`;
  return `当前范围：${jobs.length} 条 · ${companies || "公司未说明"} · ${batches || "招聘类型未说明"} · ${sources || "来源未说明"}`;
}

function zeroResultRecovery(
  filters: ResearchFilters,
  result: ResearchSearchResult,
): { dimension: ResearchUnknownDimension; count: number; label: string } | null {
  const candidates: Array<{
    active: boolean;
    dimension: ResearchUnknownDimension;
    count: number;
    label: string;
  }> = [
    {
      active: filters.families.length > 0,
      dimension: "family",
      count: result.facets.unknownCounts.family,
      label: "方向待核对岗位",
    },
    {
      active: filters.cities.length > 0,
      dimension: "city",
      count: result.facets.unknownCounts.city,
      label: "城市未说明岗位",
    },
    {
      active: filters.availableDaysPerWeek !== null,
      dimension: "attendance",
      count: result.facets.unknownCounts.attendance,
      label: "出勤未说明岗位",
    },
    {
      active: filters.availableMonths !== null,
      dimension: "duration",
      count: result.facets.unknownCounts.duration,
      label: "时长未说明岗位",
    },
  ];
  return (
    candidates.find(
      (candidate) =>
        candidate.active &&
        candidate.count > 0 &&
        !filters.includeUnknown.includes(candidate.dimension),
    ) ?? null
  );
}

function AppliedFilters({
  filters,
  cityOptions,
  companyOptions,
  batchOptions,
  arrivalOptions,
  graduationOptions,
  sourceOptions,
  onRemove,
}: {
  filters: ResearchFilters;
  cityOptions: ResearchFacetOption[];
  companyOptions: ResearchFacetOption[];
  batchOptions: ResearchFacetOption[];
  arrivalOptions: ResearchFacetOption[];
  graduationOptions: ResearchFacetOption[];
  sourceOptions: ResearchFacetOption[];
  onRemove: (kind: string, value?: string) => void;
}) {
  const chips = [
    ...(filters.q ? [{ kind: "q", value: filters.q, label: `关键词：${filters.q}` }] : []),
    ...filters.cities.map((value) => ({
      kind: "city",
      value,
      label: cityOptions.find((option) => option.key === value)?.label ?? value,
    })),
    ...filters.companies.map((value) => ({
      kind: "company",
      value,
      label: companyOptions.find((option) => option.key === value)?.label ?? value,
    })),
    ...filters.families.map((value) => ({
      kind: "family",
      value,
      label: value === "product" ? "产品" : "运营",
    })),
    ...filters.recruitmentBatches.map((value) => ({
      kind: "batch",
      value,
      label: batchOptions.find((option) => option.key === value)?.label ?? value,
    })),
    ...filters.arrivalRequirements.map((value) => ({
      kind: "arrival",
      value,
      label: `到岗：${arrivalOptions.find((option) => option.key === value)?.label ?? value}`,
    })),
    ...filters.graduationYears.map((value) => ({
      kind: "graduation",
      value: String(value),
      label:
        graduationOptions.find((option) => option.key === String(value))?.label ?? `${value} 届`,
    })),
    ...filters.sourceTypes.map((value) => ({
      kind: "source",
      value,
      label: sourceOptions.find((option) => option.key === value)?.label ?? value,
    })),
    ...(filters.availableDaysPerWeek !== null
      ? [
          {
            kind: "attendance",
            value: String(filters.availableDaysPerWeek),
            label: `每周可出勤 ${filters.availableDaysPerWeek} 天`,
          },
        ]
      : []),
    ...(filters.availableMonths !== null
      ? [
          {
            kind: "duration",
            value: String(filters.availableMonths),
            label: `可持续 ${filters.availableMonths} 个月`,
          },
        ]
      : []),
    ...filters.includeUnknown.map((dimension) => ({
      kind: "unknown",
      value: dimension,
      label: `${unknownDimensionLabel(dimension)}也显示未说明/待核对`,
    })),
  ];

  if (chips.length === 0) return null;

  return (
    <section className="research-applied" aria-label="已选筛选条件">
      <span>已选</span>
      {chips.map((chip) => (
        <button
          key={`${chip.kind}-${chip.value}`}
          type="button"
          onClick={() => onRemove(chip.kind, chip.value)}
          aria-label={`移除筛选：${chip.label}`}
        >
          {chip.label}
          <span aria-hidden="true">×</span>
        </button>
      ))}
    </section>
  );
}

function unknownDimensionLabel(dimension: ResearchUnknownDimension): string {
  if (dimension === "city") return "城市";
  if (dimension === "family") return "岗位方向";
  if (dimension === "attendance") return "出勤";
  if (dimension === "duration") return "时长";
  if (dimension === "batch") return "招聘类型";
  if (dimension === "arrival") return "到岗";
  return "毕业年份";
}

function ResearchLoading() {
  return (
    <div className="research-loading" aria-hidden="true">
      {loadingRows.map((row) => (
        <div key={row} />
      ))}
    </div>
  );
}

function ResearchState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className="research-empty" aria-labelledby="research-state-title">
      <span className="research-empty__icon" aria-hidden="true">
        ◇
      </span>
      <div>
        <h2 id="research-state-title">{title}</h2>
        <p className="research-empty__message">{message}</p>
        {actionLabel && onAction ? (
          <button className="button button--secondary" type="button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}
