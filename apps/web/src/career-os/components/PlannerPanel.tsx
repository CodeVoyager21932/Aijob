import type { PlannerItem } from "@aijob/contracts";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createIdempotencyKey, fileDownloadUrl } from "../../api/client";
import {
  coreKeys,
  getPlannerItems,
  putPlannerItem,
  removePlannerItem,
} from "../../api/product-core";
import {
  PlannerEditor,
  plannerFields,
  plannerKindLabels,
  plannerStatusLabels,
} from "./PlannerEditor";
import "../product-core.css";

function dayKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
function dueLabel(item: PlannerItem) {
  return item.dueAt
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(item.dueAt))
    : "尚未安排时间";
}
function section(item: PlannerItem) {
  if (item.status === "done") return "已完成";
  if (!item.dueAt) return "待安排";
  const due = new Date(item.dueAt),
    today = new Date();
  if (dayKey(due) === dayKey(today)) return "今天";
  return due < today ? "已过时间，待处理" : "接下来";
}
export function PlannerPanel({ caseId, compact = false }: { caseId?: string; compact?: boolean }) {
  const [status, setStatus] = useState<"open" | "all">("open");
  const [kind, setKind] = useState<PlannerItem["kind"] | "all">("all");
  const [editor, setEditor] = useState<PlannerItem | "new" | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<{ id: string; error: string | null }[]>([]);
  const keys = useRef(new Map<string, string>());
  const client = useQueryClient();
  const key = (value: string) => {
    if (!keys.current.has(value)) keys.current.set(value, createIdempotencyKey());
    return keys.current.get(value) as string;
  };
  const query = useInfiniteQuery({
    queryKey: [...coreKeys.planner, { caseId, status, kind, compact }],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      getPlannerItems(
        {
          caseId,
          status,
          kind: kind === "all" ? undefined : kind,
          offset: pageParam,
          limit: compact ? 6 : 50,
        },
        signal,
      ),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    refetchInterval: 60000,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const change = useMutation({
    mutationFn: async ({
      item,
      action,
    }: {
      item: PlannerItem;
      action: "complete" | "postpone" | "reopen" | "delete";
    }) => {
      const requestKey = key(`${action}:${item.id}:${item.revision}`);
      if (action === "delete") return removePlannerItem(item.id, item.revision, requestKey);
      const due =
        action === "postpone"
          ? new Date(
              Math.max(Date.now(), item.dueAt ? Date.parse(item.dueAt) : Date.now()) + 86400000,
            ).toISOString()
          : item.dueAt;
      return putPlannerItem(
        item.id,
        {
          ...plannerFields(item),
          expectedRevision: item.revision,
          dueAt: due,
          status: action === "complete" ? "done" : action === "reopen" ? "todo" : item.status,
        },
        requestKey,
      );
    },
    retry: false,
    onSuccess: async () => {
      setDeleteTarget(null);
      await client.invalidateQueries({ queryKey: coreKeys.planner });
    },
  });
  const batch = useMutation({
    mutationFn: async () => {
      const results: { id: string; error: string | null }[] = [];
      for (const item of items.filter(
        (value) => selected.includes(value.id) && value.status !== "done",
      )) {
        try {
          await putPlannerItem(
            item.id,
            { ...plannerFields(item), status: "done", expectedRevision: item.revision },
            key(`complete:${item.id}:${item.revision}`),
          );
          results.push({ id: item.id, error: null });
        } catch (error) {
          results.push({ id: item.id, error: error instanceof Error ? error.message : "保存失败" });
        }
      }
      return results;
    },
    retry: false,
    onSuccess: async (results) => {
      setOutcomes(results);
      setSelected(results.filter((item) => item.error).map((item) => item.id));
      await client.invalidateQueries({ queryKey: coreKeys.planner });
    },
  });
  const pending = change.isPending || batch.isPending;
  return (
    <section className="core-planner" aria-label={compact ? "近期安排" : "准备与日程"}>
      <header className="core-graph-section-head">
        <div>
          <h2>{compact ? "近期安排" : "准备与日程"}</h2>
          <p className="core-note">按北京时间排序；完成的事项会退出待办。</p>
        </div>
        <div className="core-actions">
          <button
            type="button"
            className="career-button career-button--primary"
            onClick={() => setEditor("new")}
          >
            添加事项
          </button>
          {compact ? (
            <Link to="/applications/planner">查看全部</Link>
          ) : (
            <a
              className="career-button"
              href={fileDownloadUrl("/v1/planner-calendar.ics")}
              download
            >
              导出日历 ICS
            </a>
          )}
        </div>
      </header>
      {!compact ? (
        <div className="core-graph-toolbar">
          <label>
            类型
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
                setSelected([]);
              }}
            >
              <option value="all">全部事项</option>
              {Object.entries(plannerKindLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={status === "all"}
              onChange={(event) => setStatus(event.target.checked ? "all" : "open")}
            />
            显示已完成
          </label>
          {selected.length ? (
            <button
              type="button"
              className="career-button"
              disabled={pending}
              onClick={() => batch.mutate()}
            >
              完成所选 {selected.length} 项
            </button>
          ) : null}
        </div>
      ) : null}
      {query.isPending ? (
        <output>正在读取安排…</output>
      ) : query.isError ? (
        <p role="alert">
          暂时无法读取事项。
          <button type="button" onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      ) : items.length === 0 ? (
        <div className="core-planner-empty">
          <strong>把下一步安排在这里</strong>
          <p>准备产物、笔试、面试、截止和跟进事项会按时间汇总。</p>
          <Link to="/jobs/insights">从方向图谱寻找准备重点</Link>
        </div>
      ) : null}
      {(["已过时间，待处理", "今天", "接下来", "待安排", "已完成"] as const).map((group) => {
        const groupItems = items.filter((item) => section(item) === group);
        return groupItems.length ? (
          <section key={group} className="core-planner-group">
            <h3>{group}</h3>
            <ul>
              {groupItems.map((item) => (
                <li key={item.id}>
                  {!compact && item.status !== "done" ? (
                    <label className="core-task-select">
                      <span className="sr-only">选择{item.title}</span>
                      <input
                        type="checkbox"
                        checked={selected.includes(item.id)}
                        onChange={(event) =>
                          setSelected((values) =>
                            event.target.checked
                              ? [...values, item.id]
                              : values.filter((id) => id !== item.id),
                          )
                        }
                      />
                    </label>
                  ) : null}
                  <div className="core-task-main">
                    <button
                      type="button"
                      className="core-task-title"
                      onClick={() => setEditor(item)}
                    >
                      {item.title}
                    </button>
                    <p>
                      {plannerKindLabels[item.kind]} ·{" "}
                      <time dateTime={item.dueAt ?? undefined}>{dueLabel(item)}</time> ·{" "}
                      {plannerStatusLabels[item.status]}
                    </p>
                    {item.note ? <p className="core-task-note">{item.note}</p> : null}
                    {item.artifact ? <small>已记录准备产物</small> : null}
                    <div className="core-actions">
                      {item.caseId ? (
                        <Link to={`/applications/${item.caseId}/overview`}>打开关联申请</Link>
                      ) : null}
                      {item.sourceExperienceIds.length ? (
                        <button type="button" onClick={() => setEditor(item)}>
                          查看关联的 {item.sourceExperienceIds.length} 段经历
                        </button>
                      ) : null}
                      {item.source ? (
                        <Link to={`/jobs/${item.source.jobId}`}>查看依据岗位</Link>
                      ) : null}
                    </div>
                  </div>
                  <div className="core-task-actions">
                    {item.status !== "done" ? (
                      <>
                        <button
                          type="button"
                          className="career-button"
                          disabled={pending}
                          onClick={() => change.mutate({ item, action: "complete" })}
                        >
                          完成
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => change.mutate({ item, action: "postpone" })}
                        >
                          延后一天
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => change.mutate({ item, action: "reopen" })}
                      >
                        重新打开
                      </button>
                    )}
                    {!compact ? (
                      deleteTarget === item.id ? (
                        <span>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => change.mutate({ item, action: "delete" })}
                          >
                            确认删除
                          </button>
                          <button type="button" onClick={() => setDeleteTarget(null)}>
                            取消
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setDeleteTarget(item.id)}>
                          删除
                        </button>
                      )
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null;
      })}
      {change.isError ? (
        <p role="alert" className="career-inline-error">
          {change.error instanceof Error ? change.error.message : "更新失败，请重试。"}
        </p>
      ) : null}
      {outcomes.length ? (
        <output className="core-note">
          批量处理：{outcomes.filter((item) => !item.error).length} 项完成，
          {outcomes.filter((item) => item.error).length} 项失败。
          {outcomes
            .filter((item) => item.error)
            .map((item) => (
              <p key={item.id}>{item.error}</p>
            ))}
        </output>
      ) : null}
      {!compact && query.hasNextPage ? (
        <button
          className="career-button"
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          读取更多事项
        </button>
      ) : null}
      {editor ? (
        <PlannerEditor
          {...(editor === "new" ? {} : { item: editor })}
          initial={{ caseId: caseId ?? null }}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </section>
  );
}
