import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ProductApiError, resumeSessionBootstrapAfterOwnerDeletion } from "../../api/client";
import { getProfileDeletion } from "../../api/product";
import { Icon } from "../components/Icon";

function statusTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function CareerDeletionStatusPage() {
  const query = useQuery({
    queryKey: ["product", "profile-deletion"],
    queryFn: ({ signal }) => getProfileDeletion(signal),
    refetchInterval: (currentQuery) =>
      ["queued", "processing"].includes(currentQuery.state.data?.status ?? "") ? 1_000 : false,
    retry: false,
  });
  const deletion = query.data;
  const inProgress = deletion?.status === "queued" || deletion?.status === "processing";
  const failed = deletion?.status === "failed";
  const succeeded = deletion?.status === "succeeded";
  const receiptMissing =
    query.error instanceof ProductApiError &&
    (query.error.status === 401 || query.error.status === 404);

  return (
    <section className="career-deletion-status" aria-labelledby="career-deletion-title">
      <header className="career-page-heading">
        <div>
          <p>数据与设置</p>
          <h1 id="career-deletion-title">个人数据删除回执</h1>
          <span>本页只使用删除回执查询状态，不会为了轮询创建新的 owner 或恢复旧会话。</span>
        </div>
      </header>

      <article
        className="career-deletion-status__card"
        data-status={
          query.isPending ? "pending" : query.isError ? "error" : deletion?.status ?? "unknown"
        }
        aria-live="polite"
      >
        <span className="career-deletion-status__icon" aria-hidden="true">
          <Icon name={succeeded ? "check" : failed || query.isError ? "warning" : "settings"} />
        </span>
        <div>
          <p>
            {query.isPending
              ? "正在查询"
              : inProgress
                ? "删除处理中"
                : succeeded
                  ? "删除完成"
                  : failed
                    ? "需要重新检查"
                    : "回执不可用"}
          </p>
          <h2>
            {query.isPending
              ? "正在读取删除状态"
              : inProgress
                ? "个人数据正在按范围清理"
                : succeeded
                  ? "旧 owner 的个人数据已清理"
                  : failed
                    ? "部分数据清理没有完成"
                    : receiptMissing
                      ? "没有找到可用的删除回执"
                      : "暂时无法读取删除状态"}
          </h2>
          <p className="career-deletion-status__description">
            {query.isPending || inProgress
              ? "请保留此页面。系统会继续使用不含个人正文的回执轮询，完成后自动更新。"
              : succeeded
                ? "旧匿名会话已经失效。只有在你主动返回岗位页时，系统才会建立一个全新的本地匿名 owner。"
                : failed
                  ? `删除墓碑仍然保留，失败代码：${deletion.failureCode ?? "未说明"}。系统不会恢复已经删除的数据。`
                  : receiptMissing
                    ? "回执可能已过期、已被清除或不属于当前浏览器；系统不会据此恢复旧 owner。"
                    : query.error instanceof Error
                      ? query.error.message
                      : "请稍后重新查询。"}
          </p>
          {deletion ? (
            <dl>
              <div>
                <dt>请求时间</dt>
                <dd>{statusTime(deletion.requestedAt)}</dd>
              </div>
              <div>
                <dt>最近更新</dt>
                <dd>{statusTime(deletion.updatedAt)}</dd>
              </div>
              {deletion.completedAt ? (
                <div>
                  <dt>完成时间</dt>
                  <dd>{statusTime(deletion.completedAt)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      </article>

      <aside className="career-deletion-status__boundary">
        <Icon name="warning" size={19} />
        <div>
          <strong>公共岗位目录不会随个人数据删除</strong>
          <span>删除范围只覆盖当前 owner 的个人资料、Case、简历、面试、复盘及兼容历史。</span>
        </div>
      </aside>

      <div className="career-deletion-status__actions">
        {query.isError || failed ? (
          <button
            className="career-button career-button--quiet"
            type="button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? "正在重新查询…" : "重新查询回执"}
          </button>
        ) : null}
        {succeeded || receiptMissing ? (
          <Link
            className="career-button career-button--primary"
            to="/jobs"
            onClick={resumeSessionBootstrapAfterOwnerDeletion}
          >
            以全新身份浏览岗位
          </Link>
        ) : null}
      </div>
    </section>
  );
}
