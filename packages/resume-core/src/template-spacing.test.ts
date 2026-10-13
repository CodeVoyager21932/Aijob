import { describe, expect, it } from "vitest";
import { getTemplateMetrics } from "../../../vendor/reactive-resume/pdf/src/templates/shared/metrics.js";
import {
  applyNativeTemplate,
  createNativeResumeDocument,
  nativeTemplateCatalog,
  parseNativeResumeDocument,
} from "./index.js";

describe("native spacing units and historical reads", () => {
  it("does not change module spacing when a new Chinese design changes its page margin", () => {
    for (const template of nativeTemplateCatalog) {
      const doc = applyNativeTemplate(createNativeResumeDocument(), template.id);
      const before = getTemplateMetrics(doc.data.metadata.page);
      doc.data.metadata.page.marginY = 66;
      const saved = parseNativeResumeDocument(doc);
      const after = getTemplateMetrics(saved.data.metadata.page);
      expect(before.sectionGap).toBeGreaterThan(0);
      expect(after.sectionGap).toBe(before.sectionGap);
      expect(after.page.paddingVertical).toBe(66);
    }
  });
  it("retains the pinned spacing for documents without the optional extension", () => {
    const historical = createNativeResumeDocument();
    delete historical.data.metadata.page.sectionGap;
    const saved = parseNativeResumeDocument(historical);
    expect(saved.data.metadata.page.sectionGap).toBeUndefined();
    expect(getTemplateMetrics(saved.data.metadata.page).sectionGap).toBe(
      saved.data.metadata.page.marginY,
    );
  });
});
