import { NavLink } from "react-router-dom";
import { caseTabs } from "../domain";

export function CaseTabs({ caseId }: { caseId: string }) {
  return (
    <nav className="career-case-tabs" aria-label="岗位工作区">
      {caseTabs.map((tab) => (
        <NavLink
          key={tab.value}
          to={`/applications/${caseId}/${tab.value}`}
          className={({ isActive }) => (isActive ? "is-active" : undefined)}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
