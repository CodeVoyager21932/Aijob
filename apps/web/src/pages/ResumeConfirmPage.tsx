import type { JobPreference, ProfileFact } from "@aijob/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getProfileEvidence,
  getProfileFacts,
  getProfilePreferences,
  getResumeAnalysis,
  putProfileEvidence,
  putProfileFacts,
  putProfilePreferences,
} from "../api/product";
import {
  JourneySteps,
  ProductEmpty,
  ProductError,
  ProductLoading,
} from "../components/ProductStates";
import { piiLabel, splitList } from "../product/domain";
import { removeConfirmedResumeAnalysisCache } from "../product/privacy-cache";
import { buildConfirmedEvidence, profileConfirmationError } from "../product/resume-confirmation";
import { writeJourneyId } from "../product/session-state";

interface ManualFacts {
  currentStudent: "" | "yes" | "no";
  graduationYear: string;
  currentCity: string;
  availableFrom: string;
  attendanceDays: string;
  durationMonths: string;
  educationLevel: string;
  majors: string;
  skills: string;
}

const initialManualFacts: ManualFacts = {
  currentStudent: "",
  graduationYear: "",
  currentCity: "",
  availableFrom: "",
  attendanceDays: "",
  durationMonths: "",
  educationLevel: "",
  majors: "",
  skills: "",
};

export function ResumeConfirmPage() {
  const { analysisId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedEvidence, setSelectedEvidence] = useState<Set<string>>(new Set());
  const [manualFacts, setManualFacts] = useState(initialManualFacts);
  const [cities, setCities] = useState("");
  const [jobFamilies, setJobFamilies] = useState<string[]>(["product", "operations"]);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);

  const analysisQuery = useQuery({
    queryKey: ["product", "resume-analysis", analysisId],
    queryFn: ({ signal }) => getResumeAnalysis(analysisId, signal),
    enabled: Boolean(analysisId),
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.status ?? "") ? 700 : false,
  });
  const [factsQuery, preferencesQuery, evidenceQuery] = useQueries({
    queries: [
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

  const result = analysisQuery.data?.result;
  useEffect(() => {
    if (!result) return;
    for (const candidate of result.candidateFacts) {
      if (candidate.key === "graduation_year" && typeof candidate.value === "number") {
        setManualFacts((current) =>
          current.graduationYear
            ? current
            : { ...current, graduationYear: String(candidate.value) },
        );
      }
      if (candidate.key === "skills" && Array.isArray(candidate.value)) {
        const parsedSkills = candidate.value.map(String).join("、");
        setManualFacts((current) =>
          current.skills ? current : { ...current, skills: parsedSkills },
        );
      }
    }
  }, [result]);

  const confirmedFacts = useMemo(() => buildFacts(manualFacts), [manualFacts]);
  const confirmedEvidence = useMemo(
    () => buildConfirmedEvidence(result?.candidateEvidence ?? [], selectedEvidence, analysisId),
    [analysisId, result, selectedEvidence],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const confirmationError = profileConfirmationError({
        resultAvailable: Boolean(result),
        privacyConfirmed,
      });
      if (confirmationError) throw new Error(confirmationError);
      if (!factsQuery.data || !preferencesQuery.data || !evidenceQuery.data) {
        throw new Error("当前资料修订尚未加载完成。");
      }
      const preferences: JobPreference = {
        cities: splitList(cities),
        jobFamilies: jobFamilies as JobPreference["jobFamilies"],
        companyNames: [],
        workModes: [],
      };
      const factsRevision = await putProfileFacts({
        expectedRevision: factsQuery.data.revision,
        facts: confirmedFacts,
      });
      queryClient.setQueryData(["product", "profile", "facts"], factsRevision);
      const preferencesRevision = await putProfilePreferences({
        expectedRevision: preferencesQuery.data.revision,
        preferences,
      });
      queryClient.setQueryData(["product", "profile", "preferences"], preferencesRevision);
      const evidenceRevision = await putProfileEvidence({
        expectedRevision: evidenceQuery.data.revision,
        resumeAnalysisId: analysisId,
        evidence: confirmedEvidence,
      });
      queryClient.setQueryData(["product", "profile", "evidence"], evidenceRevision);
      return { factsRevision, preferencesRevision, evidenceRevision };
    },
    onSuccess: () => {
      removeConfirmedResumeAnalysisCache(queryClient, analysisId);
      writeJourneyId("analysisId", analysisId);
      navigate("/recommendations?start=1");
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate();
  }

  if (
    analysisQuery.isPending ||
    factsQuery.isPending ||
    preferencesQuery.isPending ||
    evidenceQuery.isPending
  ) {
    return <ProductLoading label="正在解析并准备确认项" />;
  }
  if (analysisQuery.isError) return <ProductError error={analysisQuery.error} />;
  if (analysisQuery.data.status === "queued" || analysisQuery.data.status === "processing") {
    return <ProductLoading label="正在从简历中提取候选事实和经历证据" />;
  }
  if (analysisQuery.data.status === "needs_input") {
    return (
      <ProductEmpty
        title="这份 PDF 没有可提取文本"
        action={
          <Link className="button button--primary" to="/resume">
            改用粘贴文本
          </Link>
        }
      >
        <p>它可能是扫描件。MVP 不做 OCR，也不会猜测图片中的文字。</p>
      </ProductEmpty>
    );
  }
  if (analysisQuery.data.status === "failed") {
    return (
      <ProductError
        title="简历解析失败"
        error={new Error(analysisQuery.data.failureCode || "请重新提交简历。")}
        action={
          <Link className="button button--primary" to="/resume">
            重新提交
          </Link>
        }
      />
    );
  }
  if (!result) {
    return (
      <ProductEmpty
        title="这份简历已经完成确认"
        action={
          <Link className="button button--primary" to="/recommendations">
            查看岗位推荐
          </Link>
        }
      >
        <p>原文和解析候选已按约定删除，只保留你确认过的结构化资料。</p>
      </ProductEmpty>
    );
  }

  return (
    <>
      <JourneySteps current={2} />
      <header className="product-hero">
        <div>
          <p className="eyebrow">解析不等于确认</p>
          <h1>逐项确认可参与匹配的内容</h1>
          <p>事实、偏好和经历证据分开保存。你没确认的内容不会参与任何结论。</p>
        </div>
      </header>

      <form className="confirmation-form" onSubmit={submit}>
        <section className="product-panel" aria-labelledby="privacy-result-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">隐私复核</p>
              <h2 id="privacy-result-heading">确认去标识化结果</h2>
            </div>
          </div>
          {analysisQuery.data.piiFindings.length > 0 ? (
            <div className="product-callout is-warning">
              <strong>服务器发现并已遮盖以下信息</strong>
              <ul>
                {analysisQuery.data.piiFindings.map((finding) => (
                  <li key={finding.kind}>
                    {piiLabel(finding.kind)} {finding.count} 处
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="product-callout">
              服务器未检测到手机号、邮箱或身份证号；请仍检查姓名和地址。
            </div>
          )}
          <details className="redacted-preview">
            <summary>查看将用于生成候选证据的去标识化文本</summary>
            <pre>{result.redactedText}</pre>
          </details>
          <label className="consent-row">
            <input
              type="checkbox"
              checked={privacyConfirmed}
              onChange={(event) => setPrivacyConfirmed(event.target.checked)}
            />
            我已检查去标识化文本，并确认可保存下方选中的事实与证据
          </label>
        </section>

        <section className="product-panel" aria-labelledby="facts-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">资格事实</p>
              <h2 id="facts-heading">我确认的客观情况</h2>
            </div>
            <span>{confirmedFacts.length} 项</span>
          </div>
          <div className="form-grid">
            <label>
              <span>在校状态</span>
              <select
                value={manualFacts.currentStudent}
                onChange={(event) =>
                  setManualFacts({
                    ...manualFacts,
                    currentStudent: event.target.value as ManualFacts["currentStudent"],
                  })
                }
              >
                <option value="">不确认 / 暂不参与资格判断</option>
                <option value="yes">我确认当前是在校生</option>
                <option value="no">我确认当前不是在校生</option>
              </select>
            </label>
            <Field
              label="毕业年份"
              type="number"
              value={manualFacts.graduationYear}
              onChange={(value) => setManualFacts({ ...manualFacts, graduationYear: value })}
              placeholder="例如 2027"
            />
            <Field
              label="当前城市"
              value={manualFacts.currentCity}
              onChange={(value) => setManualFacts({ ...manualFacts, currentCity: value })}
              placeholder="例如 深圳"
            />
            <Field
              label="可到岗日期"
              type="date"
              value={manualFacts.availableFrom}
              onChange={(value) => setManualFacts({ ...manualFacts, availableFrom: value })}
            />
            <Field
              label="每周可出勤天数"
              type="number"
              value={manualFacts.attendanceDays}
              onChange={(value) => setManualFacts({ ...manualFacts, attendanceDays: value })}
              placeholder="1–7"
            />
            <Field
              label="可持续月数"
              type="number"
              value={manualFacts.durationMonths}
              onChange={(value) => setManualFacts({ ...manualFacts, durationMonths: value })}
              placeholder="例如 3"
            />
            <Field
              label="最高学历"
              value={manualFacts.educationLevel}
              onChange={(value) => setManualFacts({ ...manualFacts, educationLevel: value })}
              placeholder="例如 本科"
            />
            <Field
              label="专业（逗号分隔）"
              value={manualFacts.majors}
              onChange={(value) => setManualFacts({ ...manualFacts, majors: value })}
            />
            <Field
              label="技能（逗号分隔）"
              value={manualFacts.skills}
              onChange={(value) => setManualFacts({ ...manualFacts, skills: value })}
            />
          </div>
        </section>

        <section className="product-panel" aria-labelledby="preferences-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">求职偏好</p>
              <h2 id="preferences-heading">我想优先考虑什么</h2>
            </div>
          </div>
          <div className="form-grid">
            <Field
              label="偏好城市（逗号分隔）"
              value={cities}
              onChange={setCities}
              placeholder="例如 深圳、广州"
            />
            <fieldset className="inline-options">
              <legend>岗位方向</legend>
              {(
                [
                  ["product", "产品"],
                  ["operations", "运营"],
                  ["other", "其他"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={jobFamilies.includes(value)}
                    onChange={(event) =>
                      setJobFamilies((current) =>
                        event.target.checked
                          ? [...new Set([...current, value])]
                          : current.filter((item) => item !== value),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>
        </section>

        <section className="product-panel" aria-labelledby="evidence-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">经历证据</p>
              <h2 id="evidence-heading">哪些经历可以被岗位解释引用</h2>
            </div>
            <span>{confirmedEvidence.length} 段已选择</span>
          </div>
          {result.candidateEvidence.length === 0 ? (
            <div className="product-callout is-warning">
              没有提取到可确认的经历段落。你仍可继续生成推荐；证据轴会保守显示“简历暂未体现”或“信息不足”。
            </div>
          ) : (
            <ul className="evidence-confirm-list">
              {result.candidateEvidence.map((item) => (
                <li key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedEvidence.has(item.id)}
                      onChange={(event) =>
                        setSelectedEvidence((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      <strong>{item.section}</strong>
                      <span>{item.originalText}</span>
                      {item.skills.length > 0 ? (
                        <small>识别技能：{item.skills.join("、")}</small>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {result.candidateEvidence.length > 0 && confirmedEvidence.length === 0 ? (
            <div className="product-callout is-warning evidence-empty-note">
              你尚未确认任何经历片段。可以继续，但系统不会把候选内容当作你的真实经历，证据轴也不会判为“有明确证据”。
            </div>
          ) : null}
        </section>

        <section className="confirmation-submit">
          <div>
            <strong>保存后立即删除简历原文件与原文</strong>
            <p>只保留你确认的结构化事实、偏好和证据，最长 30 天。</p>
          </div>
          <button
            className="button button--primary"
            type="submit"
            disabled={saveMutation.isPending || !privacyConfirmed}
          >
            {saveMutation.isPending ? "正在确认并删除原文…" : "确认资料并生成岗位推荐"}
          </button>
        </section>
        {saveMutation.isError ? (
          <ProductError title="资料没有保存成功" error={saveMutation.error} />
        ) : null}
      </form>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date";
  placeholder?: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...(placeholder ? { placeholder } : {})}
      />
    </label>
  );
}

function buildFacts(input: ManualFacts): ProfileFact[] {
  const facts: ProfileFact[] = [];
  if (input.currentStudent) {
    facts.push({ key: "current_student", value: input.currentStudent === "yes" });
  }
  const graduationYear = Number(input.graduationYear);
  if (graduationYear >= 1900 && graduationYear <= 2200) {
    facts.push({ key: "graduation_year", value: graduationYear });
  }
  if (input.currentCity.trim()) {
    facts.push({ key: "current_city", value: input.currentCity.trim() });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.availableFrom)) {
    facts.push({ key: "available_from", value: input.availableFrom });
  }
  const attendanceDays = Number(input.attendanceDays);
  if (attendanceDays >= 1 && attendanceDays <= 7) {
    facts.push({ key: "weekly_attendance_days", value: attendanceDays });
  }
  const durationMonths = Number(input.durationMonths);
  if (durationMonths >= 1 && durationMonths <= 36) {
    facts.push({ key: "duration_months", value: durationMonths });
  }
  if (input.educationLevel.trim()) {
    facts.push({ key: "education_level", value: input.educationLevel.trim() });
  }
  const majors = splitList(input.majors);
  if (majors.length > 0) facts.push({ key: "majors", value: majors });
  const skills = splitList(input.skills);
  if (skills.length > 0) facts.push({ key: "skills", value: skills });
  return facts;
}
