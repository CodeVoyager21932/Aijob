import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  deleteProfile,
  getJobDecisions,
  getProfileDocument,
  getProfileEvidence,
  getProfileFacts,
  getProfilePreferences,
} from "../api/product";
import { ProductError, ProductLoading } from "../components/ProductStates";
import { clearDeletedOwnerCache } from "../product/privacy-cache";
import { clearJourneyState } from "../product/session-state";

export function DataControlPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [facts, preferences, evidence, document, decisions] = useQueries({
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
      {
        queryKey: ["product", "profile", "document"],
        queryFn: ({ signal }: { signal: AbortSignal }) => getProfileDocument(signal),
      },
      {
        queryKey: ["product", "decisions"],
        queryFn: ({ signal }: { signal: AbortSignal }) => getJobDecisions(signal),
      },
    ],
  });
  const deletion = useMutation({
    mutationFn: deleteProfile,
    onSuccess: () => {
      clearDeletedOwnerCache(queryClient);
      clearJourneyState();
      navigate("/data-control/deletion", { replace: true });
    },
  });
  const isLoading =
    facts.isPending ||
    preferences.isPending ||
    evidence.isPending ||
    document.isPending ||
    decisions.isPending;
  const evidenceCount =
    evidence.data && "evidence" in evidence.data ? evidence.data.evidence.length : 0;
  const documentBlockCount =
    document.data?.document?.sections.reduce(
      (total, section) => total + section.blocks.length,
      0,
    ) ?? 0;

  return (
    <>
      <header className="product-hero">
        <div>
          <p className="eyebrow">本机匿名数据控制</p>
          <h1>查看保留范围，或删除全部个人数据</h1>
          <p>删除会立即撤销当前匿名 owner 的访问，再由后台异步清理画像、证据、匹配、优化和决定。</p>
        </div>
      </header>
      {isLoading ? <ProductLoading label="正在读取本机数据范围" /> : null}
      {!isLoading ? (
        <section className="data-summary" aria-label="当前个人数据摘要">
          <article>
            <span>资格事实</span>
            <strong>{facts.data && "facts" in facts.data ? facts.data.facts.length : 0}</strong>
            <small>最长保留 30 天</small>
          </article>
          <article>
            <span>求职偏好</span>
            <strong>
              {preferences.data && "preferences" in preferences.data && preferences.data.preferences
                ? "已设置"
                : "未设置"}
            </strong>
            <small>最长保留 30 天</small>
          </article>
          <article>
            <span>经历证据</span>
            <strong>{evidenceCount}</strong>
            <small>{documentBlockCount} 个已保存结构化区块</small>
          </article>
          <article>
            <span>岗位决定</span>
            <strong>{decisions.data?.length ?? 0}</strong>
            <small>仅当前匿名会话可访问</small>
          </article>
        </section>
      ) : null}

      {!isLoading && document.data?.document ? (
        <section className="product-panel saved-data-actions" aria-labelledby="saved-data-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">继续使用，而不只是删除</p>
              <h2 id="saved-data-heading">已保存资料仍可用于下一次投递决定</h2>
            </div>
          </div>
          <p>
            你不需要重新上传原文件。资格事实、偏好和 {documentBlockCount} 个已确认结构化简历区块可在
            30 天内继续使用；也可以重新选择哪些区块算作经历证据。
          </p>
          {evidenceCount === 0 ? (
            <div className="product-callout is-warning">
              当前经历证据为
              0，这正是推荐页所有岗位都显示“简历暂未体现”的直接原因。资料没有丢失，你可以回到简历页重新勾选。
            </div>
          ) : null}
          <div className="saved-resume-actions">
            <button
              className="button button--primary"
              type="button"
              onClick={() => navigate("/resume")}
            >
              查看并调整已保存简历
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => navigate("/recommendations?start=1")}
            >
              沿用当前资料生成推荐
            </button>
          </div>
        </section>
      ) : null}

      <section className="product-panel retention-panel" aria-labelledby="retention-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">最小保留</p>
            <h2 id="retention-heading">系统保存什么</h2>
          </div>
        </div>
        <ul className="retention-list">
          <li>
            <strong>简历原文件与原文</strong>
            <span>确认经历证据后立即删除，任何情况下不超过 24 小时。</span>
          </li>
          <li>
            <strong>确认后的事实、偏好与经历证据</strong>
            <span>最长 30 天，用于可复现的匹配和简历修改依据。</span>
          </li>
          <li>
            <strong>确认后的结构化简历区块</strong>
            <span>最长 30 天，可查看、复用并重新选择证据；不会恢复已删除的原文件。</span>
          </li>
          <li>
            <strong>匹配、推荐、优化和投递决定</strong>
            <span>按当前匿名 owner 隔离，可与全部个人数据一起提前删除。</span>
          </li>
          <li>
            <strong>不含正文的删除审计</strong>
            <span>只保留删除时间和状态，不保留简历内容。</span>
          </li>
        </ul>
      </section>

      <section className="danger-zone" aria-labelledby="danger-heading">
        <p className="eyebrow">不可撤销</p>
        <h2 id="danger-heading">删除全部个人数据</h2>
        <p>删除后当前会话立即失效；旧页面和迟到任务不能恢复这些数据。岗位公共目录不会被删除。</p>
        <label className="consent-row">
          <input
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
          />
          我理解此操作不可撤销
        </label>
        <label className="full-field">
          <span>
            输入 <strong>删除我的数据</strong> 以确认
          </span>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          className="button button--danger"
          type="button"
          disabled={deletion.isPending || !understood || confirmation.trim() !== "删除我的数据"}
          onClick={() => deletion.mutate()}
        >
          {deletion.isPending ? "正在撤销访问…" : "永久删除全部个人数据"}
        </button>
        {deletion.isError ? <ProductError title="删除请求没有成功" error={deletion.error} /> : null}
      </section>
    </>
  );
}
