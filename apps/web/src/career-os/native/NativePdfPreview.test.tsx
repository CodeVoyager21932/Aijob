import { createNativeResumeDocument } from "@aijob/resume-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NativePdfPreview } from "./NativePdfPreview";

vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: { workerSrc: "" } }));
vi.mock("./preview-queue", () => ({ nativePreviewQueue: {} }));

describe("native PDF preview loading feedback", () => {
  it("does not report a downloaded specimen as displayed before its PDF page exists", () => {
    const markup = renderToStaticMarkup(
      <NativePdfPreview
        document={createNativeResumeDocument()}
        authoritative
        fixedBlob={new Blob(["fixture"], { type: "application/pdf" })}
        pendingMessage="完整样张 · 市场营销在校生"
      />,
    );
    expect(markup).toContain("正在显示完整纸张…");
    expect(markup).toContain('data-empty-message="正在显示完整纸张…"');
    expect(markup).not.toContain("完整样张 · 市场营销在校生");
  });

  it("keeps the source download message visible while the file is pending", () => {
    const markup = renderToStaticMarkup(
      <NativePdfPreview
        document={createNativeResumeDocument()}
        authoritative
        pendingMessage="正在打开完整样张…"
      />,
    );
    expect(markup).toContain('data-empty-message="正在打开完整样张…"');
    expect(markup).toContain('aria-busy="true"');
  });
});
