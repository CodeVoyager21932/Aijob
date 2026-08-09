import { type CaseStage, getCaseStageLabel } from "../workspace-model";

export function StageBadge({ stage }: { stage: CaseStage }) {
  return (
    <span className={`career-stage-badge career-stage-badge--${stage}`}>
      {getCaseStageLabel(stage)}
    </span>
  );
}
