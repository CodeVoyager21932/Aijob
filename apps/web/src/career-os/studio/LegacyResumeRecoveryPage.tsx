import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createIdempotencyKey } from "../../api/client";
import { recoverLegacyResume } from "../../api/resume-studio";
export function LegacyResumeRecoveryPage() {
  const { analysisId } = useParams();
  const navigate = useNavigate();
  const key = useRef(createIdempotencyKey("legacy-recovery"));
  const [error, setError] = useState("");
  useEffect(() => {
    if (!analysisId) return;
    let active = true;
    void recoverLegacyResume(analysisId, key.current)
      .then((d) => {
        if (active) navigate(`/resumes/${d.documentId}`, { replace: true });
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "暂时无法恢复，请重新导入。");
      });
    return () => {
      active = false;
    };
  }, [analysisId, navigate]);
  return (
    <section className="resume-studio studio-library">
      <h1>继续编辑简历</h1>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <Link className="studio-primary" to="/resumes/import">
            重新导入简历
          </Link>
          <p>旧链接仍可使用；已经删除的旧原文无法从历史中还原。</p>
        </>
      ) : (
        <output>正在把旧导入内容放入编辑器…</output>
      )}
    </section>
  );
}
