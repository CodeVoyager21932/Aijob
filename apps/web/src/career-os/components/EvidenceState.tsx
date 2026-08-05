import type { EvidenceStateValue } from "../domain";
import { Icon } from "./Icon";

const evidenceStateConfig = {
  confirmed: { label: "已有证据", icon: "check" },
  needs_work: { label: "证据待补充", icon: "warning" },
  unconfirmed: { label: "用户尚未确认", icon: "question" },
} as const;

export function EvidenceState({ state }: { state: EvidenceStateValue }) {
  const config = evidenceStateConfig[state];
  return (
    <span className={`career-evidence-state career-evidence-state--${state}`}>
      <Icon name={config.icon} size={15} />
      {config.label}
    </span>
  );
}
