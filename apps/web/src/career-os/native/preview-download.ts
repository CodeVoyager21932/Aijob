import { ProductApiError } from "../../api/client";

/** A disposable preview may expire while its paper is still open in the editor. */
export async function downloadCurrentPreview<T extends { artifact: { id: string } }>(
  resolvePreview: (force: boolean) => Promise<T>,
  download: (artifactId: string) => Promise<void>,
): Promise<T> {
  try {
    const preview = await resolvePreview(false);
    await download(preview.artifact.id);
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
  await download(refreshed.artifact.id);
  return refreshed;
}
