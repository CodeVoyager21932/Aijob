import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getProfileDocument,
  getProfileEvidence,
  putSavedResumeEvidenceSelection,
  submitResumeFile,
  submitResumeText,
} from "../api/product";
import { JourneySteps, ProductError } from "../components/ProductStates";
import { shouldEnableCareerOsV2 } from "../environment";
import { detectBrowserPii, piiLabel } from "../product/domain";
import { writeJourneyId } from "../product/session-state";

const maximumBytes = 5 * 1024 * 1024;

type ResumeInputMode = "text" | "file";

export interface ResumeFormState {
  mode: ResumeInputMode;
  text: string;
  file: File | null;
  privacyChecked: boolean;
}

type ResumeFormAction =
  | { type: "select-mode"; mode: ResumeInputMode }
  | { type: "set-text"; text: string }
  | { type: "set-file"; file: File | null }
  | { type: "set-privacy"; checked: boolean };

export const initialResumeFormState: ResumeFormState = {
  mode: "text",
  text: "",
  file: null,
  privacyChecked: false,
};

export function resumeFormReducer(
  state: ResumeFormState,
  action: ResumeFormAction,
): ResumeFormState {
  switch (action.type) {
    case "select-mode":
      return action.mode === state.mode
        ? state
        : { ...state, mode: action.mode, privacyChecked: false };
    case "set-text":
      return { ...state, text: action.text, privacyChecked: false };
    case "set-file":
      return { ...state, file: action.file, privacyChecked: false };
    case "set-privacy":
      return { ...state, privacyChecked: action.checked };
  }
}

export function browserPrivacyState(
  mode: ResumeInputMode,
  findingCount: number,
): "file_not_read" | "pii_found" | "no_obvious_pii" {
  if (mode === "file") return "file_not_read";
  return findingCount > 0 ? "pii_found" : "no_obvious_pii";
}

export function ResumePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const careerOsV2Enabled = shouldEnableCareerOsV2({ flag: import.meta.env.VITE_CAREER_OS_V2 });
  const [{ mode, text, file, privacyChecked }, dispatch] = useReducer(
    resumeFormReducer,
    initialResumeFormState,
  );
  const browserFindings = useMemo(() => detectBrowserPii(text), [text]);
  const privacyState = browserPrivacyState(mode, browserFindings.length);
  const savedDocumentQuery = useQuery({
    queryKey: ["product", "profile", "document"],
    queryFn: ({ signal }) => getProfileDocument(signal),
  });
  const savedEvidenceQuery = useQuery({
    queryKey: ["product", "profile", "evidence"],
    queryFn: ({ signal }) => getProfileEvidence(signal),
  });
  const [selectedSavedBlocks, setSelectedSavedBlocks] = useState<Set<string>>(new Set());
  const initializedSavedSelection = useRef(false);
  const savedDocument = savedDocumentQuery.data?.document ?? null;
  const savedBlocks = useMemo(
    () =>
      savedDocument?.sections.flatMap((section) =>
        section.blocks.map((block) => ({ ...block, section: section.title })),
      ) ?? [],
    [savedDocument],
  );
  useEffect(() => {
    if (!savedEvidenceQuery.data || initializedSavedSelection.current) return;
    initializedSavedSelection.current = true;
    setSelectedSavedBlocks(
      new Set(
        ("evidence" in savedEvidenceQuery.data ? savedEvidenceQuery.data.evidence : []).flatMap(
          (item) => ("sourceBlockId" in item ? [item.sourceBlockId] : []),
        ),
      ),
    );
  }, [savedEvidenceQuery.data]);

  const reuseMutation = useMutation({
    mutationFn: async () => {
      if (!savedDocument || !savedEvidenceQuery.data) {
        throw new Error("已保存的简历资料尚未加载完成。");
      }
      return putSavedResumeEvidenceSelection({
        expectedRevision: savedEvidenceQuery.data.revision,
        documentRevisionId: savedDocument.id,
        sourceBlockIds: savedBlocks
          .filter((block) => selectedSavedBlocks.has(block.id))
          .map((block) => block.id),
      });
    },
    onSuccess: (revision) => {
      queryClient.setQueryData(["product", "profile", "evidence"], revision);
      navigate(careerOsV2Enabled ? "/resumes" : "/recommendations?start=1");
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!privacyChecked) {
        throw new Error("请先阅读并确认简历隐私处理方式。");
      }
      if (mode === "text") {
        if (text.trim().length < 20) throw new Error("请粘贴可解析的简历文本。");
        return submitResumeText(text);
      }
      if (!file) throw new Error("请选择 PDF 或 DOCX 简历。");
      if (file.size > maximumBytes) throw new Error("文件不能超过 5 MiB。");
      return submitResumeFile(file);
    },
    onSuccess: (analysis) => {
      writeJourneyId("analysisId", analysis.id);
      navigate(`/resume/confirm/${encodeURIComponent(analysis.id)}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <>
      <JourneySteps current={2} />
      <header className="product-hero">
        <div>
          <p className="eyebrow">需要个性化时再提供简历</p>
          <h1>上传简历，先确认事实与证据</h1>
          <p>支持 PDF、DOCX 或粘贴文本。原文件与原文在确认后立即删除，最迟不超过 24 小时。</p>
        </div>
      </header>

      {savedDocumentQuery.isPending || savedEvidenceQuery.isPending ? (
        <section className="product-panel saved-resume-panel">
          <p>正在读取已保存的简历资料…</p>
        </section>
      ) : savedDocument ? (
        <section
          className="product-panel saved-resume-panel"
          aria-labelledby="saved-resume-heading"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">已保存，可继续使用</p>
              <h2 id="saved-resume-heading">不用重复上传昨天的简历</h2>
            </div>
            <div className="saved-selection-summary">
              <span>
                已选择 {selectedSavedBlocks.size} / {savedBlocks.length} 段
              </span>
              <fieldset className="saved-selection-tools">
                <legend className="sr-only">批量选择简历内容</legend>
                <button
                  className="button button--secondary saved-selection-button"
                  type="button"
                  disabled={
                    savedBlocks.length === 0 || selectedSavedBlocks.size === savedBlocks.length
                  }
                  onClick={() =>
                    setSelectedSavedBlocks(new Set(savedBlocks.map((block) => block.id)))
                  }
                >
                  全选全部
                </button>
                <button
                  className="button button--secondary saved-selection-button"
                  type="button"
                  disabled={selectedSavedBlocks.size === 0}
                  onClick={() => setSelectedSavedBlocks(new Set())}
                >
                  清空选择
                </button>
              </fieldset>
            </div>
          </div>
          <p>
            原文件和原文已经按约定删除；下方是你确认后保留的结构化简历区块。职业资产默认长期保留，
            可以继续用于匹配、推荐和逐条优化，也可以由你主动删除。
          </p>
          {selectedSavedBlocks.size === 0 ? (
            <div className="product-callout is-warning">
              当前没有选择任何经历证据，所以推荐页只能显示“简历暂未体现”。请在下方勾选真实经历。
            </div>
          ) : null}
          <p className="saved-selection-note">
            可以一键全选，再取消个人信息、求职意向等不属于经历证据的区块；只有保存后才会生成新推荐。
          </p>
          <div className="saved-document-sections">
            {savedDocument.sections.map((section) => (
              <section key={section.id}>
                <h3>{section.title}</h3>
                <ul className="evidence-confirm-list">
                  {section.blocks.map((block) => (
                    <li key={block.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedSavedBlocks.has(block.id)}
                          onChange={(event) =>
                            setSelectedSavedBlocks((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(block.id);
                              else next.delete(block.id);
                              return next;
                            })
                          }
                        />
                        <span>{block.text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="saved-resume-actions">
            <button
              className="button button--primary"
              type="button"
              disabled={reuseMutation.isPending}
              onClick={() => reuseMutation.mutate()}
            >
              {reuseMutation.isPending ? "正在保存并重新匹配…" : "保存证据选择并生成最新推荐"}
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => navigate("/recommendations?start=1")}
            >
              不修改，直接沿用当前资料
            </button>
            <a className="text-link" href="#new-resume">
              上传新版简历
            </a>
          </div>
          {reuseMutation.isError ? (
            <ProductError title="已保存证据没有更新成功" error={reuseMutation.error} />
          ) : null}
        </section>
      ) : null}

      <form id="new-resume" className="resume-layout" onSubmit={submit}>
        <section className="product-panel" aria-labelledby="resume-input-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">1 / 3 输入</p>
              <h2 id="resume-input-heading">选择简历输入方式</h2>
            </div>
          </div>
          <fieldset className="segmented-control">
            <legend className="sr-only">简历输入方式</legend>
            <button
              className={mode === "text" ? "is-selected" : ""}
              type="button"
              aria-pressed={mode === "text"}
              onClick={() => dispatch({ type: "select-mode", mode: "text" })}
            >
              粘贴文本
            </button>
            <button
              className={mode === "file" ? "is-selected" : ""}
              type="button"
              aria-pressed={mode === "file"}
              onClick={() => dispatch({ type: "select-mode", mode: "file" })}
            >
              PDF / DOCX
            </button>
          </fieldset>

          {mode === "text" ? (
            <label className="full-field resume-text-field">
              <span>简历文本</span>
              <textarea
                rows={16}
                value={text}
                onChange={(event) => dispatch({ type: "set-text", text: event.target.value })}
                placeholder="粘贴简历正文。建议先删除姓名、手机号、邮箱、身份证号和详细地址。"
                maxLength={200_000}
              />
              <small>{text.length.toLocaleString()} / 200,000 字符</small>
            </label>
          ) : (
            <label className="file-drop">
              <span>选择 PDF 或 DOCX</span>
              <input
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) =>
                  dispatch({ type: "set-file", file: event.target.files?.[0] ?? null })
                }
              />
              <strong>{file?.name || "尚未选择文件"}</strong>
              <small>最大 5 MiB。不支持扫描件 OCR、图片、.doc、宏、加密或压缩文件。</small>
            </label>
          )}
        </section>

        <aside className="resume-side">
          <section className="product-panel" aria-labelledby="privacy-heading">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">2 / 3 隐私检查</p>
                <h2 id="privacy-heading">提交前先检查个人信息</h2>
              </div>
            </div>
            {privacyState === "file_not_read" ? (
              <div className="product-callout is-warning">
                <strong>浏览器未读取文件正文</strong>
                <p>
                  PDF/DOCX
                  会在本机服务端隔离解析并检测个人信息。提交后，你仍需检查去标识化文本，确认前不会发送给
                  AI。
                </p>
              </div>
            ) : privacyState === "pii_found" ? (
              <div className="product-callout is-warning" role="alert">
                <strong>浏览器检测到明显个人信息</strong>
                <ul>
                  {browserFindings.map((finding) => (
                    <li key={finding.kind}>
                      {piiLabel(finding.kind)} {finding.count} 处
                    </li>
                  ))}
                </ul>
                <p>建议先在输入框中删除。服务器还会再次检测并生成去标识化文本。</p>
              </div>
            ) : (
              <div className="product-callout">
                <strong>浏览器未发现手机号、邮箱或身份证号</strong>
                <p>这不是绝对保证，请仍然人工检查姓名与详细地址。</p>
              </div>
            )}
            <ul className="privacy-list">
              <li>文件仅在本机 PostgreSQL 中加密临时保存。</li>
              <li>原文件不会直接发送给 AI。</li>
              <li>你确认的事实、偏好和证据默认长期保留，由你主动删除。</li>
              <li>可以随时在“数据控制”删除全部个人数据。</li>
            </ul>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={privacyChecked}
                onChange={(event) =>
                  dispatch({ type: "set-privacy", checked: event.target.checked })
                }
              />
              我已检查并理解上述本地处理与删除方式
            </label>
          </section>

          <section className="product-panel resume-submit">
            <p className="eyebrow">3 / 3 解析</p>
            <h2>下一步由你逐项确认</h2>
            <p>解析结果不会直接参与匹配。未勾选、未确认的内容一律不使用。</p>
            <button
              className="button button--primary"
              type="submit"
              disabled={mutation.isPending || !privacyChecked}
            >
              {mutation.isPending ? "正在安全提交…" : "解析并检查简历"}
            </button>
            {mutation.isError ? (
              <ProductError title="简历没有提交成功" error={mutation.error} />
            ) : null}
          </section>
        </aside>
      </form>
    </>
  );
}
