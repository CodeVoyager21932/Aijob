import { activityLabel, publicationLabel } from "../domain/jobs";

interface StatusBadgeProps {
  kind: "activity" | "publication" | "source" | "track";
  value: string;
}

export function StatusBadge({ kind, value }: StatusBadgeProps) {
  const label =
    kind === "activity"
      ? activityLabel(value)
      : kind === "publication"
        ? publicationLabel(value)
        : value || "未说明";

  const tone =
    kind === "activity"
      ? value === "active"
        ? "positive"
        : value === "closed"
          ? "muted"
          : "warning"
      : kind === "publication"
        ? value === "published"
          ? "positive"
          : "warning"
        : "neutral";

  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
