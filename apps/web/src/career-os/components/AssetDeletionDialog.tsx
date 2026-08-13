import type { CaseAssetDisposition } from "@aijob/contracts";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { ModalSurface } from "./ModalSurface";

interface AssetDeletionDialogProps {
  open: boolean;
  title: string;
  description: string;
  consequence: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : "删除没有完成，请重新读取后再决定。";
}

export function AssetDeletionDialog({
  open,
  title,
  description,
  consequence,
  pending,
  error,
  onClose,
  onConfirm,
}: AssetDeletionDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  if (!open) return null;
  const message = errorMessage(error);

  return (
    <ModalSurface
      className="career-modal-surface--dialog"
      layerClassName="career-modal-layer--dialog"
      labelledBy="asset-deletion-title"
      describedBy="asset-deletion-description"
      initialFocusRef={cancelRef}
      dismissible={!pending}
      closeLabel="关闭删除确认"
      onClose={onClose}
    >
      <section className="career-deletion-dialog">
        <header>
          <span className="career-deletion-dialog__icon">
            <Icon name="close" size={18} />
          </span>
          <div>
            <p>由你主动决定</p>
            <h2 id="asset-deletion-title">{title}</h2>
          </div>
        </header>
        <p id="asset-deletion-description">{description}</p>
        <div className="career-deletion-dialog__warning" role="note">
          <strong>删除后的影响</strong>
          <span>{consequence}</span>
        </div>
        {message ? (
          <div className="career-inline-error" role="alert">
            <strong>删除没有完成</strong>
            <span>{message}</span>
          </div>
        ) : null}
        <footer>
          <button
            ref={cancelRef}
            className="career-button career-button--quiet"
            type="button"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="career-button career-button--danger"
            type="button"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "正在删除…" : "确认删除"}
          </button>
        </footer>
      </section>
    </ModalSurface>
  );
}

export interface CaseDeletionChoices {
  resumeDocuments: CaseAssetDisposition | null;
  interviewSessions: CaseAssetDisposition | null;
  debriefs: CaseAssetDisposition | null;
}

export function caseDeletionChoicesComplete(choices: CaseDeletionChoices): choices is {
  resumeDocuments: CaseAssetDisposition;
  interviewSessions: CaseAssetDisposition;
  debriefs: CaseAssetDisposition;
} {
  return Boolean(choices.resumeDocuments && choices.interviewSessions && choices.debriefs);
}

interface CaseDeletionDialogProps {
  open: boolean;
  privateJob: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (choices: {
    resumeDocuments: CaseAssetDisposition;
    interviewSessions: CaseAssetDisposition;
    debriefs: CaseAssetDisposition;
  }) => void;
}

const emptyChoices: CaseDeletionChoices = {
  resumeDocuments: null,
  interviewSessions: null,
  debriefs: null,
};

function CaseAssetChoice({
  name,
  title,
  value,
  onChange,
}: {
  name: string;
  title: string;
  value: CaseAssetDisposition | null;
  onChange: (value: CaseAssetDisposition) => void;
}) {
  return (
    <fieldset className="career-deletion-choice">
      <legend>{title}</legend>
      <label>
        <input
          type="radio"
          name={name}
          checked={value === "delete"}
          onChange={() => onChange("delete")}
        />
        <span>
          <strong>同时删除</strong>
          <small>关联记录立即从当前用户可见范围中消失。</small>
        </span>
      </label>
      <label>
        <input
          type="radio"
          name={name}
          checked={value === "detach"}
          onChange={() => onChange("detach")}
        />
        <span>
          <strong>保留为独立资产</strong>
          <small>解除与 Case 的活动关联，但继续保留固定岗位版本和证据来源。</small>
        </span>
      </label>
    </fieldset>
  );
}

export function CaseDeletionDialog({
  open,
  privateJob,
  pending,
  error,
  onClose,
  onConfirm,
}: CaseDeletionDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [choices, setChoices] = useState<CaseDeletionChoices>(emptyChoices);
  useEffect(() => {
    if (open) setChoices(emptyChoices);
  }, [open]);
  if (!open) return null;
  const complete = caseDeletionChoicesComplete(choices);
  const message = errorMessage(error);

  return (
    <ModalSurface
      className="career-modal-surface--dialog career-modal-surface--case-deletion"
      layerClassName="career-modal-layer--dialog"
      labelledBy="case-deletion-title"
      describedBy="case-deletion-description"
      initialFocusRef={cancelRef}
      dismissible={!pending}
      closeLabel="关闭求职项目删除确认"
      onClose={onClose}
    >
      <section className="career-deletion-dialog career-deletion-dialog--case">
        <header>
          <span className="career-deletion-dialog__icon">
            <Icon name="close" size={18} />
          </span>
          <div>
            <p>删除求职项目</p>
            <h2 id="case-deletion-title">分别决定关联资产如何处理</h2>
          </div>
        </header>
        <p id="case-deletion-description">
          Case
          的要求状态、备注、问题和关联会被删除。岗位简历、面试练习与复盘不会被系统擅自连带处理，请为每一类明确选择。
        </p>
        <div className="career-deletion-choice-grid">
          <CaseAssetChoice
            name="case-resume-disposition"
            title="岗位简历"
            value={choices.resumeDocuments}
            onChange={(resumeDocuments) =>
              setChoices((current) => ({ ...current, resumeDocuments }))
            }
          />
          <CaseAssetChoice
            name="case-interview-disposition"
            title="面试练习"
            value={choices.interviewSessions}
            onChange={(interviewSessions) =>
              setChoices((current) => ({ ...current, interviewSessions }))
            }
          />
          <CaseAssetChoice
            name="case-debrief-disposition"
            title="复盘"
            value={choices.debriefs}
            onChange={(debriefs) => setChoices((current) => ({ ...current, debriefs }))}
          />
        </div>
        <div className="career-deletion-dialog__warning" role="note">
          <strong>{privateJob ? "私有 JD 处理" : "固定岗位版本处理"}</strong>
          <span>
            {privateJob
              ? "只要保留一项派生资产，私有 JD 快照就会继续仅对你可见；最后一项引用也删除后，正文不再可读取。"
              : "保留的派生资产继续引用原固定岗位版本，不会改成目录中的最新版本，也不会创建新的 Case。"}
          </span>
        </div>
        {message ? (
          <div className="career-inline-error" role="alert">
            <strong>求职项目没有删除</strong>
            <span>{message}</span>
          </div>
        ) : null}
        <footer>
          <button
            ref={cancelRef}
            className="career-button career-button--quiet"
            type="button"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="career-button career-button--danger"
            type="button"
            disabled={pending || !complete}
            onClick={() => {
              if (complete) onConfirm(choices);
            }}
          >
            {pending ? "正在删除…" : complete ? "按以上选择删除" : "请完成三项选择"}
          </button>
        </footer>
      </section>
    </ModalSurface>
  );
}
