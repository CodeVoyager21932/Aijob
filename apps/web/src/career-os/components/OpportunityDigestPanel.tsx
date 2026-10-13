import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import "./OpportunityDigestPanel.css";
import {
  getOpportunityDigests,
  markOpportunityDigestRead,
  opportunityKeys,
} from "../../api/opportunities";
const labels = {
  initial: "当前机会",
  new: "新增",
  updated: "内容更新",
  closed: "确认关闭",
  reopened: "恢复开放",
};
export function OpportunityDigestPanel() {
  const client = useQueryClient();
  const [offset, setOffset] = useState(0),
    [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const query = useQuery({
    queryKey: [...opportunityKeys.digests, offset],
    queryFn: () => getOpportunityDigests(offset),
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationFn: markOpportunityDigestRead,
    onSuccess: () => client.invalidateQueries({ queryKey: opportunityKeys.digests }),
  });
  return (
    <section
      className="career-today-tasks opportunity-digest-panel"
      aria-labelledby="opportunity-digest-title"
    >
      <header>
        <h2 id="opportunity-digest-title">值得看一眼的机会</h2>
        <Link to="/jobs">调整求职方向</Link>
      </header>
      {query.isPending ? (
        <p>正在读取岗位更新…</p>
      ) : query.isError ? (
        <p role="alert">
          岗位摘要暂时无法读取。
          <button type="button" onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      ) : !query.data?.items.length ? (
        <p>
          在「发现机会」保存并订阅方向，首次汇总会在后台准备，之后每天整理新增、变化和确认关闭的岗位。
        </p>
      ) : (
        query.data.items.map((digest) => (
          <article key={digest.id}>
            <h3>
              {digest.label}{" "}
              <small>
                {digest.localDate}
                {digest.readAt ? " · 已读" : ""}
              </small>
            </h3>
            <p>{digest.statusNote}</p>
            {!digest.items.length ? (
              <p>本次没有新的岗位变化，已有机会仍可在目录查看。</p>
            ) : (
              <ul>
                {digest.items.slice(0, expanded.has(digest.id) ? undefined : 12).map((item) => (
                  <li key={item.jobId}>
                    <span>{labels[item.kind]} · </span>
                    {item.kind === "closed" ? (
                      <span>{item.title}</span>
                    ) : (
                      <Link to={`/jobs/${item.jobId}`}>{item.title}</Link>
                    )}
                    <span> · {item.companyName}</span>
                    <p>
                      <small>{item.reason}</small>
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {digest.items.length > 12 ? (
              <p>
                共 {digest.items.length} 条，
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(digest.id)) next.delete(digest.id);
                      else next.add(digest.id);
                      return next;
                    })
                  }
                >
                  {expanded.has(digest.id) ? "收起" : "展开全部变化"}
                </button>
              </p>
            ) : null}
            {!digest.readAt ? (
              <button
                className="career-button"
                type="button"
                disabled={read.isPending}
                onClick={() => read.mutate(digest.id)}
              >
                标为已读
              </button>
            ) : null}
          </article>
        ))
      )}
      {read.isError ? <p role="alert">已读状态保存失败，请重试。</p> : null}
      {offset > 0 ? (
        <button
          type="button"
          className="career-button"
          onClick={() => setOffset(Math.max(0, offset - 10))}
        >
          较新的摘要
        </button>
      ) : null}
      {query.data?.nextOffset != null ? (
        <button
          type="button"
          className="career-button"
          onClick={() => setOffset(query.data?.nextOffset ?? offset)}
        >
          更早的摘要
        </button>
      ) : null}
    </section>
  );
}
