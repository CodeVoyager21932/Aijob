import type {
  ConfirmCaseDebriefRequest,
  Debrief,
  DebriefConfirmation,
  DebriefItemDecision,
  DebriefItemDecisionInput,
  DebriefItemDecisionValue,
} from "@aijob/contracts";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  debriefActionItems,
  debriefBackflowPath,
  debriefConfirmationReady,
  debriefDecisionKey,
  debriefItemDecisionLabels,
} from "../interview-view";

const decisionValues: DebriefItemDecisionValue[] = ["accepted", "edited", "rejected", "deferred"];

function confirmationTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DebriefConfirmationPanel({
  caseId,
  debrief,
  itemDecisions,
  confirmation,
  pending,
  error,
  onConfirm,
}: {
  caseId: string;
  debrief: Debrief;
  itemDecisions: DebriefItemDecision[];
  confirmation: DebriefConfirmation | null;
  pending: boolean;
  error: Error | null;
  onConfirm: (request: ConfirmCaseDebriefRequest) => void;
}) {
  const actionItems = useMemo(() => debriefActionItems(debrief), [debrief]);
  const [drafts, setDrafts] = useState<Record<string, DebriefItemDecisionInput | undefined>>({});
  const persistedByKey = useMemo(
    () =>
      new Map(
        itemDecisions.map((decision) => [`${decision.itemKind}:${decision.itemId}`, decision]),
      ),
    [itemDecisions],
  );
  const confirmed = debrief.status === "confirmed" && confirmation !== null;
  const ready = debriefConfirmationReady(debrief, drafts);

  const choose = (item: (typeof actionItems)[number], decision: DebriefItemDecisionValue) => {
    const key = debriefDecisionKey(item);
    setDrafts((current) => ({
      ...current,
      [key]: {
        itemKind: item.kind,
        itemId: item.id,
        decision,
        editedText: decision === "edited" ? (current[key]?.editedText ?? item.description) : null,
      },
    }));
  };

  const confirm = () => {
    if (!ready || confirmed) return;
    onConfirm({
      expectedDebriefRevision: debrief.revision,
      itemDecisions: actionItems.map((item) => {
        const decision = drafts[debriefDecisionKey(item)];
        if (!decision) throw new Error("DEBRIEF_ITEM_DECISION_MISSING");
        return decision;
      }),
    });
  };

  return (
    <section className="career-debrief-confirmation" aria-labelledby="debrief-confirmation-title">
      <header>
        <div>
          <p>复盘确认</p>
          <h3 id="debrief-confirmation-title">
            {confirmed ? "本次复盘已由你确认" : "逐项决定是否采用"}
          </h3>
        </div>
        {confirmation ? <time>{confirmationTime(confirmation.confirmedAt)}</time> : null}
      </header>
      <p className="career-debrief-confirmation__boundary">
        采用只表示你认可这条改进方向；系统不会自动创建经历、修改证据或覆盖岗位简历。
      </p>

      {actionItems.length > 0 ? (
        <ol className="career-debrief-decision-list">
          {actionItems.map((item, index) => {
            const key = debriefDecisionKey(item);
            const draft = drafts[key];
            const persisted = persistedByKey.get(key);
            const current = persisted ?? draft;
            const canBackflow =
              confirmed && (current?.decision === "accepted" || current?.decision === "edited");
            return (
              <li key={key}>
                <header>
                  <span>{item.kind === "expression_issue" ? "表达问题" : "证据缺口"}</span>
                  <small>#{index + 1}</small>
                </header>
                <p>{item.description}</p>

                {confirmed ? (
                  current ? (
                    <div className="career-debrief-decision-result">
                      <strong>{debriefItemDecisionLabels[current.decision]}</strong>
                      {current.editedText ? <p>{current.editedText}</p> : null}
                      {canBackflow ? (
                        <Link
                          className="career-button career-button--quiet"
                          to={debriefBackflowPath(caseId, item)}
                        >
                          {item.kind === "expression_issue" ? "去修改岗位简历" : "去补证据"}
                        </Link>
                      ) : null}
                    </div>
                  ) : (
                    <div className="career-debrief-decision-result">
                      <strong>历史整份确认</strong>
                      <p>这条旧记录没有逐项选择，系统不会替你补写采用、拒绝或稍后处理。</p>
                    </div>
                  )
                ) : (
                  <>
                    <fieldset className="career-debrief-decision-options">
                      <legend className="sr-only">处理方式</legend>
                      {decisionValues.map((decision) => (
                        <button
                          key={decision}
                          type="button"
                          aria-pressed={draft?.decision === decision}
                          disabled={pending}
                          onClick={() => choose(item, decision)}
                        >
                          {debriefItemDecisionLabels[decision]}
                        </button>
                      ))}
                    </fieldset>
                    {draft?.decision === "edited" ? (
                      <label className="career-debrief-decision-edit">
                        <span>你认可的改进表达</span>
                        <textarea
                          rows={3}
                          maxLength={2_000}
                          value={draft.editedText ?? ""}
                          disabled={pending}
                          onChange={(event) =>
                            setDrafts((currentDrafts) => ({
                              ...currentDrafts,
                              [key]: { ...draft, editedText: event.target.value },
                            }))
                          }
                        />
                      </label>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="career-interview-review__empty">
          本轮没有表达问题或证据缺口；你仍可确认已经查看本次复盘。
        </p>
      )}

      {error ? (
        <div className="career-inline-error" role="alert">
          <strong>本次复盘没有确认</strong>
          <span>{error.message}</span>
        </div>
      ) : null}

      {!confirmed ? (
        <footer>
          <p>
            选择在提交前只保留于当前页面；点击确认后才会作为你的决定保存。拒绝和稍后处理同样会被保留。
          </p>
          <button
            className="career-button career-button--primary"
            type="button"
            disabled={!ready || pending}
            onClick={confirm}
          >
            {pending ? "正在确认…" : "确认本次复盘"}
          </button>
        </footer>
      ) : (
        <footer>
          <p>回流入口只负责带你回到既有工作区；后续仍由你核对并显式保存新修订。</p>
          <Link
            className="career-button career-button--quiet"
            to={`/applications/${caseId}/interview`}
          >
            返回面试练习
          </Link>
        </footer>
      )}
    </section>
  );
}
