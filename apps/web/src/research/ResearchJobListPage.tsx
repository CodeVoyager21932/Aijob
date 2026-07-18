import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  ResearchUnknownDimension,
} from "./types";

const familyOptions: ResearchFacetOption[] = [
  { key: "product", label: "产品", count: 0 },
  { key: "operations", label: "运营", count: 0 },
];
const loadingRows = ["loading-one", "loading-two", "loading-three", "loading-four", "loading-five"];

export function ResearchJobListPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseResearchFilters(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
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
    if (!mobileFiltersOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
      mobileFilterToggleRef.current?.focus();
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

  const result = useMemo(
    () => searchResearchJobs(query.data ?? [], filters),
    [filters, query.data],
  );
  const catalogCompanyCount = useMemo(
    () => searchResearchJobs(query.data ?? [], emptyResearchFilters).facets.companies.length,
    [query.data],
  );
  const appliedCount = countAppliedResearchFilters(filters);
  const families = familyOptions.map((option) => ({
    ...option,
    count: result.facets.families.find((candidate) => candidate.key === option.key)?.count ?? 0,
  }));
  const showCompanyFilter = catalogCompanyCount >= 2 || filters.companies.length > 0;

  useEffect(() => {
    if (!query.isSuccess) return;
    const state = location.state as { scrollY?: unknown } | null;
    const scrollY = state?.scrollY;
    if (
      typeof scrollY !== "number" ||
      !Number.isFinite(scrollY) ||
      scrollY < 0 ||
      (scrollY > 0 && result.items.length === 0) ||
      restoredNavigationStateRef.current === state
    ) {
      return;
    }

    restoredNavigationStateRef.current = state;
    let layoutFrame = 0;
    const renderFrame = window.requestAnimationFrame(() => {
      layoutFrame = window.requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
    });
    return () => {
      window.cancelAnimationFrame(renderFrame);
      window.cancelAnimationFrame(layoutFrame);
    };
  }, [location.state, query.isSuccess, result.items.length]);

  function commitFilters(next: ResearchFilters, replace = false) {
    setSearchParams(serializeResearchFilters(next), { replace });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    commitFilters({ ...filters, q: searchDraft }, true);
  }

  function toggleArrayValue<Key extends "cities" | "companies" | "families">(
    key: Key,
    value: ResearchFilters[Key][number],
  ) {
    const current = filters[key] as Array<ResearchFilters[Key][number]>;
    const next = current.includes(value)
      ? current.filter((candidate) => candidate !== value)
      : [...current, value];
    let includeUnknown = filters.includeUnknown;
    if (next.length === 0 && key === "cities") {
      includeUnknown = includeUnknown.filter((dimension) => dimension !== "city");
    }
    if (next.length === 0 && key === "families") {
      includeUnknown = includeUnknown.filter((dimension) => dimension !== "family");
    }
    commitFilters({ ...filters, [key]: next, includeUnknown });
  }

  function toggleUnknown(dimension: ResearchUnknownDimension) {
    const includeUnknown = filters.includeUnknown.includes(dimension)
      ? filters.includeUnknown.filter((candidate) => candidate !== dimension)
      : [...filters.includeUnknown, dimension];
    commitFilters({ ...filters, includeUnknown });
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
          onClick={() => setMobileFiltersOpen((open) => !open)}
        >
          筛选条件{appliedCount > 0 ? `（${appliedCount}）` : ""}
        </button>

        <section
          ref={mobileFilterPanelRef}
          className={`research-filter-panel${mobileFiltersOpen ? " is-open" : ""}`}
          id="research-filter-panel"
          role={mobileFiltersOpen ? "dialog" : undefined}
          aria-label="岗位筛选条件"
        >
          <div className="research-filter-panel__mobile-heading">
            <strong id="research-mobile-filter-title">筛选岗位</strong>
            <button
              ref={mobileFilterCloseRef}
              className="research-filter-close"
              type="button"
              aria-label="关闭筛选"
              onClick={() => setMobileFiltersOpen(false)}
            >
              ×
            </button>
          </div>
          <FacetDisclosure
            label="城市"
            options={result.facets.cities}
            selected={filters.cities}
            onToggle={(value) => toggleArrayValue("cities", value)}
            uncertainCount={result.facets.unknownCounts.city}
            includeUncertain={filters.includeUnknown.includes("city")}
            onToggleUncertain={() => toggleUnknown("city")}
          />
          {showCompanyFilter ? (
            <FacetDisclosure
              label="公司"
              options={result.facets.companies}
              selected={filters.companies}
              onToggle={(value) => toggleArrayValue("companies", value)}
            />
          ) : null}
          <FacetDisclosure
            label="岗位方向"
            options={families}
            selected={filters.families}
            onToggle={(value) => toggleArrayValue("families", value as ResearchFamily)}
            uncertainCount={result.facets.unknownCounts.family}
            includeUncertain={filters.includeUnknown.includes("family")}
            onToggleUncertain={() => toggleUnknown("family")}
          />
          <details className="research-facet research-facet--more">
            <summary>
              更多筛选
              {filters.availableDaysPerWeek !== null || filters.availableMonths !== null ? (
                <span>已设置</span>
              ) : null}
            </summary>
            <div className="research-more-fields">
              <label>
                每周可出勤
                <select
                  value={filters.availableDaysPerWeek ?? ""}
                  onChange={(event) =>
                    commitFilters({
                      ...filters,
                      availableDaysPerWeek: event.currentTarget.value
                        ? Number(event.currentTarget.value)
                        : null,
                      includeUnknown: event.currentTarget.value
                        ? filters.includeUnknown
                        : filters.includeUnknown.filter((item) => item !== "attendance"),
                    })
                  }
                >
                  <option value="">不限</option>
                  {researchAvailableDaysOptions.map((days) => (
                    <option key={days} value={days}>
                      每周可出勤 {days} 天
                    </option>
                  ))}
                </select>
              </label>
              {filters.availableDaysPerWeek !== null &&
              result.facets.unknownCounts.attendance > 0 ? (
                <UnknownToggle
                  checked={filters.includeUnknown.includes("attendance")}
                  count={result.facets.unknownCounts.attendance}
                  label="同时显示出勤未说明或待核对的岗位"
                  onChange={() => toggleUnknown("attendance")}
                />
              ) : null}
              <label>
                可持续实习
                <select
                  value={filters.availableMonths ?? ""}
                  onChange={(event) =>
                    commitFilters({
                      ...filters,
                      availableMonths: event.currentTarget.value
                        ? Number(event.currentTarget.value)
                        : null,
                      includeUnknown: event.currentTarget.value
                        ? filters.includeUnknown
                        : filters.includeUnknown.filter((item) => item !== "duration"),
                    })
                  }
                >
                  <option value="">不限</option>
                  {researchAvailableMonthsOptions.map((months) => (
                    <option key={months} value={months}>
                      可持续 {months} 个月
                    </option>
                  ))}
                </select>
              </label>
              {filters.availableMonths !== null && result.facets.unknownCounts.duration > 0 ? (
                <UnknownToggle
                  checked={filters.includeUnknown.includes("duration")}
                  count={result.facets.unknownCounts.duration}
                  label="同时显示时长未说明或待核对的岗位"
                  onChange={() => toggleUnknown("duration")}
                />
              ) : null}
            </div>
          </details>
          <button
            className="research-clear-button"
            type="button"
            disabled={appliedCount === 0}
            onClick={() => commitFilters(emptyResearchFilters)}
          >
            清除全部
          </button>
          <button
            className="research-filter-done"
            type="button"
            onClick={() => setMobileFiltersOpen(false)}
          >
            查看 {result.totalCount} 条结果
          </button>
        </section>

        <AppliedFilters
          filters={filters}
          cityOptions={result.facets.cities}
          companyOptions={result.facets.companies}
          onRemove={removeFilter}
        />
      </section>

      <output className="research-result-status" aria-live="polite" aria-atomic="true">
        {query.isFetching ? "正在更新岗位结果。" : `共找到 ${result.totalCount} 条岗位。`}
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
        <ol className="research-results" aria-label="研究岗位结果">
          {result.items.map((job) => (
            <li key={job.id}>
              <ResearchJobRow job={job} />
            </li>
          ))}
        </ol>
      ) : null}
      {query.isSuccess && result.items.length === 0 ? (
        appliedCount === 0 ? (
          <ResearchState
            title="交互已经就绪，等待人工岗位样本"
            message="当前 5 条自动采集候选尚未获得 coco 或指定复核者确认，因此不会进入研究目录，也不会计入人工样本进度。"
          />
        ) : (
          <ResearchState
            title="当前条件下没有岗位"
            message="上方已选标签就是当前收窄组合，条件已完整保留。可以删除任一标签，或清除全部后重新查看。"
            actionLabel="清除全部"
            onAction={() => commitFilters(emptyResearchFilters)}
          />
        )
      ) : null}
    </>
  );
}

interface FacetDisclosureProps {
  label: string;
  options: ResearchFacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
  uncertainCount?: number;
  includeUncertain?: boolean;
  onToggleUncertain?: () => void;
}

function FacetDisclosure({
  label,
  options,
  selected,
  onToggle,
  uncertainCount = 0,
  includeUncertain = false,
  onToggleUncertain,
}: FacetDisclosureProps) {
  return (
    <details className="research-facet">
      <summary>
        {label}
        {selected.length > 0 ? <span>{selected.length}</span> : null}
      </summary>
      <fieldset>
        <legend>{label}（可多选）</legend>
        {options.length === 0 ? (
          <p className="research-facet__empty">等待已确认样本提供选项</p>
        ) : null}
        {options.map((option) => (
          <label key={option.key}>
            <input
              type="checkbox"
              checked={selected.includes(option.key)}
              onChange={() => onToggle(option.key)}
            />
            <span>{option.label}</span>
            <small>{option.count}</small>
          </label>
        ))}
        {selected.length > 0 && uncertainCount > 0 && onToggleUncertain ? (
          <UnknownToggle
            checked={includeUncertain}
            count={uncertainCount}
            label="未说明或待核对"
            onChange={onToggleUncertain}
          />
        ) : null}
      </fieldset>
    </details>
  );
}

function UnknownToggle({
  checked,
  count,
  label,
  onChange,
}: {
  checked: boolean;
  count: number;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="research-unknown-toggle">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
      <small>{count}</small>
    </label>
  );
}

function AppliedFilters({
  filters,
  cityOptions,
  companyOptions,
  onRemove,
}: {
  filters: ResearchFilters;
  cityOptions: ResearchFacetOption[];
  companyOptions: ResearchFacetOption[];
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
    ...filters.includeUnknown
      .filter((dimension) => {
        if (dimension === "city") return filters.cities.length > 0;
        if (dimension === "family") return filters.families.length > 0;
        if (dimension === "attendance") return filters.availableDaysPerWeek !== null;
        return filters.availableMonths !== null;
      })
      .map((dimension) => ({
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
  return "时长";
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
