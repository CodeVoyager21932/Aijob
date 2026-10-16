import { ProductApiError } from "../../api/client";

// Match the server's safeResumeFileName rules, without renaming the retained artifact.
function currentPdfFileName(title: string) {
  const normalized = title
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*]|\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `Aijob-${normalized || "简历"}.pdf`;
}

/** A disposable preview may expire while its paper is still open in the editor. */
export async function downloadCurrentPreview<T extends { artifact: { id: string } }>(
  resolvePreview: (force: boolean) => Promise<T>,
  download: (artifactId: string, fileName: string) => Promise<void>,
  currentTitle: string,
): Promise<T> {
  const fileName = currentPdfFileName(currentTitle);
  try {
    const preview = await resolvePreview(false);
    await download(preview.artifact.id, fileName);
    return preview;
  } catch (error) {
    if (
      !(error instanceof ProductApiError) ||
      !(
        (error.status === 404 && error.code === "RESUME_EXPORT_NOT_FOUND") ||
        (error.status === 410 && error.code === "RESUME_EXPORT_DELETED")
      )
    )
      throw error;
  }
  // The second attempt deliberately has no retry: deletion, conflicts and other failures surface.
  const refreshed = await resolvePreview(true);
  await download(refreshed.artifact.id, fileName);
  return refreshed;
}
