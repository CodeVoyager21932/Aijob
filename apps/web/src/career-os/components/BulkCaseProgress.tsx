import {
  BulkCaseProgressResultSchema,
  type BulkCaseProgressRequest,
  type CaseOutcome,
  type CaseStage,
} from "@aijob/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiRequest, createIdempotencyKey } from "../../api/client";
import { careerOsQueryKeys } from "../../api/career-os";
import type { ApplicationCaseView } from "../application-case-view";
import { caseOutcomes, caseStages } from "../workspace-model";
import { ModalSurface } from "./ModalSurface";
import "../product-core.css";
export function BulkCaseProgress({ items }: { items: ApplicationCaseView[] }) {
  const client = useQueryClient(),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [stage, setStage] = useState<CaseStage>("preparing"),
    [outcome, setOutcome] = useState<CaseOutcome>("unknown");
  const command = useRef<{ signature: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: ({ request, key }: { request: BulkCaseProgressRequest; key: string }) =>
      apiRequest("/v1/application-cases/bulk-progress", {
        method: "POST",
        body: request,
        idempotencyKey: key,
        responseSchema: BulkCaseProgressResultSchema,
      }),
    retry: false,
    onSuccess: async (result) => {
      setSelected(
        (current) =>
          new Set(
            [...current].filter(
              (id) =>
                !result.items.some((item) => item.caseId === id && item.status === "succeeded"),
            ),
          ),
      );
      await client.invalidateQueries({ queryKey: careerOsQueryKeys.cases });
    },
  });
  function submit() {
    const chosen = items.filter((item) => selected.has(item.id));
    const request: BulkCaseProgressRequest = {
      items: chosen.map((item) => ({ caseId: item.id, expectedRevision: item.revision })),
      action:
        stage === "applied"
          ? { kind: "manual_application" }
          : {
              kind: "transition",
              request: {
                expectedRevision: 1,
                toStage: stage,
                ...(stage === "resolved" ? { outcome } : {}),
              },
            },
    };
    const signature = JSON.stringify(request);
    if (command.current?.signature !== signature)
      command.current = { signature, key: createIdempotencyKey() };
    mutation.mutate({ request, key: command.current.key });
  }
  return (
    <>
      <button
        className="career-button"
        type="button"
        disabled={!items.length}
        onClick={() => {
          setOpen(true);
          mutation.reset();
        }}
      >
        批量更新进度
      </button>
      {open ? (
        <ModalSurface
          className="core-editor"
          ariaLabel="批量更新申请进度"
          onClose={() => setOpen(false)}
          dismissible={!mutation.isPending}
          closeLabel="关闭批量更新"
        >
          <h2>批量更新申请进度</h2>
          <p className="core-note">
            从当前已加载的申请中选择，最多 50 项。每项分别保存，冲突项会保留并说明原因。
          </p>
          <div className="core-actions">
            <button
              className="career-button"
              type="button"
              onClick={() => setSelected(new Set(items.slice(0, 50).map((item) => item.id)))}
            >
              选择前 {Math.min(50, items.length)} 项
            </button>
            <button className="career-button" type="button" onClick={() => setSelected(new Set())}>
              清空选择
            </button>
          </div>
          <fieldset className="core-bulk-choices">
            <legend>选择申请（已选 {selected.size}）</legend>
            {items.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  disabled={mutation.isPending || (!selected.has(item.id) && selected.size >= 50)}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                />
                <span>
                  {item.companyName} · {item.roleTitle}
                </span>
              </label>
            ))}
          </fieldset>
          <label>
            目标阶段
            <select value={stage} onChange={(event) => setStage(event.target.value as CaseStage)}>
              {caseStages.map((value) => (
                <option key={value.value} value={value.value}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>
          {stage === "resolved" ? (
            <label>
              实际结果
              <select
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as CaseOutcome)}
              >
                {caseOutcomes.map((value) => (
                  <option key={value.value} value={value.value}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {stage === "applied" ? (
            <p className="core-note">
              仅记录你已经自行完成的投递。本次批量操作不关联简历；需要留存实际投递稿时，请到对应申请的投递页逐项记录。
            </p>
          ) : null}
          <p className="core-note">尚未收到回复可以继续保留在已投递阶段。</p>
          {mutation.data ? (
            <output>
              <p>
                已完成 {mutation.data.items.filter((item) => item.status === "succeeded").length}{" "}
                项。
              </p>
              {mutation.data.items
                .filter((item) => item.status === "failed")
                .map((item) => (
                  <p key={item.caseId}>
                    {items.find((value) => value.id === item.caseId)?.roleTitle}：
                    {item.status === "failed" ? item.message : ""}
                  </p>
                ))}
            </output>
          ) : null}
          {mutation.isError ? (
            <p role="alert">{mutation.error.message} 可重试本次请求，已保存项目不会重复记录。</p>
          ) : null}
          <div className="core-actions">
            <button
              className="career-button career-button--primary"
              disabled={mutation.isPending || !items.some((item) => selected.has(item.id))}
              type="button"
              onClick={submit}
            >
              {mutation.isPending ? "正在保存…" : "确认更新所选申请"}
            </button>
            <button
              className="career-button"
              disabled={mutation.isPending}
              type="button"
              onClick={() => setOpen(false)}
            >
              关闭
            </button>
          </div>
        </ModalSurface>
      ) : null}
    </>
  );
}
