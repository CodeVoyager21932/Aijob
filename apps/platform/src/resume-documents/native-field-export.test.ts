import { applyNativeTemplate, createNativeResumeDocument } from "@aijob/resume-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({
  render: vi.fn(),
  pages: 2,
  text: "排版夹具小学教育 · 教研与阅读活动助理shuning.zhou@example.com",
  destroy: vi.fn(),
}));

vi.mock("@aijob/resume-renderer/isolated", () => ({
  renderNativePdfArtifactIsolated: stub.render,
  nativeRendererVersions: vi.fn(),
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: stub.pages,
      getPage: async () => ({
        getAnnotations: async () => [],
        getTextContent: async () => ({ items: [{ str: stub.text }] }),
      }),
    }),
    destroy: stub.destroy,
  }),
}));

import { renderResolvedNativeExport } from "./native-export.js";

function fixture() {
  const document = applyNativeTemplate(createNativeResumeDocument(), "studio-sidebar-cn");
  document.data.basics.name = "排版夹具";
  document.data.basics.headline = "小学教育 · 教研与阅读活动助理";
  document.data.basics.email = "shuning.zhou@example.com";
  document.fieldLayout = {
    headline: { fontSize: 12, lineMode: "manual", breakAfter: 7, position: "main" },
    email: { fontSize: 10.5, lineMode: "single", position: "main" },
  };
  return document;
}

beforeEach(() => {
  stub.pages = 2;
  stub.render.mockReset();
  stub.destroy.mockReset();
  stub.render.mockResolvedValue({ bytes: new Uint8Array([37, 80, 68, 70]) });
});

describe("native field export service boundary", () => {
  it.each([undefined, { pageCount: 1 }, { pageCount: 2 }])(
    "rejects a real two-page PDF on a formal export regardless of fit metadata %j",
    async (fit) => {
      const document = fixture();
      const original = structuredClone(document);
      stub.render.mockResolvedValue({ bytes: new Uint8Array([37, 80, 68, 70]), fit });
      await expect(renderResolvedNativeExport(document, "pdf")).rejects.toMatchObject({
        statusCode: 422,
        code: "NATIVE_SINGLE_PAGE_OVERFLOW",
        message: expect.stringContaining("完整内容已保留"),
      });
      expect(document).toEqual(original);
      expect(stub.destroy).toHaveBeenCalledOnce();
    },
  );

  it("allows an explicit overflow preview while leaving facts and user formatting intact", async () => {
    const document = fixture();
    const original = structuredClone(document);
    const result = await renderResolvedNativeExport(document, "pdf", {
      allowOverflowPreview: true,
    });
    expect(result.pageCount).toBe(2);
    expect(result.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(document).toEqual(original);
    expect(stub.destroy).toHaveBeenCalledOnce();
  });

  it("still exports a verified single-page result by default", async () => {
    stub.pages = 1;
    const document = fixture();
    const original = structuredClone(document);
    expect((await renderResolvedNativeExport(document, "pdf")).pageCount).toBe(1);
    expect(document).toEqual(original);
    expect(stub.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    ["NATIVE_FIELD_EMAIL_TOO_WIDE", "请选择宽页首或自动位置"],
    ["NATIVE_FIELD_HEADLINE_TOO_WIDE", "请调整换行位置"],
    ["NATIVE_FIELD_BREAK_INVALID", "请重新指定换行位置或恢复自动换行"],
  ])("maps %s to an actionable 422 without changing the draft", async (code, action) => {
    const document = fixture();
    const original = structuredClone(document);
    stub.render.mockRejectedValue(new Error(code));
    await expect(renderResolvedNativeExport(document, "pdf")).rejects.toMatchObject({
      statusCode: 422,
      code,
      message: expect.stringContaining(action),
    });
    expect(document).toEqual(original);
    expect(stub.destroy).not.toHaveBeenCalled();
  });
});
