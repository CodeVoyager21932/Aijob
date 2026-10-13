import { expect, it, vi } from "vitest";
import { ProductApiError } from "../../api/client";
import { downloadCurrentPreview } from "./preview-download";

it("rebuilds an expired current preview once and downloads the replacement artifact", async () => {
  const old = { artifact: { id: "expired" }, draftRevision: 7, requestGeneration: 3 };
  const fresh = { ...old, artifact: { id: "fresh" } };
  const resolve = vi.fn(async (force: boolean) => (force ? fresh : old));
  const download = vi.fn(async (id: string) => {
    if (id === "expired") throw new ProductApiError("文件已过期", 404, "RESUME_EXPORT_NOT_FOUND");
  });
  expect(await downloadCurrentPreview(resolve, download)).toEqual(fresh);
  expect(resolve.mock.calls).toEqual([[false], [true]]);
  expect(download.mock.calls).toEqual([["expired"], ["fresh"]]);
});

it("does not recreate a preview for unrelated failures or retry a replacement indefinitely", async () => {
  const preview = { artifact: { id: "preview" } };
  const resolve = vi.fn(async () => preview);
  const forbidden = new ProductApiError("当前会话不可读取", 403, "OWNER_EPOCH_STALE");
  await expect(
    downloadCurrentPreview(resolve, async () => {
      throw forbidden;
    }),
  ).rejects.toBe(forbidden);
  expect(resolve).toHaveBeenCalledTimes(1);
  resolve.mockClear();
  const missing = new ProductApiError("文件已过期", 404, "RESUME_EXPORT_NOT_FOUND");
  const download = vi.fn(async () => {
    throw missing;
  });
  await expect(downloadCurrentPreview(resolve, download)).rejects.toBe(missing);
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(download).toHaveBeenCalledTimes(2);
});
