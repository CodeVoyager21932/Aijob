import type { MaterialSnippet } from "@aijob/contracts";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listMaterialSnippets, deleteMaterialSnippet, materialKeys } from "../../api/materials";
import { createIdempotencyKey } from "../../api/client";
import { MaterialSnippetEditor, snippetKindLabels } from "../components/MaterialReuseTools";
export function MaterialLibraryPage({embedded=false}:{embedded?:boolean}) {
  const query = useInfiniteQuery({
    queryKey: materialKeys.snippets,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => listMaterialSnippets(pageParam, signal),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const [edit, setEdit] = useState<MaterialSnippet | "new" | null>(null),
    [removeId, setRemoveId] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const remove = useMutation({
    mutationFn: (item: MaterialSnippet) => {
      const identity = `${item.id}:${item.revision}`;
      if (!keys.current.has(identity)) keys.current.set(identity, createIdempotencyKey());
      return deleteMaterialSnippet(item.id, item.revision, keys.current.get(identity) as string);
    },
    retry: false,
    onSuccess: async () => {
      setRemoveId(null);
      await client.invalidateQueries({ queryKey: materialKeys.snippets });
    },
  });
  return (
    <section className="core-material-library">
      {!embedded?<header className="career-page-heading">
        <div>
          <p className="core-eyebrow">常用表达，按场景复用</p>
          <h1>自我介绍与材料</h1>
          <p>保留项目长短版、邮件草稿和网申常用段落。</p>
        </div>
        <Link className="career-button" to="/resumes">
          返回简历材料
        </Link>
      </header>:null}
      <button
        type="button"
        className="career-button career-button--primary"
        onClick={() => setEdit("new")}
      >
        新建常用表达
      </button>
      {notice ? <output className="core-note">{notice}</output> : null}
      {query.isPending ? (
        <output>正在读取材料…</output>
      ) : query.isError ? (
        <p role="alert">
          材料暂时无法读取。
          <button type="button" onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      ) : query.data?.pages[0]?.items.length === 0 ? (
        <div className="career-empty-state">
          <h2>把反复填写的内容保存在这里</h2>
          <p>可以直接新建，也可以从简历中逐段保存。</p>
        </div>
      ) : null}
      {query.data?.pages
        .flatMap((page) => page.items)
        .map((item) => (
          <article className="core-snippet-card" key={item.id}>
            <header>
              <p className="core-eyebrow">{snippetKindLabels[item.kind]}</p>
              <h2>{item.title}</h2>
            </header>
            <textarea readOnly aria-label={`${item.title}正文`} rows={5} value={item.body} />
            <footer className="core-actions">
              <button
                className="career-button"
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(item.body)
                    .then(() => setNotice("材料已复制，请核对后使用。"))
                    .catch(() => setNotice("复制未获允许，可以在正文框中全选复制。"))
                }
              >
                复制正文
              </button>
              <button type="button" className="career-button" onClick={() => setEdit(item)}>
                编辑
              </button>
              {removeId === item.id ? (
                <>
                  <button
                    type="button"
                    className="career-button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(item)}
                  >
                    确认删除
                  </button>
                  <button type="button" className="career-button" onClick={() => setRemoveId(null)}>
                    取消
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="career-button"
                  onClick={() => setRemoveId(item.id)}
                >
                  删除
                </button>
              )}
            </footer>
          </article>
        ))}
      {remove.isError ? (
        <p role="alert">{remove.error instanceof Error ? remove.error.message : "删除失败"}</p>
      ) : null}
      {query.hasNextPage ? (
        <button type="button" className="career-button" onClick={() => void query.fetchNextPage()}>
          更多材料
        </button>
      ) : null}
      {edit ? (
        <MaterialSnippetEditor
          {...(edit === "new" ? {} : { item: edit })}
          onClose={() => setEdit(null)}
        />
      ) : null}
    </section>
  );
}
