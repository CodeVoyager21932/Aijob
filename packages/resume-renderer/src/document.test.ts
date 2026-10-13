import {
  applyNativeTemplate,
  createNativeResumeDocument,
  nativeTemplateCatalog,
} from "@aijob/resume-core";
import { describe, expect, it } from "vitest";
import { createNativePdfDocument } from "./document.js";

describe("native renderer resource boundary", () => {
  it("requires a dedicated page for every custom Chinese identity", () => {
    for (const template of nativeTemplateCatalog.filter(
      (t) => !t.id.startsWith("studio-") && t.id !== `${t.base}-cn`,
    )) {
      const element = createNativePdfDocument(
        applyNativeTemplate(createNativeResumeDocument(), template.id),
      );
      expect(element.props.templatePage, template.id).toBeTypeOf("function");
    }
  });
  it("reserves studio templates for the authoritative server renderer", () => {
    expect(() =>
      createNativePdfDocument(applyNativeTemplate(createNativeResumeDocument(), "studio-clear-cn")),
    ).toThrow("NATIVE_TEMPLATE_SERVER_RENDER_REQUIRED");
  });
  it("rejects unowned remote photo URLs before rendering", () => {
    const doc = applyNativeTemplate(createNativeResumeDocument(), "lapis-cn");
    doc.data.picture.url = "http://127.0.0.1/private";
    expect(() => createNativePdfDocument(doc)).toThrow(
      "NATIVE_PHOTO_MUST_BE_RESOLVED_BY_OWNER_SERVICE",
    );
  });
  it("does not fetch image resources embedded in rich text", () => {
    const doc = applyNativeTemplate(createNativeResumeDocument(), "lapis-cn");
    doc.data.summary.content = '<p>经历</p><img src="https://example.com/tracker.png">';
    expect(() => createNativePdfDocument(doc)).toThrow("NATIVE_RICH_TEXT_EXTERNAL_RESOURCE");
  });
  it("does not silently substitute an unavailable font", () => {
    const doc = applyNativeTemplate(createNativeResumeDocument(), "lapis-cn");
    doc.data.metadata.typography.body.fontFamily = "unavailable";
    expect(() => createNativePdfDocument(doc)).toThrow("NATIVE_FONT_FAMILY_NOT_INSTALLED");
  });
  it("allows ordinary hyperlink text without fetching the target", () => {
    const doc = applyNativeTemplate(createNativeResumeDocument(), "lapis-cn");
    doc.data.summary.content = '<p>作品：<a href="https://example.com/portfolio">项目报告</a></p>';
    expect(() => createNativePdfDocument(doc)).not.toThrow();
  });
});
