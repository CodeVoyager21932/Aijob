import type { ApplicationCaseRequirements, JobRequirement } from "@aijob/contracts";
import type { ReactNode } from "react";

export function RequirementSourceUnits({
  data,
  renderAssertion,
}: {
  data: Pick<ApplicationCaseRequirements, "requirements" | "sourceUnits">;
  renderAssertion?: (requirement: JobRequirement) => ReactNode;
}) {
  const byUnit = new Map<string, JobRequirement[]>();
  for (const requirement of data.requirements) {
    if (!requirement.sourceUnitId) continue;
    const items = byUnit.get(requirement.sourceUnitId) ?? [];
    items.push(requirement);
    byUnit.set(requirement.sourceUnitId, items);
  }
  return (
    <div className="career-requirement-groups">
      {data.sourceUnits.map((unit) => (
        <section className="career-requirement-group" key={unit.id} data-source-unit={unit.id}>
          <header>
            <div>
              <p>
                {unit.origin.kind === "structured_field"
                  ? "官方结构化字段"
                  : unit.origin.kind === "private_jd_clause"
                    ? "用户私有 JD 原句"
                    : "官方 JD 原句"}
              </p>
              <h3>{unit.text}</h3>
            </div>
          </header>
          {renderAssertion && (byUnit.get(unit.id)?.length ?? 0) > 0 ? (
            <ul>
              {byUnit.get(unit.id)?.map((requirement) => (
                <li key={requirement.id}>{renderAssertion(requirement)}</li>
              ))}
            </ul>
          ) : (
            <p className="career-requirement-group__empty">原文保留，尚无可可靠拆解的核对项。</p>
          )}
        </section>
      ))}
    </div>
  );
}
