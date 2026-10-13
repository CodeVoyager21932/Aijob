import {
  type CreatePlannerItemRequest,
  CreatePlannerItemRequestSchema,
  type PlannerItem,
  resumeRichPlain,
} from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  getApplicationBoard,
  getCareerOsEvidence,
  getCareerOsEvidenceRevision,
} from "../../api/career-os";
import { createIdempotencyKey } from "../../api/client";
import { addPlannerItem, coreKeys, putPlannerItem } from "../../api/product-core";
import { getExperiences } from "../../api/resume-studio";
import { ModalSurface } from "./ModalSurface";

export const plannerKindLabels = {
  preparation: "准备任务",
  exam: "笔试",
  interview: "面试",
  deadline: "截止事项",
  follow_up: "待跟进",
} as const;
export const plannerStatusLabels = { todo: "待处理", doing: "进行中", done: "已完成" } as const;
export function plannerFields(item: PlannerItem): CreatePlannerItemRequest {
  const {
    id: _id,
    revision: _revision,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    completedAt: _completedAt,
    ...fields
  } = item;
  return fields;
}
function shanghaiInput(value: string | null) {
  if (!value) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function PlannerEditor({
  item,
  initial,
  onClose,
  onSaved,
}: {
  item?: PlannerItem;
  initial?: Partial<CreatePlannerItemRequest>;
  onClose: () => void;
  onSaved?: (item: PlannerItem) => void;
}) {
  const [draft, setDraft] = useState<CreatePlannerItemRequest>(() =>
    item
      ? plannerFields(item)
      : CreatePlannerItemRequestSchema.parse({
          kind: "preparation",
          title: "新的准备任务",
          ...initial,
        }),
  );
  const [dueInput, setDueInput] = useState(shanghaiInput(draft.dueAt));
  const [localError, setLocalError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const command = useRef<{ signature: string; key: string } | null>(null);
  const client = useQueryClient();
  const evidence = useQuery({
    queryKey: ["career-os", "planner-evidence", draft.evidenceRevisionId],
    enabled: Boolean(draft.evidenceRevisionId),
    queryFn: ({ signal }) =>
      draft.evidenceRevisionId
        ? getCareerOsEvidenceRevision(draft.evidenceRevisionId, signal)
        : getCareerOsEvidence(signal),
  });
  const experiences = useQuery({ queryKey: ["career-os", "experiences"], queryFn: getExperiences });
  const cases = useQuery({
    queryKey: ["career-os", "planner-case-options"],
    queryFn: ({ signal }) => getApplicationBoard({ limitPerStage: 50 }, signal),
  });
  const save = useMutation({
    mutationFn: ({ request, key }: { request: CreatePlannerItemRequest; key: string }) =>
      item
        ? putPlannerItem(item.id, { ...request, expectedRevision: item.revision }, key)
        : addPlannerItem(request, key),
    retry: false,
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: coreKeys.planner });
      onSaved?.(result);
      onClose();
    },
  });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setLocalError("");
    const result = CreatePlannerItemRequestSchema.safeParse({
      ...draft,
      timezone: "Asia/Shanghai",
      dueAt: dueInput ? new Date(`${dueInput}:00+08:00`).toISOString() : null,
    });
    if (!result.success) {
      setLocalError("请检查标题、时间和内容长度。");
      return;
    }
    const signature = JSON.stringify(result.data);
    if (command.current?.signature !== signature)
      command.current = { signature, key: createIdempotencyKey() };
    save.mutate({ request: result.data, key: command.current.key });
  }
  const caseOptions = cases.data?.columns.flatMap((column) => column.items) ?? [];
  const toggleEvidence = (id: string) => {
    if (!evidence.data || !("id" in evidence.data)) return;
    const revisionId = evidence.data.id;
    setDraft((value) => ({
      ...value,
      evidenceRevisionId: revisionId,
      evidenceIds: value.evidenceIds.includes(id)
        ? value.evidenceIds.filter((current) => current !== id)
        : [...value.evidenceIds, id],
    }));
  };
  return (
    <ModalSurface
      className="core-editor"
      ariaLabel={item ? "编辑事项" : "添加事项"}
      initialFocusRef={titleRef}
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel="关闭事项编辑"
    >
      <form onSubmit={submit} className="core-form">
        <header>
          <p className="core-eyebrow">个人准备与日程</p>
          <h2>{item ? "编辑事项" : "安排下一步"}</h2>
        </header>
        <label>
          事项名称
          <input
            ref={titleRef}
            required
            maxLength={200}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <div className="core-form-grid">
          <label>
            类型
            <select
              value={draft.kind}
              onChange={(event) =>
                setDraft({ ...draft, kind: event.target.value as CreatePlannerItemRequest["kind"] })
              }
            >
              {Object.entries(plannerKindLabels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as CreatePlannerItemRequest["status"],
                })
              }
            >
              {Object.entries(plannerStatusLabels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            时间（北京时间，可留空）
            <input
              type="datetime-local"
              value={dueInput}
              onChange={(event) => setDueInput(event.target.value)}
            />
          </label>
          <label>
            关联申请
            <select
              value={draft.caseId ?? ""}
              onChange={(event) => setDraft({ ...draft, caseId: event.target.value || null })}
            >
              <option value="">独立准备事项</option>
              {draft.caseId && !caseOptions.some((value) => value.id === draft.caseId) ? (
                <option value={draft.caseId}>已关联的申请</option>
              ) : null}
              {caseOptions.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.jobDisplay.companyName ?? "未说明企业"} · {value.jobDisplay.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        {cases.isError ? <p role="alert">申请列表暂时不可用，已有的关联会保留。</p> : null}
        {draft.source ? (
          <blockquote>
            <small>所选岗位原句</small>
            <p>{draft.source.sourceText}</p>
            <Link to={`/jobs/${draft.source.jobId}`}>查看岗位</Link>
          </blockquote>
        ) : null}
        <label>
          准备动作与备注
          <textarea
            rows={3}
            maxLength={12000}
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            placeholder="例如：复现一个分析过程，写清问题、方法和结论。"
          />
        </label>
        <details open={draft.sourceExperienceIds.length > 0 || draft.evidenceIds.length > 0}>
          <summary>
            关联已有经历 · 已选 {draft.sourceExperienceIds.length + draft.evidenceIds.length} 段
          </summary>
          {experiences.isPending ? (
            <p>正在读取经历…</p>
          ) : experiences.isError ? (
            <p role="alert">
              经历暂时无法读取，已经选中的关联会保留。
              <button type="button" onClick={() => void experiences.refetch()}>
                重试
              </button>
            </p>
          ) : experiences.data?.items.length ? (
            <div className="core-evidence-options">
              {experiences.data.items.map((value) => (
                <label key={value.id}>
                  <input
                    type="checkbox"
                    checked={draft.sourceExperienceIds.includes(value.id)}
                    onChange={() =>
                      setDraft((current) => ({
                        ...current,
                        sourceExperienceIds: current.sourceExperienceIds.includes(value.id)
                          ? current.sourceExperienceIds.filter((id) => id !== value.id)
                          : [...current.sourceExperienceIds, value.id],
                      }))
                    }
                  />
                  <span>
                    <strong>{value.title}</strong>
                    <br />
                    {resumeRichPlain(value.entry.body)}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p>
              还没有保存的经历，可以先安排准备，再到<Link to="/materials">经历与材料</Link>中整理。
            </p>
          )}
          {draft.evidenceRevisionId ? (
            <details>
              <summary>以前关联的材料</summary>
              {evidence.isError ? (
                <p role="alert">历史材料读取失败，原有引用会保留。</p>
              ) : (
                evidence.data?.evidence
                  .filter((value) => value.confirmed)
                  .map((value) => (
                    <label key={value.id}>
                      <input
                        type="checkbox"
                        checked={draft.evidenceIds.includes(value.id)}
                        onChange={() => toggleEvidence(value.id)}
                      />
                      <span>{"statement" in value ? value.statement : value.claim}</span>
                    </label>
                  ))
              )}
            </details>
          ) : null}
        </details>
        <label>
          准备产物
          <textarea
            rows={4}
            maxLength={20000}
            value={draft.artifact}
            onChange={(event) => setDraft({ ...draft, artifact: event.target.value })}
            placeholder="记录产物摘要、文件位置或链接，便于申请时取用。"
          />
        </label>
        <p className="core-note">
          准备产物保存在这项任务里。完成后可以整理为自己的经历或简历表达。
        </p>
        {localError || save.isError ? (
          <p role="alert" className="career-inline-error">
            {localError ||
              (save.error instanceof Error ? save.error.message : "保存失败，请重试。")}
          </p>
        ) : null}
        <footer>
          <button
            type="button"
            className="career-button"
            onClick={onClose}
            disabled={save.isPending}
          >
            取消
          </button>
          <button
            type="submit"
            className="career-button career-button--primary"
            disabled={save.isPending}
          >
            {save.isPending ? "正在保存…" : "保存事项"}
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
}
