import {
  CreateMaterialSnippetRequestSchema,
  JobGraphScopeSchema,
  type CreateMaterialSnippetRequest,
  type MaterialSnippet,
  type ResumeDocument,
  type ResumeSemanticContent,
} from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createResumeDocument, careerOsQueryKeys } from "../../api/career-os";
import { createIdempotencyKey } from "../../api/client";
import { createMaterialSnippet, updateMaterialSnippet, materialKeys } from "../../api/materials";
import { getExperiences } from "../../api/resume-studio";
import { jobFamilyLabels } from "../../product/domain";
import { ModalSurface } from "./ModalSurface";
import "../product-core.css";
export const snippetKindLabels = {
  introduction: "自我介绍",
  project_long: "项目长版",
  project_short: "项目短版",
  email: "邮件草稿",
  other: "其他材料",
};
export function MaterialSnippetEditor({
  item,
  initial,
  onClose,
}: {
  item?: MaterialSnippet;
  initial?: Partial<CreateMaterialSnippetRequest>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CreateMaterialSnippetRequest>({
    kind: item?.kind ?? "introduction",
    title: item?.title ?? "自我介绍",
    body: item?.body ?? "",
    sourceDocumentId: item?.sourceDocumentId ?? null,
    sourceContentRevisionId: item?.sourceContentRevisionId ?? null,
    sourceBlockIds: item?.sourceBlockIds ?? [],
    sourceExperienceIds: item?.sourceExperienceIds ?? [],
    ...initial,
  });
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const command = useRef<{ hash: string; key: string } | null>(null);
  const client = useQueryClient();
  const experiences=useQuery({queryKey:["career-os","experiences"],queryFn:getExperiences});
  const save = useMutation({
    mutationFn: ({ request, key }: { request: CreateMaterialSnippetRequest; key: string }) =>
      item
        ? updateMaterialSnippet(item.id, { ...request, expectedRevision: item.revision }, key)
        : createMaterialSnippet(request, key),
    retry: false,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: materialKeys.snippets });
      onClose();
    },
  });
  return (
    <ModalSurface
      className="core-editor"
      ariaLabel="编辑复用材料"
      initialFocusRef={titleRef}
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel="关闭材料编辑"
    >
      <form
        className="core-form"
        onSubmit={(event) => {
          event.preventDefault();
          const result = CreateMaterialSnippetRequestSchema.safeParse(draft);
          if (!result.success) {
            setError("请填写标题和正文，正文最多 2 万字。");
            return;
          }
          setError("");
          const hash = JSON.stringify(result.data);
          if (command.current?.hash !== hash)
            command.current = { hash, key: createIdempotencyKey() };
          save.mutate({ request: result.data, key: command.current.key });
        }}
      >
        <header>
          <p className="core-eyebrow">减少重复填写</p>
          <h2>{item ? "编辑材料" : "保存复用材料"}</h2>
        </header>
        <label>
          材料名称
          <input
            ref={titleRef}
            required
            maxLength={200}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label>
          用途
          <select
            value={draft.kind}
            onChange={(event) =>
              setDraft({
                ...draft,
                kind: event.target.value as CreateMaterialSnippetRequest["kind"],
              })
            }
          >
            {Object.entries(snippetKindLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          正文
          <textarea
            rows={12}
            required
            maxLength={20000}
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            placeholder={
              draft.kind === "email"
                ? "收件人您好：\n我希望申请【岗位】，相关经历是【相关经历】。附件为简历，感谢阅读。"
                : "写下你实际做过的事，再按使用场景调整长短。"
            }
          />
        </label>
        <details><summary>关联使用的经历（可选）</summary>{experiences.data?.items.map((e)=><label key={e.id}><input type="checkbox" checked={draft.sourceExperienceIds?.includes(e.id)??false} onChange={()=>setDraft({...draft,sourceExperienceIds:draft.sourceExperienceIds?.includes(e.id)?draft.sourceExperienceIds.filter((id)=>id!==e.id):[...(draft.sourceExperienceIds??[]),e.id]})}/>{e.title}</label>)}</details>
        <p className="core-note">
          材料保存后可以复制到网申或邮件中；每次使用前请核对岗位、称呼与附件。
        </p>
        {error || save.isError ? (
          <p role="alert">
            {error || (save.error instanceof Error ? save.error.message : "保存失败")}
          </p>
        ) : null}
        <footer>
          <button
            className="career-button"
            type="button"
            disabled={save.isPending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="submit"
            className="career-button career-button--primary"
            disabled={save.isPending}
          >
            {save.isPending ? "正在保存…" : "保存材料"}
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
}
export function MaterialReuseTools({
  document,
  contentRevisionId,
  layoutRevisionId,
  content,
  disabled,
}: {
  document: ResumeDocument;
  contentRevisionId: string;
  layoutRevisionId: string;
  content: ResumeSemanticContent;
  disabled: boolean;
}) {
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTitle, setCopyTitle] = useState(`${document.title} · 方向稿`);
  const [family, setFamily] = useState("");
  const [snippet, setSnippet] = useState<Partial<CreateMaterialSnippetRequest> | null>(null);
  const [notice, setNotice] = useState("");
  const command = useRef<{ hash: string; key: string } | null>(null);
  const client = useQueryClient(),
    navigate = useNavigate();
  const copy = useMutation({
    mutationFn: () => {
      const request = {
        kind: "base" as const,
        title: copyTitle,
        directionScope: JobGraphScopeSchema.parse(family ? { jobFamily: family } : {}),
        copyFrom: { documentId: document.id, contentRevisionId, layoutRevisionId },
      };
      const hash = JSON.stringify(request);
      if (command.current?.hash !== hash) command.current = { hash, key: createIdempotencyKey() };
      return createResumeDocument(request, command.current.key);
    },
    retry: false,
    onSuccess: async (result) => {
      await client.invalidateQueries({
        queryKey: careerOsQueryKeys.resumeDocuments({ kind: "base" }),
      });
      navigate(`/resumes/${result.resumeDocument.id}`);
      setCopyOpen(false);
    },
  });
  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("已复制，请在网申或邮件中核对后使用。");
    } catch {
      setNotice("浏览器暂未允许复制，请选中段落文本手动复制。");
    }
  }
  return (
    <section className="core-reuse-tools">
      <div className="core-graph-section-head">
        <h2>材料复用</h2>
        <div className="core-actions">
          <button
            className="career-button"
            type="button"
            disabled={disabled}
            onClick={() => setCopyOpen((value) => !value)}
          >
            复制为方向稿
          </button>
          <Link to="/resumes/snippets">自我介绍与常用材料</Link>
        </div>
      </div>
      {copyOpen ? (
        <form
          className="core-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            copy.mutate();
          }}
        >
          <label>
            方向稿名称
            <input
              required
              maxLength={200}
              value={copyTitle}
              onChange={(event) => setCopyTitle(event.target.value)}
            />
          </label>
          <label>
            岗位方向
            <select value={family} onChange={(event) => setFamily(event.target.value)}>
              <option value="">暂不限定</option>
              {Object.entries(jobFamilyLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="career-button career-button--primary"
            disabled={disabled || copy.isPending}
            type="submit"
          >
            {copy.isPending ? "正在复制…" : "创建方向稿"}
          </button>
          {copy.isError ? (
            <p role="alert">{copy.error instanceof Error ? copy.error.message : "复制失败"}</p>
          ) : null}
        </form>
      ) : null}
      <details>
        <summary>逐段复制与保存</summary>
        {content.sections.map((section) => (
          <section className="core-reuse-section" key={section.id}>
            <h3>{section.title}</h3>
            {section.blocks.map((block) => (
              <article key={block.id}>
                <p>{block.text}</p>
                <div className="core-actions">
                  <button
                    className="career-button"
                    type="button"
                    onClick={() => void copyText(block.text)}
                  >
                    复制这一段
                  </button>
                  <button
                    type="button"
                    className="career-button"
                    disabled={disabled}
                    onClick={() =>
                      setSnippet({
                        kind: "project_long",
                        title: section.title,
                        body: block.text,
                        sourceDocumentId: document.id,
                        sourceContentRevisionId: contentRevisionId,
                        sourceBlockIds: [block.id],
                      })
                    }
                  >
                    存为复用材料
                  </button>
                </div>
              </article>
            ))}
          </section>
        ))}
      </details>
      <details>
        <summary>文件命名建议</summary>
        <p className="core-note">
          按企业要求优先填写。没有指定格式时，可用“姓名_岗位_公司_日期.pdf”。
        </p>
        <button
          className="career-button"
          type="button"
          onClick={() =>
            void copyText(
              `姓名_${document.title.replace(/[<>:"/\\|?*]/g, "_")}_公司_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.pdf`,
            )
          }
        >
          复制文件名模板
        </button>
      </details>
      {notice ? <output className="core-note">{notice}</output> : null}
      {snippet ? (
        <MaterialSnippetEditor initial={snippet} onClose={() => setSnippet(null)} />
      ) : null}
    </section>
  );
}
