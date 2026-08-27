import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { resumeSessionBootstrapAfterOwnerDeletion } from "../api/client";
import { getProfileDeletion } from "../api/product";
import { ProductError, ProductLoading } from "../components/ProductStates";

export function DeletionStatusPage() {
  const query = useQuery({
    queryKey: ["product", "profile-deletion"],
    queryFn: ({ signal }) => getProfileDeletion(signal),
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.status ?? "") ? 800 : false,
    retry: false,
  });
  if (query.isPending) return <ProductLoading label="正在查询删除状态" />;
  if (query.isError) {
    return (
      <ProductError
        title="删除回执无法读取"
        error={query.error}
        action={
          <Link
            className="button button--secondary"
            to="/jobs"
            onClick={resumeSessionBootstrapAfterOwnerDeletion}
          >
            返回岗位首页
          </Link>
        }
      />
    );
  }
  if (query.data.status === "queued" || query.data.status === "processing") {
    return <ProductLoading label="个人数据正在清理" />;
  }
  if (query.data.status === "failed") {
    return (
      <ProductError
        title="部分数据清理失败"
        error={new Error(query.data.failureCode || "后台会保留删除墓碑，请重试查询。")}
        action={
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void query.refetch()}
          >
            重新查询
          </button>
        }
      />
    );
  }
  return (
    <section className="deletion-success" aria-live="polite">
      <span aria-hidden="true">✓</span>
      <p className="eyebrow">删除完成</p>
      <h1>你的个人数据已清理</h1>
      <p>
        旧匿名会话已失效。返回岗位首页时会建立一个全新的本地匿名会话，旧任务不能恢复已删除数据。
      </p>
      <Link
        className="button button--primary"
        to="/jobs"
        onClick={resumeSessionBootstrapAfterOwnerDeletion}
      >
        重新浏览岗位
      </Link>
    </section>
  );
}
