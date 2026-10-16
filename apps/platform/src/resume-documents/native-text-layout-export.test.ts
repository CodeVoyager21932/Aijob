import { createNativeResumeDocument } from "@aijob/resume-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({
  render: vi.fn(),
  pages: 1,
  text: "",
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
import { nativeOutputText } from "./native-output-content.js";

function fixture() {
  const document = createNativeResumeDocument();
  document.data.basics.name = "局部排版验收";
  document.data.basics.phone = "138 0000 0000";
  document.data.summary.title = "个人简介";
  document.data.summary.content = "<p>参与需求访谈，整理用户反馈并跟进改进。</p>";
  document.textLayout = {
    "basics:phone": { sourceText: "138 0000 0000", fontSize: 11, textAlign: "right" },
    "section:summary:title": { sourceText: "个人简介", fontSize: 13.5, spaceBefore: 2 },
    "section:summary:body": {
      sourceText: "参与需求访谈，整理用户反馈并跟进改进。",
      ranges: [{ start: 2, end: 6, fontSize: 11.5 }],
      lineMode: "manual",
      breakAfter: 7,
      inset: 6,
      spaceAfter: 3,
    },
  };
  return document;
}

beforeEach(() => {
  stub.pages = 1;
  stub.text = nativeOutputText(fixture()).join("");
  stub.render.mockReset();
  stub.destroy.mockReset();
  stub.render.mockResolvedValue({ bytes: new Uint8Array([37, 80, 68, 70]), fit: { pageCount: 1 } });
});

describe("generic local text formatting at the formal export boundary", () => {
  it("passes all local styles to the renderer while preserving original resume facts", async () => {
    const document = fixture();
    const original = structuredClone(document);
    expect((await renderResolvedNativeExport(document, "pdf")).pageCount).toBe(1);
    expect(stub.render.mock.calls[0]?.[0]).toEqual(original);
    expect(document).toEqual(original);
    expect(stub.destroy).toHaveBeenCalledOnce();
  });

  it("rejects a styled output that loses the rest of a selected paragraph", async () => {
    const document = fixture();
    const original = structuredClone(document);
    stub.text = "局部排版验收138 0000 0000个人简介需求访谈";
    await expect(renderResolvedNativeExport(document, "pdf")).rejects.toMatchObject({
      statusCode: 422,
      code: "NATIVE_EXPORT_CONTENT_INCOMPLETE",
    });
    expect(document).toEqual(original);
    expect(stub.destroy).toHaveBeenCalledOnce();
  });

  it("rejects actual multi-page output without shrinking the saved local styles", async () => {
    const document = fixture();
    const original = structuredClone(document);
    stub.pages = 2;
    await expect(renderResolvedNativeExport(document, "pdf")).rejects.toMatchObject({
      statusCode: 422,
      code: "NATIVE_SINGLE_PAGE_OVERFLOW",
    });
    expect(document).toEqual(original);
    expect(stub.render).toHaveBeenCalledOnce();
  });

  it.each([
    ["NATIVE_TEXT_LAYOUT_OVERFLOW", "原文和字号已保留"],
    ["NATIVE_TEXT_BREAK_INVALID", "请重新点选文字并指定换行"],
  ])(
    "returns an actionable %s error without rewriting the saved selection",
    async (code, message) => {
      const document = fixture();
      const original = structuredClone(document);
      stub.render.mockRejectedValue(new Error(code));
      await expect(renderResolvedNativeExport(document, "pdf")).rejects.toMatchObject({
        statusCode: 422,
        code,
        message: expect.stringContaining(message),
      });
      expect(document).toEqual(original);
      expect(stub.destroy).not.toHaveBeenCalled();
    },
  );
});
