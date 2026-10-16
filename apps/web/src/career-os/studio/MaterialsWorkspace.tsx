import { type ExperienceRecord, resumeRichPlain } from "@aijob/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest, createIdempotencyKey } from "../../api/client";
import { deleteExperience, getExperiences } from "../../api/resume-studio";
import { MaterialSnippetEditor } from "../components/MaterialReuseTools";
import {
  NativeExperienceEditor,
  type NativeExperienceRecord,
} from "../native/NativeExperienceEditor";
import { MaterialLibraryPage } from "../pages/MaterialLibraryPage";
import { useWorkspaceDraft } from "../use-workspace-draft";
import { ExperienceEditor, experienceKindNames } from "./ExperienceEditor";
import "../native/native-studio.css";
import "./studio.css";

export function MaterialsWorkspace() {
  const [params, setParams] = useSearchParams(),
    view = params.get("view") === "expressions" ? "expressions" : "experiences",
    navigate = useNavigate();
  const query = useQuery({ queryKey: ["career-os", "experiences"], queryFn: getExperiences });
  const nativeQuery = useQuery({
    queryKey: ["career-os", "experiences", "native"],
    queryFn: () => apiRequest<NativeExperienceRecord[]>("/v2/native-experiences"),
  });
  const [nativeEdit, setNativeEdit] = useState<NativeExperienceRecord | null>(null);
  const [nativeExpression, setNativeExpression] = useState<NativeExperienceRecord | null>(null);
  const plainNative = (item: NativeExperienceRecord) =>
    new DOMParser().parseFromString(
      item.experience.entry.description.replace(/<\/(p|li)>/g, "$&\n"),
      "text/html",
    ).body.textContent ?? "";
  const [edit, setEdit] = useState<ExperienceRecord | "new" | null>(null),
    [expression, setExpression] = useState<ExperienceRecord | null>(null),
    [search, setSearch] = useWorkspaceDraft("materials:search", ""),
    [selected, setSelected] = useWorkspaceDraft<string[]>("materials:selected", []),
    [remove, setRemove] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const experienceId = params.get("experienceId");
  useEffect(() => {
    if (!experienceId || !query.data || !nativeQuery.data) return;
    const found = query.data.items.find((item) => item.id === experienceId);
    if (found) setEdit(found);
    else {
      const native = nativeQuery.data.find((item) => item.id === experienceId);
      if (native) setNativeEdit(native);
      else setNotice("这段经历已删除或不在当前账户中。");
    }
    const next = new URLSearchParams(params);
    next.delete("experienceId");
    next.set("view", "experiences");
    setParams(next, { replace: true });
  }, [experienceId, query.data, nativeQuery.data, params, setParams]);
  const items =
    query.data?.items.filter((item) =>
      `${item.title} ${item.entry.organization} ${resumeRichPlain(item.entry.body)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  const nativeCreation = useRef<{ id: string; key: string } | null>(null);
  const selectedCreation = useRef<{ ids: string; key: string } | null>(null);
  async function resumeFromNative(item: NativeExperienceRecord) {
    setBusy(true);
    setNotice("");
    if (nativeCreation.current?.id !== item.id)
      nativeCreation.current = { id: item.id, key: createIdempotencyKey() };
    try {
      const draft = await apiRequest<{ documentId: string }>("/v2/resume-documents/native", {
        method: "POST",
        idempotencyKey: nativeCreation.current.key,
        body: { title: `${item.title} · 方向简历`, experienceIds: [item.id] },
      });
      navigate(`/resumes/native/${draft.documentId}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建未完成，可以重试。");
    } finally {
      setBusy(false);
    }
  }
  const nativeItems =
    nativeQuery.data?.filter((item) =>
      `${item.title} ${plainNative(item)}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  async function makeResume(ids: string[]) {
    setBusy(true);
    try {
      const fingerprint = JSON.stringify(ids);
      if (selectedCreation.current?.ids !== fingerprint)
        selectedCreation.current = { ids: fingerprint, key: createIdempotencyKey() };
      const draft = await apiRequest<{ documentId: string }>("/v2/resume-documents/native", {
        method: "POST",
        idempotencyKey: selectedCreation.current.key,
        body: { title: "基于已有经历的简历", experienceIds: ids },
      });
      navigate(`/resumes/native/${draft.documentId}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建失败，选择仍保留。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="resume-studio materials-workspace">
      <header className="career-page-heading">
        <div>
          <p>做准备</p>
          <h1>经历与材料</h1>
          <p>
            经历记录你做过的事，常用表达按自我介绍、项目讲述和邮件等用途组织。随时取用，继续完善。
          </p>
        </div>
        <Link className="career-button" to="/assistant?task=experience">
          和助手整理一段经历
        </Link>
      </header>
      <nav className="materials-tabs" aria-label="材料视图">
        <button
          type="button"
          aria-current={view === "experiences" ? "page" : undefined}
          onClick={() => setParams({ view: "experiences" })}
        >
          我的经历
        </button>
        <button
          type="button"
          aria-current={view === "expressions" ? "page" : undefined}
          onClick={() => setParams({ view: "expressions" })}
        >
          常用表达
        </button>
      </nav>
      {notice ? <output className="studio-alert">{notice}</output> : null}
      {view === "expressions" ? (
        <MaterialLibraryPage embedded />
      ) : (
        <>
          <div className="materials-toolbar">
            <input
              aria-label="查找经历"
              placeholder="查找项目、企业或做过的事"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="studio-primary" onClick={() => setEdit("new")}>
              新增经历
            </button>
            <button
              type="button"
              disabled={busy || !selected.length}
              onClick={() => void makeResume(selected)}
            >
              用所选经历写简历{selected.length ? `（${selected.length}）` : ""}
            </button>
            {selected.length ? (
              <Link
                className="career-button"
                to={`/assistant?task=expression&experienceIds=${selected.join(",")}`}
              >
                组合成一份表达
              </Link>
            ) : null}
          </div>
          {query.isPending ? (
            <output>正在读取经历…</output>
          ) : query.isError ? (
            <p role="alert">
              经历读取失败。
              <button type="button" onClick={() => void query.refetch()}>
                重试
              </button>
            </p>
          ) : !items.length && !nativeItems.length && !nativeQuery.isPending ? (
            <div className="career-empty-state">
              <h2>{search ? "没有找到这段经历" : "写过的经历，会逐渐积累在这里"}</h2>
              <p>导入简历或新增项目时会自动收录。也可以现在写下一段经历，或直接从空白简历开始。</p>
              <Link className="career-button" to="/resumes">
                去写简历
              </Link>
            </div>
          ) : null}
          {nativeQuery.isError && (
            <p role="alert">
              部分经历未能读取。
              <button type="button" onClick={() => void nativeQuery.refetch()}>
                重试读取
              </button>
            </p>
          )}
          <div className="experience-library">
            {nativeItems.map((item) => (
              <article className="experience-library-card" key={item.id}>
                <header>
                  <label className="experience-select">
                    <input
                      aria-label={`选择${item.title}`}
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() =>
                        setSelected((ids) =>
                          ids.includes(item.id)
                            ? ids.filter((id) => id !== item.id)
                            : [...ids, item.id],
                        )
                      }
                    />
                    加入简历
                  </label>
                  <span>{experienceKindNames[item.experience.kind]}</span>
                  <h2>{item.title}</h2>
                  <p>
                    {[
                      item.experience.entry.role,
                      item.experience.entry.position,
                      item.experience.entry.period,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </header>
                <details className="experience-body-details">
                  <summary>
                    {plainNative(item).slice(0, 110)}
                    {plainNative(item).length > 110 ? "… 展开全文" : ""}
                  </summary>
                  <div className="experience-body">{plainNative(item)}</div>
                </details>
                <footer>
                  <button type="button" onClick={() => setNativeEdit(item)}>
                    编辑原稿
                  </button>
                  <button type="button" disabled={busy} onClick={() => void resumeFromNative(item)}>
                    用这段经历写简历
                  </button>
                  <details className="experience-more">
                    <summary>更多操作</summary>
                    <div>
                      <button type="button" onClick={() => setNativeExpression(item)}>
                        整理为常用表达
                      </button>
                      <Link to={`/assistant?task=experience&experienceId=${item.id}`}>
                        和助手整理
                      </Link>
                      <Link to={`/assistant?task=interview&experienceId=${item.id}`}>
                        练习讲这段经历
                      </Link>
                      <button type="button" onClick={() => setRemove(item.id)}>
                        删除
                      </button>
                    </div>
                  </details>
                </footer>
                {remove === item.id && (
                  <div className="studio-alert">
                    <p>删除这段经历原稿？已经写入简历和表达的内容保留。</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void deleteExperience(item.id)
                          .then(async () => {
                            setRemove(null);
                            await nativeQuery.refetch();
                          })
                          .catch((error) => setNotice(error.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      删除经历
                    </button>
                    <button type="button" onClick={() => setRemove(null)}>
                      保留
                    </button>
                  </div>
                )}
              </article>
            ))}
            {items.map((item) => (
              <article key={item.id} className="experience-library-card">
                <header>
                  <label>
                    <input
                      aria-label={`选择${item.title}`}
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() =>
                        setSelected((ids) =>
                          ids.includes(item.id)
                            ? ids.filter((id) => id !== item.id)
                            : [...ids, item.id],
                        )
                      }
                    />
                    <span>{experienceKindNames[item.kind]}</span>
                  </label>
                  <h2>{item.title}</h2>
                  <p>
                    {[
                      item.entry.organization,
                      item.entry.role,
                      [item.entry.startDate, item.entry.endDate].filter(Boolean).join(" – "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </header>
                <div className="experience-body">{resumeRichPlain(item.entry.body)}</div>
                <footer>
                  <button type="button" onClick={() => setEdit(item)}>
                    编辑原稿
                  </button>
                  <button type="button" onClick={() => setExpression(item)}>
                    整理为常用表达
                  </button>
                  <Link to={`/assistant?task=interview&experienceId=${item.id}`}>
                    练习讲这段经历
                  </Link>
                  <button type="button" onClick={() => setRemove(item.id)}>
                    删除
                  </button>
                </footer>
                {remove === item.id ? (
                  <div className="studio-alert">
                    <p>删除这段经历原稿？已经写入简历和表达的内容保留。</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void deleteExperience(item.id)
                          .then(async () => {
                            setRemove(null);
                            setSelected((ids) => ids.filter((id) => id !== item.id));
                            await query.refetch();
                          })
                          .catch((error) => setNotice(error.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      删除经历
                    </button>
                    <button type="button" onClick={() => setRemove(null)}>
                      保留
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </>
      )}
      {nativeEdit && (
        <NativeExperienceEditor
          item={nativeEdit}
          close={() => setNativeEdit(null)}
          saved={() => void nativeQuery.refetch()}
        />
      )}
      {nativeExpression && (
        <MaterialSnippetEditor
          initial={{
            title: nativeExpression.title,
            kind: "project_short",
            body: plainNative(nativeExpression),
            sourceExperienceIds: [nativeExpression.id],
          }}
          onClose={() => setNativeExpression(null)}
        />
      )}
      {edit ? (
        <ExperienceEditor
          {...(edit === "new" ? {} : { item: edit })}
          onClose={() => setEdit(null)}
        />
      ) : null}
      {expression ? (
        <MaterialSnippetEditor
          initial={{
            title: expression.title,
            kind: "project_short",
            body: resumeRichPlain(expression.entry.body),
            sourceExperienceIds: [expression.id],
          }}
          onClose={() => setExpression(null)}
        />
      ) : null}
    </section>
  );
}
