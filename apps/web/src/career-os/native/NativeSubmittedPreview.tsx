import type { SubmittedMaterial } from "@aijob/contracts";
import { joinNativeResumeDocument } from "@aijob/resume-core";
import { useEffect, useState } from "react";
import { apiDownload } from "../../api/client";
import { NativePdfPreview } from "./NativePdfPreview";
export default function NativeSubmittedPreview({
  material,
}: {
  material: Extract<SubmittedMaterial, { editorCore: "native-v1" }>;
}) {
  const [blob, setBlob] = useState<Blob>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void apiDownload(
      `/v1/application-cases/${material.caseId}/submitted-materials/${material.id}/pdf`,
    )
      .then(({ blob }) => {
        if (active) setBlob(blob);
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : "投递稿暂时无法读取");
      });
    return () => {
      active = false;
    };
  }, [material.caseId, material.id]);
  try {
    const document = joinNativeResumeDocument(material.content, material.layout);
    return (
      <div style={{ height: "65vh", minHeight: 0 }}>
        <NativePdfPreview
          document={document}
          authoritative
          fillContainer
          fixedBlob={blob}
          pendingMessage={error || undefined}
        />
      </div>
    );
  } catch {
    return <p role="alert">这份历史稿的版本暂不可读取，请保留原文件并检查运行版本。</p>;
  }
}
