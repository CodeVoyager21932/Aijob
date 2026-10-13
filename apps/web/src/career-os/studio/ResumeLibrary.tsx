import { useWorkspaceDraft } from "../use-workspace-draft";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { deleteResumeDocument, listResumeDocuments } from "../../api/career-os";
import { apiRequest, createIdempotencyKey } from "../../api/client";
import { Icon } from "../components/Icon";
import "./studio.css";
export function ResumeLibrary() {
  return <Library />;
}
function Library() {
  const [params] = useSearchParams();
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const creating = useRef(false);
  const navigate = useNavigate(),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [showExperiences, setShowExperiences] = useState(false),
    [selected, setSelected] = useWorkspaceDraft<string[]>("resume-library:selected", []),
    [search, setSearch] = useWorkspaceDraft("resume-library:search", "");
  const docs = useInfiniteQuery({
    queryKey: ["career-os", "resume-library"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listResumeDocuments({ limit: 100, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    getNextPageParam: (page) => page.nextCursor,
  });
  const experiences = useQuery({
    queryKey: ["career-os", "native-reusable-experiences"],
    queryFn: () =>
      apiRequest<{ id: string; title: string; legacy?: boolean }[]>(
        "/v2/native-experiences?includeLegacy=true",
      ),
    enabled: showExperiences,
  });
  async function create(ids?: string[], tool?: "import") {
    if (creating.current) return;
    creating.current = true;
    setBusy(true);
    setNotice("");
    try {
      const body = { title: "我的简历", ...(ids ? { experienceIds: ids } : {}) };
      const fingerprint = JSON.stringify(body);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, key: createIdempotencyKey() };
      const d = await apiRequest<{ documentId: string }>("/v2/resume-documents/native", {
        method: "POST",
        body,
        idempotencyKey: request.current.key,
      });
      navigate(`/resumes/${d.documentId}${tool ? "?tool=import" : ""}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "暂时无法创建，请重试。");
    } finally {
      setBusy(false);
      creating.current = false;
    }
  }
  const [deleteId, setDeleteId] = useState<string | null>(null);
  return (
    <section className="studio-library resume-studio">
      <header className="studio-library-heading">
        <div>
          <p>做准备 / 我的简历</p>
          <h1>我的简历</h1>
          <p>通用简历、方向稿和已保存版本，都从这里继续。</p>
        </div>
      </header>
      <div className="studio-entry-options">
        <button type="button" disabled={busy} onClick={() => void create()}>
          <span>
            <Icon name="document" size={22} />
          </span>
          <strong>从空白开始</strong>
          <small>先写已有的内容，边写边完善</small>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void create(undefined, "import")}
          data-entry-highlight={params.get("start") === "import"}
        >
          <span>
            <Icon name="external" size={22} />
          </span>
          <strong>导入已有简历</strong>
          <small>读取 PDF、DOCX 内容，整理成可编辑的新稿</small>
        </button>
        <button
          type="button"
          aria-expanded={showExperiences}
          onClick={() => setShowExperiences(!showExperiences)}
        >
          <span>
            <Icon name="book" size={22} />
          </span>
          <strong>使用已有经历</strong>
          <small>选择经历，组成一份新简历</small>
        </button>
      </div>
      {notice ? (
        <p className="studio-alert" role="alert">
          {notice}
        </p>
      ) : null}
      {showExperiences ? (
        <div className="studio-library-picker">
          <h2>选择要加入的经历</h2>
          {experiences.isPending && <output>正在读取经历…</output>}
          {experiences.isError && (
            <p role="alert">
              经历暂时无法读取。
              <button type="button" onClick={() => void experiences.refetch()}>
                重试
              </button>
            </p>
          )}
          {experiences.data?.length === 0 ? <p>还没有积累经历。可以从空白或导入开始。</p> : null}
          {experiences.data?.map((e) => (
            <label key={e.id}>
              <input
                type="checkbox"
                checked={selected.includes(e.id)}
                onChange={() =>
                  setSelected((ids) =>
                    ids.includes(e.id) ? ids.filter((id) => id !== e.id) : [...ids, e.id],
                  )
                }
              />
              {e.title}
              {e.legacy && <small>已保存的经历</small>}
            </label>
          ))}
          <button
            type="button"
            className="studio-primary"
            disabled={busy || !selected.length}
            onClick={() => void create(selected)}
          >
            用这些经历开始
          </button>
        </div>
      ) : null}
      <div className="studio-library-toolbar">
        <h2>继续编辑</h2>
        <input
          aria-label="查找我的简历"
          placeholder="按名称查找"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {docs.isPending ? (
        <output>正在读取简历…</output>
      ) : docs.isError ? (
        <p role="alert">
          暂时无法读取简历。
          <button type="button" onClick={() => void docs.refetch()}>
            重试
          </button>
        </p>
      ) : null}
      {docs.isSuccess && !docs.data.pages.flatMap((p) => p.items).length && (
        <div className="studio-library-empty">
          <Icon name="document" size={32} />
          <h3>从你已经有的内容开始</h3>
          <p>课程项目、社团活动和实习都可以写。先完成一份，再按不同方向复制调整。</p>
        </div>
      )}
      {docs.isSuccess &&
        docs.data.pages.flatMap((p) => p.items).length > 0 &&
        !docs.data.pages.flatMap((p) => p.items).some((d) => d.title.includes(search)) && (
          <p>
            当前已加载的简历中没有找到“{search}”。可以修改关键词
            {docs.hasNextPage ? "或继续加载更多简历" : ""}。
          </p>
        )}
      <div className="studio-document-grid">
        {docs.data?.pages
          .flatMap((p) => p.items)
          .filter((d) => d.title.includes(search))
          .map((d) => (
            <article key={d.id} className="studio-document-card">
              <Link to={`/resumes/${d.id}`}>
                <span className="studio-document-icon" aria-hidden="true">
                  ▤
                </span>
                <h3>{d.title}</h3>
                <p>{d.kind === "case_derived" ? "岗位稿" : "通用 / 方向稿"}</p>
                <small>更新于 {new Date(d.updatedAt).toLocaleDateString("zh-CN")}</small>
              </Link>
              <div>
                <Link to={`/resumes/${d.id}`}>继续编辑 →</Link>
                <button
                  type="button"
                  onClick={() =>
                    deleteId !== d.id
                      ? setDeleteId(d.id)
                      : void (async () => {
                          setNotice("");
                          try {
                            await deleteResumeDocument(d.id, { expectedRevision: d.revision });
                            setDeleteId(null);
                            await docs.refetch();
                          } catch (e) {
                            setNotice(e instanceof Error ? e.message : "删除失败");
                          }
                        })()
                  }
                >
                  {deleteId === d.id ? "确认删除简历和原件" : "删除"}
                </button>
                {deleteId === d.id ? (
                  <button type="button" onClick={() => setDeleteId(null)}>
                    保留
                  </button>
                ) : null}
              </div>
            </article>
          ))}
      </div>
      {docs.hasNextPage ? (
        <button type="button" onClick={() => void docs.fetchNextPage()}>
          查看更多简历
        </button>
      ) : null}
    </section>
  );
}
