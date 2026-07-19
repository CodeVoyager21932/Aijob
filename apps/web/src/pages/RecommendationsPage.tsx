import type { JobSummary, RecommendationItem } from "@aijob/contracts";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  createRecommendationRun,
  getJobs,
  getProfileEvidence,
  getProfileFacts,
  getProfilePreferences,
  getRecommendationRun,
  type JobFilters,
} from "../api/product";
import {
  JourneySteps,
  ProductEmpty,
  ProductError,
  ProductLoading,
} from "../components/ProductStates";
import {
  axisLabels,
  axisTone,
  preferenceStatusLabel,
  preferenceStatusTone,
} from "../product/domain";
import { readJourneyId, writeJourneyId } from "../product/session-state";
import { ProductJobCard } from "./JobListPage";

const allJobsFilters: JobFilters = {
  keyword: "",
  companies: [],
  cities: [],
  jobFamilies: [],
  recruitmentBatches: [],
  availableWeeklyAttendanceDays: "",
  availableDurationMonths: "",
  latestStartDate: "",
  graduationYears: [],
  educationLevels: [],
  majors: [],
  minimumSalary: "",
  salaryPeriods: [],
  workModes: [],
  sources: [],
  sourceTypes: [],
  freshness: "",
  includeUnknownHardConditions: true,
};

export function RecommendationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const forceStartRequested = searchParams.get("start") === "1";
  const [runId, setRunId] = useState(() =>
    initialRecommendationRunId(forceStartRequested, readJourneyId("recommendationRunId")),
  );
  const forceStartReset = useRef(false);
  const autoStarted = useRef(false);
  const [jobsQuery, factsQuery, preferencesQuery, evidenceQuery] = useQueries({
    queries: [
      {
        queryKey: ["product", "jobs", "recommendation-candidates"],
        queryFn: ({ signal }: { signal: AbortSignal }) => getJobs(allJobsFilters, signal),
      },
      {
        queryKey: ["product", "profile", "facts"],
        queryFn: ({ signal }: { signal: AbortSignal }) => getProfileFacts(signal),
      },
      {
        queryKey: ["product", "profile", "preferences"],
        queryFn: ({ signal }: { signal: AbortSignal }) => getProfilePreferences(signal),
      },
      {
        queryKey: ["product", "profile", "evidence"],
        queryFn: ({ signal }: { signal: AbortSignal }) => getProfileEvidence(signal),
      },
    ],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (
        !factsQuery.data ||
        !("id" in factsQuery.data) ||
        !preferencesQuery.data ||
        !("id" in preferencesQuery.data) ||
        !evidenceQuery.data ||
        !("id" in evidenceQuery.data)
      ) {
        throw new Error("请先上传简历并确认事实、偏好和经历证据。");
      }
      const candidates = (jobsQuery.data?.items ?? []).flatMap((job) =>
        job.publishedJobVersionId ? [job.publishedJobVersionId] : [],
      );
      if (candidates.length === 0) {
        throw new Error("当前岗位目录没有可匹配的已发布版本。");
      }
      return createRecommendationRun({
        profileFactRevisionId: factsQuery.data.id,
        preferenceRevisionId: preferencesQuery.data.id,
        evidenceRevisionId: evidenceQuery.data.id,
        candidateJobVersionIds: candidates,
      });
    },
    onSuccess: (run) => {
      setRunId(run.id);
      writeJourneyId("recommendationRunId", run.id);
      setSearchParams({});
    },
  });

  const canStart =
    Boolean(jobsQuery.data) &&
    Boolean(factsQuery.data && "id" in factsQuery.data) &&
    Boolean(preferencesQuery.data && "id" in preferencesQuery.data) &&
    Boolean(evidenceQuery.data && "id" in evidenceQuery.data);

  useEffect(() => {
    if (!forceStartRequested) {
      forceStartReset.current = false;
      autoStarted.current = false;
      return;
    }
    if (forceStartReset.current) return;

    forceStartReset.current = true;
    setRunId(null);
    writeJourneyId("recommendationRunId", null);
  }, [forceStartRequested]);

  useEffect(() => {
    if (!forceStartRequested || autoStarted.current || runId || !canStart) {
      return;
    }
    autoStarted.current = true;
    createMutation.mutate();
  }, [canStart, createMutation, forceStartRequested, runId]);

  const runQuery = useQuery({
    queryKey: ["product", "recommendation", runId],
    queryFn: ({ signal }) => getRecommendationRun(runId || "", signal),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.status ?? "") ? 800 : false,
  });

  const jobsByVersion = useMemo(
    () =>
      new Map(
        (jobsQuery.data?.items ?? []).flatMap((job) =>
          job.publishedJobVersionId ? [[job.publishedJobVersionId, job] as const] : [],
        ),
      ),
    [jobsQuery.data],
  );

  const loading =
    jobsQuery.isPending ||
    factsQuery.isPending ||
    preferencesQuery.isPending ||
    evidenceQuery.isPending;
  if (loading) return <ProductLoading label="正在准备岗位候选与已确认资料" />;

  const profileReady =
    factsQuery.data &&
    "id" in factsQuery.data &&
    preferencesQuery.data &&
    "id" in preferencesQuery.data &&
    evidenceQuery.data &&
    "id" in evidenceQuery.data;

  return (
    <>
      <JourneySteps current={3} />
      <header className="product-hero">
        <div>
          <p className="eyebrow">确定性排序，不展示匹配百分比</p>
          <h1>我的岗位推荐</h1>
          <p>
            先比较资格状态，再看偏好、经历证据和新鲜度。存在冲突或未知条件的岗位仍可查看和纠正。
          </p>
        </div>
        {profileReady ? (
          <button
            className="button button--primary"
            type="button"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? "正在创建…" : runId ? "重新生成推荐" : "生成岗位推荐"}
          </button>
        ) : null}
      </header>

      {!profileReady ? (
        <ProductEmpty
          title="还没有完整的已确认资料"
          action={
            <Link className="button button--primary" to="/resume">
              上传并确认简历
            </Link>
          }
        >
          <p>推荐只使用你确认过的事实、偏好和经历证据。</p>
        </ProductEmpty>
      ) : null}
      {jobsQuery.data?.items.length === 0 ? (
        <ProductEmpty title="岗位目录当前为空">
          <p>请先运行本地岗位导入和发布流程，再回来生成推荐。</p>
        </ProductEmpty>
      ) : null}
      {createMutation.isError ? (
        <ProductError title="推荐任务没有创建成功" error={createMutation.error} />
      ) : null}
      {runId && runQuery.isPending ? <ProductLoading label="正在读取推荐任务" /> : null}
      {runQuery.isError ? (
        <ProductError
          title="推荐结果暂时不可用"
          error={runQuery.error}
          action={
            <button
              className="button button--secondary"
              type="button"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "正在创建新推荐…" : "创建新推荐"}
            </button>
          }
        />
      ) : runQuery.data ? (
        <RecommendationResult
          run={runQuery.data}
          jobsByVersion={jobsByVersion}
          isRegenerating={createMutation.isPending}
          onRegenerate={() => createMutation.mutate()}
        />
      ) : profileReady && !createMutation.isPending ? (
        <ProductEmpty title="准备好后生成第一组推荐">
          <p>系统会对当前目录中的岗位逐一运行三轴判断，并保留本次候选集合和排序版本。</p>
        </ProductEmpty>
      ) : null}
    </>
  );
}

export function initialRecommendationRunId(
  forceStartRequested: boolean,
  storedRunId: string | null,
): string | null {
  return forceStartRequested ? null : storedRunId;
}

export function partitionCurrentRecommendations(
  items: RecommendationItem[],
  jobsByVersion: ReadonlyMap<string, JobSummary>,
) {
  const current = items.flatMap((item) => {
    if (item.catalogState !== "current") return [];
    const job = jobsByVersion.get(item.publishedJobVersionId);
    return job ? [{ item, job }] : [];
  });
  return { current, staleCount: items.length - current.length };
}

export function RecommendationResult({
  run,
  jobsByVersion,
  isRegenerating,
  onRegenerate,
}: {
  run: Awaited<ReturnType<typeof getRecommendationRun>>;
  jobsByVersion: ReadonlyMap<string, JobSummary>;
  isRegenerating: boolean;
  onRegenerate: () => void;
}) {
  if (run.status === "queued" || run.status === "processing") {
    return <ProductLoading label="正在核对资格、证据与偏好" />;
  }
  if (run.status !== "succeeded") {
    return (
      <ProductError
        title="本次推荐没有完成"
        error={new Error(run.failureCode || "匹配工作进程可能尚未启动。")}
      />
    );
  }
  if (run.items.length === 0) {
    return (
      <ProductEmpty title="本次没有生成推荐项">
        <p>候选岗位可能尚未完成要求拆解，请稍后重试。</p>
      </ProductEmpty>
    );
  }

  const { current, staleCount } = partitionCurrentRecommendations(run.items, jobsByVersion);
  if (current.length === 0) {
    return (
      <ProductEmpty
        title="岗位目录已更新，需要重新生成推荐"
        action={
          <button
            className="button button--primary"
            type="button"
            disabled={isRegenerating}
            onClick={onRegenerate}
          >
            {isRegenerating ? "正在重新生成…" : "重新生成推荐"}
          </button>
        }
      >
        <p>
          这组推荐与当前目录已没有共同的岗位版本。重新生成后会使用当前岗位和你已确认的资料，旧结果不会继续参与展示。
        </p>
      </ProductEmpty>
    );
  }

  return (
    <section className="recommendation-result" aria-labelledby="recommendation-heading">
      <div className="results-heading">
        <div>
          <p className="eyebrow">本次推荐集合</p>
          <h2 id="recommendation-heading">{current.length} 个当前岗位</h2>
        </div>
        <p>数字仅表示展示顺序，不是匹配分数或录用概率。</p>
      </div>
      {staleCount > 0 ? (
        <output className="product-callout is-warning">
          {staleCount} 个旧岗位版本已不在当前目录，本页已统一移除；重新生成可获得完整的当前推荐。
        </output>
      ) : null}
      <ol className="recommendation-list">
        {current.map(({ item, job }, displayIndex) => {
          return (
            <li key={item.publishedJobVersionId}>
              <span className="recommendation-order" aria-hidden="true">
                {displayIndex + 1}
              </span>
              <ProductJobCard
                job={job}
                matchRunId={item.matchRunId}
                axes={<CompactAxes item={item} />}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CompactAxes({ item }: { item: RecommendationItem }) {
  const values: Array<{ label: string; value: string; status: string }> = [
    {
      label: "资格",
      value: axisLabels.eligibility[item.eligibility],
      status: item.eligibility,
    },
    {
      label: "证据",
      value: axisLabels.evidence[item.evidence],
      status: item.evidence,
    },
    {
      label: "偏好",
      value: preferenceStatusLabel(item.preference, item.reasonCodes),
      status: item.preference,
    },
  ];
  return (
    <>
      <dl className="compact-axes">
        {values.map((value) => (
          <div
            key={value.label}
            className={`is-${
              value.label === "偏好"
                ? preferenceStatusTone(item.preference, item.reasonCodes)
                : axisTone(value.status)
            }`}
          >
            <dt>{value.label}</dt>
            <dd>{value.value}</dd>
          </div>
        ))}
      </dl>
      {item.unknownRequirementIds.length > 0 ? (
        <p className="recommendation-unknown">{item.unknownRequirementIds.length} 项要求仍待确认</p>
      ) : null}
    </>
  );
}
