import type {
  ApplicationCaseWithJobContext,
  CaseQuestion,
  CaseQuestionStatus,
  RequirementEvidenceState,
} from "@aijob/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  careerOsQueryKeys,
  createApplicationCaseQuestion,
  getApplicationCaseRequirements,
  getCareerOsEvidence,
  putApplicationCaseRequirementEvidence,
  putApplicationCaseRequirementState,
  updateApplicationCaseQuestion,
} from "../../api/career-os";
import { createIdempotencyKey, ProductApiError } from "../../api/client";
import { toApplicationCaseView } from "../application-case-view";
import { EvidenceState } from "../components/EvidenceState";
import { Icon } from "../components/Icon";
import { RequirementInspector } from "../components/RequirementInspector";
import {
  getRequirementEvidenceIds,
  getRequirementState,
  requirementGroup,
  requirementGroups,
  requirementSourceLabel,
} from "../requirements-view";

function shouldOpenInspectorByDefault(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}

interface RequirementDraft {
  state?: RequirementEvidenceState;
  userNote?: string;
  evidenceIds?: string[];
}

type RequirementCommand =
  | {
      kind: "state";
      requirementId: string;
      expectedRevision: number;
      state: RequirementEvidenceState;
      userNote: string | null;
    }
  | {
      kind: "evidence";
      requirementId: string;
      expectedRevision: number;
      evidenceRevisionId: string;
      evidenceIds: string[];
    }
  | {
      kind: "create-question";
      requirementId: string;
      expectedRevision: number;
      question: string;
      idempotencyKey: string;
    }
  | {
      kind: "update-question";
      questionId: string;
      expectedRevision: number;
      status: CaseQuestionStatus;
      answer: string | null;
    };

export function CaseRequirementsWorkspace({
  applicationCase,
}: {
  applicationCase: ApplicationCaseWithJobContext;
}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isInspectorOpen, setInspectorOpen] = useState(shouldOpenInspectorByDefault);
  const [drafts, setDrafts] = useState<Record<string, RequirementDraft>>({});
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [revisionConflict, setRevisionConflict] = useState(false);
  const questionCommandRef = useRef<{ signature: string; key: string } | null>(null);

  const requirementsQuery = useQuery({
    queryKey: careerOsQueryKeys.requirements(applicationCase.id),
    queryFn: ({ signal }) => getApplicationCaseRequirements(applicationCase.id, signal),
  });
  const evidenceQuery = useQuery({
    queryKey: careerOsQueryKeys.evidence,
    queryFn: ({ signal }) => getCareerOsEvidence(signal),
  });

  const commandMutation = useMutation({
    mutationFn: (command: RequirementCommand) => {
      if (command.kind === "state") {
        return putApplicationCaseRequirementState(applicationCase.id, command.requirementId, {
          expectedRevision: command.expectedRevision,
          state: command.state,
          userNote: command.userNote,
        });
      }
      if (command.kind === "evidence") {
        return putApplicationCaseRequirementEvidence(applicationCase.id, command.requirementId, {
          expectedRevision: command.expectedRevision,
          evidenceRevisionId: command.evidenceRevisionId,
          evidenceIds: command.evidenceIds,
        });
      }
      if (command.kind === "create-question") {
        return createApplicationCaseQuestion(
          applicationCase.id,
          {
            expectedRevision: command.expectedRevision,
            requirementId: command.requirementId,
            question: command.question,
          },
          command.idempotencyKey,
        );
      }
      return updateApplicationCaseQuestion(applicationCase.id, command.questionId, {
        expectedRevision: command.expectedRevision,
        status: command.status,
        answer: command.answer,
      });
    },
    retry: false,
    onMutate: () => setRevisionConflict(false),
    onSuccess: async (_response, command) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.requirements(applicationCase.id),
        }),
        queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
        }),
        queryClient.invalidateQueries({ queryKey: careerOsQueryKeys.caseList() }),
      ]);
      if (command.kind === "state") {
        setDrafts((current) => {
          const next = { ...current };
          const draft = { ...next[command.requirementId] };
          delete draft.state;
          delete draft.userNote;
          next[command.requirementId] = draft;
          return next;
        });
      } else if (command.kind === "evidence") {
        setDrafts((current) => {
          const next = { ...current };
          const draft = { ...next[command.requirementId] };
          delete draft.evidenceIds;
          next[command.requirementId] = draft;
          return next;
        });
      } else if (command.kind === "create-question") {
        setQuestionDrafts((current) => ({ ...current, [command.requirementId]: "" }));
      } else {
        setAnswerDrafts((current) => {
          const next = { ...current };
          delete next[command.questionId];
          return next;
        });
      }
    },
    onError: (error) => {
      if (error instanceof ProductApiError && error.code === "APPLICATION_CASE_REVISION_CONFLICT") {
        setRevisionConflict(true);
        void queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.requirements(applicationCase.id),
        });
        void queryClient.invalidateQueries({
          queryKey: careerOsQueryKeys.caseDetail(applicationCase.id),
        });
      }
    },
  });

  const data = requirementsQuery.data;
  const requestedRequirementId = searchParams.get("requirement");
  const selectedRequirement =
    data?.requirements.find((item) => item.id === requestedRequirementId) ?? data?.requirements[0];

  useEffect(() => {
    if (!data || !requestedRequirementId) return;
    if (data.requirements.some((item) => item.id === requestedRequirementId)) {
      setInspectorOpen(true);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("requirement");
    setSearchParams(next, { replace: true });
    window.requestAnimationFrame(() => {
      const fallback = data.requirements[0];
      if (fallback) {
        document
          .querySelector<HTMLButtonElement>(`[data-requirement-trigger="${fallback.id}"]`)
          ?.focus();
      }
    });
  }, [data, requestedRequirementId, searchParams, setSearchParams]);

  const selectRequirement = useCallback(
    (requirementId: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("requirement", requirementId);
      next.delete("block");
      setSearchParams(next);
      setInspectorOpen(true);
    },
    [searchParams, setSearchParams],
  );

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    if (!selectedRequirement) return;
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-requirement-trigger="${selectedRequirement.id}"]`)
        ?.focus();
    });
  }, [selectedRequirement]);

  const groupedRequirements = useMemo(
    () =>
      requirementGroups.map((group) => ({
        ...group,
        requirements: (data?.requirements ?? []).filter(
          (requirement) => requirementGroup(requirement) === group.value,
        ),
      })),
    [data?.requirements],
  );

  if (requirementsQuery.isPending) {
    return <output className="career-request-state">正在读取固定岗位要求…</output>;
  }
  if (requirementsQuery.isError) {
    return (
      <div className="career-request-state career-inline-error" role="alert">
        <strong>岗位要求暂时无法读取</strong>
        <span>
          {requirementsQuery.error instanceof Error
            ? requirementsQuery.error.message
            : "请稍后重试。"}
        </span>
        <button type="button" onClick={() => void requirementsQuery.refetch()}>
          重新读取
        </button>
      </div>
    );
  }
  if (!selectedRequirement || !data) {
    return (
      <div className="career-empty-state">
        <strong>这个固定岗位版本没有可核对的要求</strong>
        <p>系统不会用推断内容填充空白。</p>
      </div>
    );
  }

  const selectedServerState = getRequirementState(data, selectedRequirement.id);
  const selectedDraft = drafts[selectedRequirement.id] ?? {};
  const selectedState = selectedDraft.state ?? selectedServerState.state;
  const selectedNote = selectedDraft.userNote ?? selectedServerState.userNote;
  const selectedEvidenceIds =
    selectedDraft.evidenceIds ?? getRequirementEvidenceIds(data, selectedRequirement.id);
  const evidenceRevisionId =
    evidenceQuery.data && "id" in evidenceQuery.data ? evidenceQuery.data.id : null;
  const evidence = evidenceQuery.data?.evidence ?? [];
  const selectedQuestions = data.questions.filter(
    (question) => question.requirementId === selectedRequirement.id,
  );
  const questionDraft = questionDrafts[selectedRequirement.id] ?? "";
  const applicationCaseView = toApplicationCaseView(applicationCase);
  const updateDraft = (patch: RequirementDraft) => {
    setDrafts((current) => ({
      ...current,
      [selectedRequirement.id]: { ...current[selectedRequirement.id], ...patch },
    }));
  };

  const createQuestion = () => {
    const question = questionDraft.trim();
    if (!question) return;
    const signature = `${data.revision}:${selectedRequirement.id}:${question}`;
    if (!questionCommandRef.current || questionCommandRef.current.signature !== signature) {
      questionCommandRef.current = {
        signature,
        key: createIdempotencyKey("case-question"),
      };
    }
    commandMutation.mutate({
      kind: "create-question",
      requirementId: selectedRequirement.id,
      expectedRevision: data.revision,
      question,
      idempotencyKey: questionCommandRef.current.key,
    });
  };

  const updateQuestion = (
    question: CaseQuestion,
    status: CaseQuestionStatus,
    answer: string | null,
  ) => {
    commandMutation.mutate({
      kind: "update-question",
      questionId: question.id,
      expectedRevision: data.revision,
      status,
      answer,
    });
  };

  return (
    <div className="career-case-detail-layout career-requirements-layout">
      <div className="career-case-detail-layout__main">
        <header className="career-workspace-heading">
          <div>
            <p>M1 · 真实 Case 数据</p>
            <h2>逐项理解岗位要求</h2>
            <span>岗位原文、用户状态、已确认证据和未知项始终分开保存。</span>
          </div>
          <fieldset className="career-workspace-heading__legend">
            <legend className="sr-only">证据状态图例</legend>
            <EvidenceState state="confirmed" />
            <EvidenceState state="needs_work" />
            <EvidenceState state="unconfirmed" />
          </fieldset>
        </header>

        {evidenceQuery.isError ? (
          <div className="career-inline-error" role="alert">
            <strong>已确认证据暂时无法读取</strong>
            <span>你仍可保存要求三态和备注。</span>
          </div>
        ) : null}

        <div className="career-requirement-groups">
          {groupedRequirements.map((group) => (
            <section
              className={`career-requirement-group career-requirement-group--${group.value}`}
              key={group.value}
              aria-labelledby={`requirement-group-${group.value}`}
            >
              <header>
                <div>
                  <h3 id={`requirement-group-${group.value}`}>{group.label}</h3>
                  <p>{group.description}</p>
                </div>
                <span>{group.requirements.length}</span>
              </header>
              {group.requirements.length > 0 ? (
                <ul>
                  {group.requirements.map((requirement) => {
                    const state =
                      drafts[requirement.id]?.state ??
                      getRequirementState(data, requirement.id).state;
                    return (
                      <li key={requirement.id}>
                        <button
                          type="button"
                          className={
                            selectedRequirement.id === requirement.id ? "is-selected" : undefined
                          }
                          aria-pressed={selectedRequirement.id === requirement.id}
                          data-requirement-trigger={requirement.id}
                          disabled={commandMutation.isPending}
                          onClick={() => selectRequirement(requirement.id)}
                        >
                          <span className="career-requirement-row__grip" aria-hidden="true">
                            ···
                          </span>
                          <span className="career-requirement-row__content">
                            <strong>{requirement.sourceText}</strong>
                            <small>{requirementSourceLabel(data)}</small>
                          </span>
                          <EvidenceState state={state} />
                          <Icon name="chevron" size={17} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="career-requirement-group__empty">当前没有这一类要求。</p>
              )}
            </section>
          ))}
        </div>
      </div>

      <div className={`career-context-panel${isInspectorOpen ? " is-open" : ""}`}>
        <RequirementInspector
          key={selectedRequirement.id}
          applicationCase={applicationCaseView}
          requirement={selectedRequirement}
          group={requirementGroup(selectedRequirement)}
          sourceLabel={requirementSourceLabel(data)}
          state={selectedState}
          userNote={selectedNote}
          evidenceIds={selectedEvidenceIds}
          evidenceRevisionId={evidenceRevisionId}
          evidence={evidence}
          questions={selectedQuestions}
          questionDraft={questionDraft}
          answerDrafts={answerDrafts}
          pending={commandMutation.isPending}
          conflict={revisionConflict}
          error={revisionConflict ? null : commandMutation.error}
          onClose={closeInspector}
          onStateChange={(state) => updateDraft({ state })}
          onNoteChange={(userNote) => updateDraft({ userNote })}
          onEvidenceChange={(evidenceIds) => updateDraft({ evidenceIds })}
          onSaveState={() =>
            commandMutation.mutate({
              kind: "state",
              requirementId: selectedRequirement.id,
              expectedRevision: data.revision,
              state: selectedState,
              userNote: selectedNote.trim() || null,
            })
          }
          onSaveEvidence={() => {
            if (!evidenceRevisionId) return;
            commandMutation.mutate({
              kind: "evidence",
              requirementId: selectedRequirement.id,
              expectedRevision: data.revision,
              evidenceRevisionId,
              evidenceIds: [...new Set(selectedEvidenceIds)].sort(),
            });
          }}
          onQuestionDraftChange={(value) =>
            setQuestionDrafts((current) => ({
              ...current,
              [selectedRequirement.id]: value,
            }))
          }
          onCreateQuestion={createQuestion}
          onAnswerDraftChange={(questionId, value) =>
            setAnswerDrafts((current) => ({ ...current, [questionId]: value }))
          }
          onUpdateQuestion={updateQuestion}
        />
      </div>
      {isInspectorOpen ? (
        <button
          className="career-context-panel-backdrop"
          type="button"
          aria-label="关闭要求检查器"
          onClick={closeInspector}
        />
      ) : null}
    </div>
  );
}
