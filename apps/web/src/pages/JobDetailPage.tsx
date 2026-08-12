import type { JobDecisionStatus, JobDetail, MatchRun } from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { careerOsQueryKeys, createApplicationCase } from "../api/career-os";
import { createIdempotencyKey } from "../api/client";
import { legacySurfaceMode } from "../career-os/legacy-compatibility";
import {
  createMatchRun,
  createResumeTailoring,
  getJob,
  getJobDecisions,
  getMatchRun,
  getProfileEvidence,
  getProfileFacts,
  getProfilePreferences,
  markOfficialLinkOpened,
  putJobDecision,
} from "../api/product";
import { CopyTextButton } from "../components/CopyTextButton";
import { OfficialJobText } from "../components/OfficialJobText";
import {
  JourneySteps,
  ProductEmpty,
  ProductError,
  ProductLoading,
} from "../components/ProductStates";
import { shouldEnableCareerOsV2 } from "../environment";
import {
  axisLabels,
  axisTone,
  decisionLabels,
  displayField,
  formatDateTime,
  jobFamilyLabels,
  preferenceStatusLabel,
  preferenceStatusTone,
  sourceTypeLabels,
} from "../product/domain";
import { readJourneyId, writeJourneyId } from "../product/session-state";

interface MatchReasonView {
  code: string;
  explanation: string;
  requirementIds: string[];
  evidenceIds: string[];
}

export function groupMatchReasons(reasons: MatchReasonView[]) {
  const groups = new Map<string, { key: string; explanation: string; count: number }>();
  for (const reason of reasons) {
    const key = `${reason.code}:${reason.explanation}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { key, explanation: reason.explanation, count: 1 });
  }
  return [...groups.values()];
}

export function matchRunVersionState(
  runVersionId: string | undefined,
  jobVersionId: string | null | undefined,
): "missing" | "current" | "stale" {
  if (!runVersionId || jobVersionId === undefined) return "missing";
  return jobVersionId && runVersionId === jobVersionId ? "current" : "stale";
}

export function JobDetailPage() {
  const { jobId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [decisionReason, setDecisionReason] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [staleMatchNoticeJobId, setStaleMatchNoticeJobId] = useState<string | null>(null);
  const loadedDecisionRevision = useRef<number | null>(null);
  const caseCommandRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  const careerOsV2Enabled = shouldEnableCareerOsV2({
    flag: import.meta.env.VITE_CAREER_OS_V2,
  });
  const legacyActionsEnabled =
    legacySurfaceMode(careerOsV2Enabled, "job_detail_actions") === "legacy";

  const jobQuery = useQuery({
    queryKey: ["product", "job", jobId],
    queryFn: ({ signal }) => getJob(jobId, signal),
    enabled: Boolean(jobId),
  });
  const decisionsQuery = useQuery({
    queryKey: ["product", "decisions"],
    queryFn: ({ signal }) => getJobDecisions(signal),
    enabled: legacyActionsEnabled,
  });
  const factsQuery = useQuery({
    queryKey: ["product", "profile", "facts"],
    queryFn: ({ signal }) => getProfileFacts(signal),
    enabled: legacyActionsEnabled,
  });
  const preferencesQuery = useQuery({
    queryKey: ["product", "profile", "preferences"],
    queryFn: ({ signal }) => getProfilePreferences(signal),
    enabled: legacyActionsEnabled,
  });
  const evidenceQuery = useQuery({
    queryKey: ["product", "profile", "evidence"],
    queryFn: ({ signal }) => getProfileEvidence(signal),
    enabled: legacyActionsEnabled,
  });
  const matchRunId = legacyActionsEnabled ? searchParams.get("matchRunId") : null;
  const matchQuery = useQuery({
    queryKey: ["product", "match", matchRunId],
    queryFn: ({ signal }) => getMatchRun(matchRunId || "", signal),
    enabled: legacyActionsEnabled && Boolean(matchRunId),
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.status ?? "") ? 800 : false,
  });
  const matchVersionState = matchRunVersionState(
    matchQuery.data?.publishedJobVersionId,
    jobQuery.data?.publishedJobVersionId,
  );
  const matchVersionMismatch = matchVersionState === "stale";
  const currentMatchRun = matchVersionState === "current" ? matchQuery.data : undefined;

  useEffect(() => {
    if (!legacyActionsEnabled || !matchVersionMismatch) return;
    setStaleMatchNoticeJobId(jobId);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("matchRunId");
        return next;
      },
      { replace: true },
    );
  }, [jobId, legacyActionsEnabled, matchVersionMismatch, setSearchParams]);

  const decision = decisionsQuery.data?.find((item) => item.publishedJobId === jobId);
  useEffect(() => {
    if (!legacyActionsEnabled || !decision || loadedDecisionRevision.current === decision.revision)
      return;
    loadedDecisionRevision.current = decision.revision;
    setDecisionReason(decision.reason ?? "");
  }, [decision, legacyActionsEnabled]);
  const decisionMutation = useMutation({
    mutationFn: (status: JobDecisionStatus) =>
      putJobDecision(jobId, {
        expectedRevision: decision?.revision ?? 0,
        status,
        reason: decisionReason.trim() || null,
      }),
    onSuccess: (updated) => {
      setDecisionReason(updated.reason ?? "");
      void queryClient.invalidateQueries({ queryKey: ["product", "decisions"] });
    },
  });

  const matchMutation = useMutation({
    mutationFn: async () => {
      const job = jobQuery.data;
      const facts = factsQuery.data;
      const preferences = preferencesQuery.data;
      const evidence = evidenceQuery.data;
      if (
        !job?.publishedJobVersionId ||
        !facts ||
        !("id" in facts) ||
        !preferences ||
        !("id" in preferences) ||
        !evidence ||
        !("id" in evidence)
      ) {
        throw new Error("请先上传简历并确认事实、偏好和经历证据。");
      }
      return createMatchRun({
        publishedJobVersionId: job.publishedJobVersionId,
        profileFactRevisionId: facts.id,
        preferenceRevisionId: preferences.id,
        evidenceRevisionId: evidence.id,
      });
    },
    onSuccess: (run) => {
      setStaleMatchNoticeJobId(null);
      setSearchParams({ matchRunId: run.id });
    },
  });

  const tailoringMutation = useMutation({
    mutationFn: async () => {
      const job = jobQuery.data;
      const evidence = evidenceQuery.data;
      const analysisId =
        evidence && "resumeAnalysisId" in evidence
          ? (evidence.resumeAnalysisId ?? readJourneyId("analysisId"))
          : readJourneyId("analysisId");
      if (!job?.publishedJobVersionId || !evidence || !("id" in evidence) || !analysisId) {
        throw new Error("请先确认由当前简历生成的经历证据。");
      }
      if (!privacyConsent) {
        throw new Error("请先确认只发送去标识化、已确认的证据片段。");
      }
      return createResumeTailoring({
        resumeAnalysisId: analysisId,
        publishedJobVersionId: job.publishedJobVersionId,
        evidenceRevisionId: evidence.id,
        privacyConsent: true,
      });
    },
    onSuccess: (run) => {
      writeJourneyId("tailoringRunId", run.id);
      writeJourneyId("exportId", null);
      navigate(`/resume-tailorings/${encodeURIComponent(run.id)}`);
    },
  });

  const applicationCaseMutation = useMutation({
    mutationFn: ({
      publishedJobId,
      publishedJobVersionId,
    }: {
      publishedJobId: string;
      publishedJobVersionId: string;
    }) => {
      const signature = `${publishedJobId}:${publishedJobVersionId}`;
      if (!caseCommandRef.current || caseCommandRef.current.signature !== signature) {
        caseCommandRef.current = {
          signature,
          idempotencyKey: createIdempotencyKey("catalog-case"),
        };
      }
      return createApplicationCase(
        {
          jobContext: {
            kind: "public",
            publishedJobId,
            publishedJobVersionId,
          },
        },
        caseCommandRef.current.idempotencyKey,
      );
    },
    retry: false,
    onSuccess: async ({ applicationCase }) => {
      await queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.cases });
      navigate(`/applications/${applicationCase.id}/requirements`);
    },
  });

  if (jobQuery.isPending) return <ProductLoading label="正在读取岗位详情" />;
  if (jobQuery.isError) {
    return (
      <ProductError
        title="岗位详情暂时不可用"
        error={jobQuery.error}
        action={
          <Link className="button button--secondary" to="/jobs">
            返回岗位列表
          </Link>
        }
      />
    );
  }

  const job = jobQuery.data;
  const location = displayField(job.locations, (values) => values.join("、"));
  const family = displayField(job.jobFamily, (value) => jobFamilyLabels[value] || value);
  const showStaleMatch = staleMatchNoticeJobId === jobId || matchVersionMismatch;
  const officialUrlMethod = job.applicationMethods?.find(
    (method) => method.type === "official_url",
  );
  const emailMethod = job.applicationMethods?.find((method) => method.type === "company_email");
  const officialApplicationUrl = officialUrlMethod?.url ?? job.officialLink;

  return (
    <>
      {legacyActionsEnabled ? <JourneySteps current={currentMatchRun ? 3 : 1} /> : null}
      <Link className="back-link" to="/jobs">
        ← 返回岗位列表
      </Link>
      <article className="product-job-detail">
        <header className="product-detail-hero">
          <div className="product-detail-hero__labels">
            <span className="product-chip">{family.text}</span>
            <span className="product-chip">{location.text}</span>
            <span className="product-chip">
              {sourceTypeLabels[job.source.type] || job.source.type}
            </span>
          </div>
          <p>{job.companyName}</p>
          <h1>{job.title}</h1>
          <span>
            最后核验 {formatDateTime(job.source.lastVerifiedAt)} ·{" "}
            {job.displayStatus === "recruiting" ? "招聘中" : "状态待核对"}
          </span>
        </header>

        {careerOsV2Enabled ? (
          <section className="product-panel" aria-labelledby="career-os-case-heading">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">加入你的私有求职工作区</p>
                <h2 id="career-os-case-heading">围绕这个岗位持续准备</h2>
              </div>
              <button
                className="button button--primary"
                type="button"
                disabled={!job.publishedJobVersionId || applicationCaseMutation.isPending}
                onClick={() => {
                  if (!job.publishedJobVersionId) return;
                  applicationCaseMutation.mutate({
                    publishedJobId: job.id,
                    publishedJobVersionId: job.publishedJobVersionId,
                  });
                }}
              >
                {applicationCaseMutation.isPending ? "正在加入…" : "加入我的求职"}
              </button>
            </div>
            <p className="muted-copy">
              {job.publishedJobVersionId
                ? "再次加入会打开同一活动 Case；岗位信息固定在当前准入版本。"
                : "当前岗位缺少可固定的准入版本，暂时不能加入求职工作区。"}
            </p>
            {applicationCaseMutation.isError ? (
              <ProductError title="暂时无法加入求职工作区" error={applicationCaseMutation.error} />
            ) : null}
          </section>
        ) : null}

        <section className="product-panel" aria-labelledby="conditions-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">资格核对从明确条件开始</p>
              <h2 id="conditions-heading">岗位条件</h2>
            </div>
            <p>“未说明”不是符合；它会进入待确认项。</p>
          </div>
          <dl className="condition-grid">
            <Condition label="城市" value={job.locations} format={(value) => value.join("、")} />
            <Condition
              label="每周出勤"
              value={job.weeklyAttendanceDays}
              format={(value) => `${value} 天`}
            />
            <Condition
              label="实习时长"
              value={job.durationMonths}
              format={(value) => `${value} 个月`}
            />
            <Condition label="最早到岗" value={job.earliestStartDate} />
            <Condition
              label="毕业年份"
              value={job.graduationYears}
              format={(value) => value.join("、")}
            />
            <Condition
              label="学历"
              value={job.educationLevels}
              format={(value) => value.join("、")}
            />
            {job.studentStatus ? (
              <Condition
                label="在校状态"
                value={job.studentStatus}
                format={(value) => (value ? "要求在校 / 在读" : "未要求在校")}
              />
            ) : null}
            <Condition label="专业" value={job.majors} format={(value) => value.join("、")} />
            <Condition label="语言" value={job.languages} format={(value) => value.join("、")} />
            <Condition label="薪资" value={job.salary} format={(value) => value.rawText} />
            <Condition label="工作方式" value={job.workMode} />
            <Condition label="招聘批次" value={job.recruitmentBatch} />
            <Condition label="发布时间" value={job.postedAt} format={formatDateTime} />
            <Condition label="截止时间" value={job.deadlineAt} format={formatDateTime} />
          </dl>
        </section>

        <div className="product-detail-columns">
          <JobText title="岗位职责" field={job.responsibilitiesText} />
          <JobText title="岗位要求" field={job.requirementsText} />
        </div>

        <section className="product-panel" aria-labelledby="source-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">来源证据</p>
              <h2 id="source-heading">你将去哪里投递</h2>
            </div>
          </div>
          <dl className="source-evidence">
            <div>
              <dt>发布主体</dt>
              <dd>{job.companyName}</dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{job.source.displayName}</dd>
            </div>
            <div>
              <dt>来源域名</dt>
              <dd>
                <code>{job.source.domain}</code>
              </dd>
            </div>
            <div>
              <dt>主体证明</dt>
              <dd>{job.source.provenanceLevel}</dd>
            </div>
            <div>
              <dt>最后核验</dt>
              <dd>{formatDateTime(job.source.lastVerifiedAt)}</dd>
            </div>
            <div>
              <dt>企业来源页</dt>
              <dd>
                <a
                  className="text-link"
                  href={job.source.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看来源 ↗
                </a>
              </dd>
            </div>
          </dl>
        </section>

        {legacyActionsEnabled ? (
          <>
            <section className="product-panel" aria-labelledby="match-heading">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">资格、证据、偏好严格分开</p>
                  <h2 id="match-heading">我的岗位判断</h2>
                </div>
                {!matchRunId && !showStaleMatch ? (
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={matchMutation.isPending}
                    onClick={() => matchMutation.mutate()}
                  >
                    {matchMutation.isPending ? "正在创建…" : "用已确认资料核对"}
                  </button>
                ) : null}
              </div>
              {matchMutation.isError ? (
                <ProductError title="还不能开始核对" error={matchMutation.error} />
              ) : null}
              {!matchRunId && !showStaleMatch ? (
                <p className="muted-copy">
                  未上传简历也可以查看岗位。只有你确认过的事实和经历证据才会参与判断。
                </p>
              ) : null}
              {showStaleMatch ? (
                <ProductEmpty
                  title="这次判断不属于当前岗位版本"
                  action={
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={matchMutation.isPending}
                      onClick={() => matchMutation.mutate()}
                    >
                      {matchMutation.isPending ? "正在重新核对…" : "重新核对当前岗位"}
                    </button>
                  }
                >
                  <p>岗位内容可能已更新，旧判断已从地址中移除，不会展示在当前岗位下。</p>
                </ProductEmpty>
              ) : null}
              {!showStaleMatch && matchRunId && matchQuery.isPending ? (
                <ProductLoading label="正在生成三轴判断" />
              ) : null}
              {!showStaleMatch && matchQuery.isError ? (
                <ProductError error={matchQuery.error} />
              ) : null}
              {currentMatchRun ? <MatchResult run={currentMatchRun} /> : null}
            </section>

            <section className="product-panel" aria-labelledby="decision-heading">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">由你做决定</p>
                  <h2 id="decision-heading">投递状态</h2>
                </div>
                <span className="product-chip">
                  {decisionLabels[decision?.status ?? "undecided"]}
                </span>
              </div>
              <fieldset className="decision-options">
                <legend className="sr-only">岗位投递状态</legend>
                {(Object.keys(decisionLabels) as JobDecisionStatus[]).map((status) => (
                  <button
                    key={status}
                    className={decision?.status === status ? "is-selected" : ""}
                    type="button"
                    disabled={decisionMutation.isPending || decisionsQuery.isPending}
                    onClick={() => decisionMutation.mutate(status)}
                  >
                    {decisionLabels[status]}
                  </button>
                ))}
              </fieldset>
              <label className="full-field">
                <span>我的理由（可选）</span>
                <textarea
                  rows={3}
                  value={decisionReason}
                  onChange={(event) => setDecisionReason(event.target.value)}
                  placeholder="例如：城市合适，但毕业年份需要向 HR 确认"
                />
              </label>
              {decisionMutation.isError ? (
                <ProductError title="状态保存失败" error={decisionMutation.error} />
              ) : null}
              {decisionsQuery.isError ? (
                <ProductError title="现有投递状态读取失败" error={decisionsQuery.error} />
              ) : null}
            </section>
          </>
        ) : null}

        <section className="product-handoff" aria-labelledby="official-heading">
          <div>
            <p className="eyebrow">官方页面交接</p>
            <h2 id="official-heading">前往企业官方页面自行投递</h2>
            <p>
              {careerOsV2Enabled
                ? "打开链接不会自动标记“已投递”；返回求职项目后，请按真实进度手动记录。"
                : "打开链接不会自动标记“已投递”；返回后请按真实进度更新状态。"}
            </p>
          </div>
          {officialApplicationUrl ? (
            <div className="product-handoff__actions">
              <a
                className="button button--primary"
                href={officialApplicationUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={
                  legacyActionsEnabled
                    ? () => {
                        void markOfficialLinkOpened(job.id).catch(() => undefined);
                      }
                    : undefined
                }
              >
                前往企业招聘入口 ↗
              </a>
            </div>
          ) : emailMethod ? (
            <div className="email-application">
              <div>
                <span>企业招聘邮箱</span>
                <strong>{emailMethod.email}</strong>
                <p>{emailMethod.sourceText}</p>
              </div>
              <div className="product-handoff__actions">
                <CopyTextButton text={emailMethod.email} label="复制邮箱" />
                <a
                  className="button button--secondary"
                  href={job.source.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看岗位来源 ↗
                </a>
              </div>
            </div>
          ) : (
            <div className="product-callout is-warning">
              <p>官方投递入口正在复核，不提供不确定跳转。</p>
              <a
                className="text-link"
                href={job.source.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                查看岗位来源
              </a>
            </div>
          )}
        </section>

        {legacyActionsEnabled ? (
          <section className="product-panel" aria-labelledby="tailor-heading">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">最后一步，可随时降级为安全模板</p>
                <h2 id="tailor-heading">针对这个岗位优化简历表达</h2>
              </div>
            </div>
            <p className="muted-copy">
              AI
              或模板只能重写已确认事实，并逐段给出要求与证据引用。它不能新增经历，也不会自动改写最终简历。
            </p>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={privacyConsent}
                onChange={(event) => setPrivacyConsent(event.target.checked)}
              />
              我同意发送去标识化、已确认的简历证据片段用于本次岗位定向优化
            </label>
            <button
              className="button button--primary"
              type="button"
              disabled={tailoringMutation.isPending || !privacyConsent}
              onClick={() => tailoringMutation.mutate()}
            >
              {tailoringMutation.isPending ? "正在创建优化任务…" : "生成逐段对照修改稿"}
            </button>
            {tailoringMutation.isError ? (
              <ProductError title="暂时不能生成修改稿" error={tailoringMutation.error} />
            ) : null}
          </section>
        ) : null}
      </article>
    </>
  );
}

function Condition<T>({
  label,
  value,
  format,
}: {
  label: string;
  value: Parameters<typeof displayField<T>>[0];
  format?: (value: T) => string;
}) {
  const field = displayField(value, format);
  return (
    <div className={`condition field-${field.state}`}>
      <dt>{label}</dt>
      <dd>
        <strong>{field.text}</strong>
        <small>{field.note}</small>
      </dd>
    </div>
  );
}

function JobText({ title, field }: { title: string; field: JobDetail["responsibilitiesText"] }) {
  const value = displayField(field);
  return (
    <section className="product-panel job-prose">
      <p className="eyebrow">岗位原文</p>
      <h2>{title}</h2>
      {value.state === "known" ? (
        <OfficialJobText text={value.text} />
      ) : (
        <div className="product-callout is-warning">
          <strong>{value.text}</strong>
          <p>{value.note}</p>
        </div>
      )}
    </section>
  );
}

function MatchResult({ run }: { run: MatchRun }) {
  if (run.status === "queued" || run.status === "processing") {
    return <ProductLoading label="正在核对岗位要求" />;
  }
  if (run.status !== "succeeded" || !run.result) {
    return (
      <ProductError
        title="本次匹配未完成"
        error={new Error(run.failureCode || "可以稍后重新创建匹配任务。")}
      />
    );
  }
  const result = run.result;
  const axes: Array<{
    key: "eligibility" | "evidence" | "preference";
    label: string;
    status: string;
    value: string;
    reasons: Array<{
      code: string;
      explanation: string;
      requirementIds: string[];
      evidenceIds: string[];
    }>;
  }> = [
    {
      key: "eligibility",
      label: "资格",
      status: result.eligibility.status,
      value: axisLabels.eligibility[result.eligibility.status],
      reasons: result.eligibility.reasons,
    },
    {
      key: "evidence",
      label: "经历证据",
      status: result.evidence.status,
      value: axisLabels.evidence[result.evidence.status],
      reasons: result.evidence.reasons,
    },
    {
      key: "preference",
      label: "偏好",
      status: result.preference.status,
      value: preferenceStatusLabel(
        result.preference.status,
        result.preference.reasons.map((reason) => reason.code),
      ),
      reasons: result.preference.reasons,
    },
  ];
  return (
    <div className="axis-grid">
      {axes.map((axis) => (
        <section
          key={axis.key}
          className={`axis-card is-${
            axis.key === "preference"
              ? preferenceStatusTone(
                  result.preference.status,
                  result.preference.reasons.map((reason) => reason.code),
                )
              : axisTone(axis.status)
          }`}
        >
          <span>{axis.label}</span>
          <h3>{axis.value}</h3>
          {axis.reasons.length > 0 ? (
            <ul>
              {groupMatchReasons(axis.reasons).map((reason) => (
                <li key={reason.key}>
                  {reason.count > 1
                    ? `${reason.count} 项：${reason.explanation}`
                    : reason.explanation}
                </li>
              ))}
            </ul>
          ) : (
            <p>当前已确认信息中没有需要额外说明的项。</p>
          )}
        </section>
      ))}
      {result.unknownRequirementIds.length > 0 ? (
        <p className="axis-unknown">
          仍有 {result.unknownRequirementIds.length} 个岗位要求无法可靠核对，请在官方页面确认。
        </p>
      ) : null}
    </div>
  );
}
