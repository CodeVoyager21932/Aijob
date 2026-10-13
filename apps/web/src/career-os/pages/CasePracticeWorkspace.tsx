import type { ApplicationCaseWithJobContext } from "@aijob/contracts";
import { lazy, Suspense, useState } from "react";
import { AssistantWorkspace } from "../studio/AssistantWorkspace";
const LegacyPractice = lazy(() =>
  import("./CaseInterviewWorkspace").then((m) => ({ default: m.CaseInterviewWorkspace })),
);
export function CasePracticeWorkspace({
  applicationCase,
  surface,
}: {
  applicationCase: ApplicationCaseWithJobContext;
  surface: "interview" | "debrief";
}) {
  const [legacy, setLegacy] = useState(false);
  return (
    <div className="career-case-practice">
      <p className="core-note">
        围绕这个岗位练习。记录过投递稿时，练习使用当时的材料；你也可以先练一轮再决定是否投递。
      </p>
      <AssistantWorkspace defaultTask="interview" contextCaseId={applicationCase.id} />
      <button
        type="button"
        className="career-button"
        aria-expanded={legacy}
        onClick={() => setLegacy((v) => !v)}
      >
        {legacy ? "收起以前的练习" : "查看以前的练习与复盘"}
      </button>
      {legacy ? (
        <Suspense fallback={<output>正在读取以前的记录…</output>}>
          <LegacyPractice applicationCase={applicationCase} surface={surface} />
        </Suspense>
      ) : null}
    </div>
  );
}
