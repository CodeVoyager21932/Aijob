import { type CaseStage, getCaseStageLabel } from "../domain";

export function StageBadge({ stage }: { stage: CaseStage }) {
  return (
    <span className={`career-stage-badge career-stage-badge--${stage}`}>
      {getCaseStageLabel(stage)}
    </span>
  );
}
