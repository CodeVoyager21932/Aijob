import type { ResumeDocument } from "@aijob/contracts";
import { lazy, Suspense } from "react";

const Studio = lazy(() =>
  import("../studio/ResumeStudioEditor").then((m) => ({ default: m.ResumeStudioEditor })),
);
export function ResumeDocumentEditor({
  resumeDocument,
}: {
  resumeDocument: ResumeDocument;
  contextLabel?: string;
  evidenceRevisionId?: string;
}) {
  return (
    <Suspense fallback={<output>正在打开简历编辑器…</output>}>
      <Studio documentId={resumeDocument.id} />
    </Suspense>
  );
}
