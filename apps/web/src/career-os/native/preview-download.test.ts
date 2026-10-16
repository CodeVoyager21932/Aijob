import { expect, it, vi } from "vitest";
import { ProductApiError } from "../../api/client";
import { downloadCurrentPreview } from "./preview-download";

it("rebuilds an expired current preview once and downloads the replacement artifact", async () => {
  const old = { artifact: { id: "expired" }, draftRevision: 7, requestGeneration: 3 };
  const fresh = { ...old, artifact: { id: "fresh" } };
  const resolve = vi.fn(async (force: boolean) => (force ? fresh : old));
  const download = vi.fn(async (id: string, _fileName: string) => {
    if (id === "expired") throw new ProductApiError("文件已过期", 404, "RESUME_EXPORT_NOT_FOUND");
  });
  expect(await downloadCurrentPreview(resolve, download, "当前稿件")).toEqual(fresh);
  expect(resolve.mock.calls).toEqual([[false], [true]]);
  expect(download.mock.calls).toEqual([
    ["expired", "Aijob-当前稿件.pdf"],
    ["fresh", "Aijob-当前稿件.pdf"],
  ]);
});

it("uses the renamed current draft for a cached PDF without changing its retained name", async () => {
  const cached = {
    artifact: { id: "retained-pdf", fileName: "Aijob-旧稿件.pdf" },
    draftRevision: 7,
  };
  const resolve = vi.fn(async () => cached);
  const download = vi.fn(async (_id: string, _fileName: string) => {});

  expect(await downloadCurrentPreview(resolve, download, "  新方向／运营：实习\n稿  ")).toBe(
    cached,
  );
  expect(resolve.mock.calls).toEqual([[false]]);
  expect(download.mock.calls).toEqual([["retained-pdf", "Aijob-新方向 运营 实习 稿.pdf"]]);
  expect(cached.artifact.fileName).toBe("Aijob-旧稿件.pdf");
});

it("does not recreate a preview for unrelated failures or retry a replacement indefinitely", async () => {
  const preview = { artifact: { id: "preview" } };
  const resolve = vi.fn(async () => preview);
  const forbidden = new ProductApiError("当前会话不可读取", 403, "OWNER_EPOCH_STALE");
  await expect(
    downloadCurrentPreview(
      resolve,
      async () => {
        throw forbidden;
      },
      "当前稿件",
    ),
  ).rejects.toBe(forbidden);
  expect(resolve).toHaveBeenCalledTimes(1);
  resolve.mockClear();
  const missing = new ProductApiError("文件已过期", 404, "RESUME_EXPORT_NOT_FOUND");
  const download = vi.fn(async () => {
    throw missing;
  });
  await expect(downloadCurrentPreview(resolve, download, "当前稿件")).rejects.toBe(missing);
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(download).toHaveBeenCalledTimes(2);
});
