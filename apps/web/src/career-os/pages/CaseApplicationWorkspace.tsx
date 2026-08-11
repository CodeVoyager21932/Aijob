import type { ApplicationCaseWithJobContext } from "@aijob/contracts";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  careerOsQueryKeys,
  listApplicationCaseEvents,
  recordManualApplication,
} from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import {
  canRecordManualApplication,
  manualApplicationStatusCopy,
  toApplicationCaseEventView,
} from "../application-event-view";
import { Icon } from "../components/Icon";

function eventTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function officialUrl(applicationCase: ApplicationCaseWithJobContext): string | null {
  return "officialUrl" in applicationCase.jobContext
    ? (applicationCase.jobContext.officialUrl ?? null)
    : null;
}

export function CaseApplicationWorkspace({
  applicationCase,
}: {
  applicationCase: ApplicationCaseWithJobContext;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const commandRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  const eventsQuery = useInfiniteQuery({
    queryKey: careerOsQueryKeys.caseEvents(applicationCase.id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listApplicationCaseEvents(
        applicationCase.id,
        { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const mutation = useMutation({
    mutationFn: ({
      expectedRevision,
      idempotencyKey,
    }: {
      expectedRevision: number;
      idempotencyKey: string;
    }) => recordManualApplication(applicationCase.id, { expectedRevision }, idempotencyKey),
    retry: false,
    onSuccess: async () => {
      commandRef.current = null;
      setConfirming(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
        }),
        queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.caseList() }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseEvents(applicationCase.id),
        }),
      ]);
    },
    onError: async (error) => {
      if (error instanceof ProductApiError && error.code === "APPLICATION_CASE_REVISION_CONFLICT") {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
          }),
          queryClient.invalidateQueries({
            queryKey: careerOsQueryKeys.caseEvents(applicationCase.id),
          }),
        ]);
      }
    },
  });
  const events = useMemo(
    () => (eventsQuery.data?.pages ?? []).flatMap((page) => page.items),
    [eventsQuery.data?.pages],
  );
  const link = officialUrl(applicationCase);
  const canRecord = canRecordManualApplication(applicationCase.stage);
  const submit = () => {
    const signature = `${applicationCase.id}:${applicationCase.revision}`;
    if (commandRef.current?.signature !== signature) {
      commandRef.current = {
        signature,
        idempotencyKey: createIdempotencyKey("manual-application"),
      };
    }
    mutation.mutate({
      expectedRevision: applicationCase.revision,
      idempotencyKey: commandRef.current.idempotencyKey,
    });
  };
  const conflict =
    mutation.error instanceof ProductApiError &&
    mutation.error.code === "APPLICATION_CASE_REVISION_CONFLICT";

  return (
    <div className="career-application-workspace">
      <section className="career-application-handoff" aria-labelledby="application-handoff-title">
        <div>
          <p className="career-application-eyebrow">官方页面交接</p>
          <h2 id="application-handoff-title">由你完成最后提交</h2>
          <p>Aijob 不会替你填写、登录或提交。打开岗位页面只是交接动作，不会自动改成“已投递”。</p>
        </div>
        {link ? (
          <a
            className="career-button career-button--quiet"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            {applicationCase.jobContext.kind === "public" ? "打开官方投递页面" : "打开用户提供链接"}
            <Icon name="external" size={16} />
          </a>
        ) : (
          <div className="career-application-link-missing" role="note">
            当前固定岗位没有可用链接，请自行核验投递入口。
          </div>
        )}
      </section>

      <section
        className="career-application-confirmation"
        aria-labelledby="application-status-title"
      >
        <div>
          <p className="career-application-eyebrow">投递状态</p>
          <h2 id="application-status-title">{canRecord ? "等待你的确认" : "当前记录"}</h2>
          <p>{manualApplicationStatusCopy(applicationCase.stage)}</p>
        </div>
        {canRecord && !confirming ? (
          <button
            className="career-button career-button--primary"
            type="button"
            onClick={() => {
              mutation.reset();
              setConfirming(true);
            }}
          >
            我已在官方页面完成投递
          </button>
        ) : null}
        {canRecord && confirming ? (
          <fieldset className="career-application-confirmation__check" aria-label="确认投递状态">
            <strong>确认已经完成最终提交？</strong>
            <p>只有看到官方页面的提交成功提示后再确认。这个动作会进入求职时间线。</p>
            {mutation.isError ? (
              <div className="career-inline-error" role="alert">
                <strong>{conflict ? "项目状态已经变化" : "暂时无法保存投递记录"}</strong>
                <span>
                  {conflict
                    ? "已重新读取最新状态，请核对后再次确认。"
                    : mutation.error instanceof Error
                      ? mutation.error.message
                      : "请稍后重试。"}
                </span>
              </div>
            ) : null}
            <div>
              <button
                className="career-button career-button--primary"
                type="button"
                disabled={mutation.isPending}
                onClick={submit}
              >
                {mutation.isPending ? "正在保存…" : "确认已投递"}
              </button>
              <button
                className="career-button career-button--quiet"
                type="button"
                disabled={mutation.isPending}
                onClick={() => {
                  mutation.reset();
                  commandRef.current = null;
                  setConfirming(false);
                }}
              >
                取消
              </button>
            </div>
          </fieldset>
        ) : null}
      </section>

      <section className="career-application-timeline" aria-labelledby="application-timeline-title">
        <header>
          <div>
            <p className="career-application-eyebrow">Case 真源</p>
            <h2 id="application-timeline-title">求职时间线</h2>
          </div>
          <p>只记录用户动作和严格事件，不根据链接点击推断投递结果。</p>
        </header>
        {eventsQuery.isPending ? (
          <output className="career-request-state">正在读取求职时间线…</output>
        ) : null}
        {eventsQuery.isError ? (
          <div className="career-inline-error" role="alert">
            <strong>时间线暂时无法读取</strong>
            <span>
              {eventsQuery.error instanceof Error ? eventsQuery.error.message : "请稍后重试。"}
            </span>
            <button type="button" onClick={() => void eventsQuery.refetch()}>
              重试
            </button>
          </div>
        ) : null}
        {!eventsQuery.isPending && !eventsQuery.isError && events.length === 0 ? (
          <p className="career-application-timeline__empty">还没有可显示的求职记录。</p>
        ) : null}
        {events.length > 0 ? (
          <ol>
            {events.map((event) => {
              const view = toApplicationCaseEventView(event);
              return (
                <li key={event.id}>
                  <span aria-hidden="true" />
                  <div>
                    <header>
                      <strong>{view.title}</strong>
                      <time dateTime={event.createdAt}>{eventTime(event.createdAt)}</time>
                    </header>
                    <p>{view.detail}</p>
                    {view.legacyReadOnly ? <small>旧版只读记录</small> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
        {eventsQuery.hasNextPage ? (
          <button
            className="career-button career-button--quiet"
            type="button"
            disabled={eventsQuery.isFetchingNextPage}
            onClick={() => void eventsQuery.fetchNextPage()}
          >
            {eventsQuery.isFetchingNextPage ? "正在加载…" : "继续加载更早记录"}
          </button>
        ) : null}
      </section>
    </div>
  );
}
