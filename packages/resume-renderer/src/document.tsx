import { nativeTemplateCatalog, parseNativeResumeDocument } from "@aijob/resume-core";
import { BillryanCnPage } from "@reactive-resume/pdf/aijob-billryan";
import { DeedyCnPage } from "@reactive-resume/pdf/aijob-deedy";
import { EngineerCnPage } from "@reactive-resume/pdf/aijob-engineer";
import { EuroCnPage } from "@reactive-resume/pdf/aijob-euro";
import { GengarCnPage } from "@reactive-resume/pdf/aijob-gengar";
import { JpAcademicCnPage } from "@reactive-resume/pdf/aijob-jp-academic";
import { JpAtsCnPage } from "@reactive-resume/pdf/aijob-jp-ats";
import { JpBerlinCnPage } from "@reactive-resume/pdf/aijob-jp-berlin";
import { JpBlocksCnPage } from "@reactive-resume/pdf/aijob-jp-blocks";
import { JpClassicCnPage } from "@reactive-resume/pdf/aijob-jp-classic";
import { JpDesignerCnPage } from "@reactive-resume/pdf/aijob-jp-designer";
import { JpMinimalCnPage } from "@reactive-resume/pdf/aijob-jp-minimal";
import { JpRibbonCnPage } from "@reactive-resume/pdf/aijob-jp-ribbon";
import { JpScientistCnPage } from "@reactive-resume/pdf/aijob-jp-scientist";
import { LapisCnPage } from "@reactive-resume/pdf/aijob-lapis";
import { MagicCleanCnPage } from "@reactive-resume/pdf/aijob-magic-clean";
import { MagicCompactCnPage } from "@reactive-resume/pdf/aijob-magic-compact";
import { MagicExecutiveCnPage } from "@reactive-resume/pdf/aijob-magic-executive";
import { MagicFormalCnPage } from "@reactive-resume/pdf/aijob-magic-formal";
import { MagicProductCnPage } from "@reactive-resume/pdf/aijob-magic-product";
import { ModernCnPage } from "@reactive-resume/pdf/aijob-modern";
import { RenderClassicCnPage } from "@reactive-resume/pdf/aijob-rendercv-classic";
import { RenderEngineeringCnPage } from "@reactive-resume/pdf/aijob-rendercv-engineering";
import { SwissCnPage } from "@reactive-resume/pdf/aijob-swiss";
import { VisikyCnPage } from "@reactive-resume/pdf/aijob-visiky";
import { VisikySingleCnPage } from "@reactive-resume/pdf/aijob-visiky-single";
import { ResumeDocument } from "@reactive-resume/pdf/document";
import { resolveResumeRuntime, resolveStylesheetMode } from "@reactive-resume/pdf/semantic";
import { createElement } from "react";
import { isStudioTemplate } from "./versions.js";

// A single override registry prevents a new identity from accidentally falling
// through a long conditional chain to its upstream base template.
const nativePageOverrides: Record<string, typeof LapisCnPage> = {
  "rendercv-engineering-cn": RenderEngineeringCnPage,
  "rendercv-classic-cn": RenderClassicCnPage,
  "jp-minimal-cn": JpMinimalCnPage,
  "jp-ribbon-cn": JpRibbonCnPage,
  "jp-designer-cn": JpDesignerCnPage,
  "jp-scientist-cn": JpScientistCnPage,
  "jp-berlin-cn": JpBerlinCnPage,
  "jp-blocks-cn": JpBlocksCnPage,

  "jp-classic-cn": JpClassicCnPage,
  "jp-ats-cn": JpAtsCnPage,
  "jp-academic-cn": JpAcademicCnPage,

  "magic-formal-cn": MagicFormalCnPage,
  "magic-product-cn": MagicProductCnPage,
  "magic-clean-cn": MagicCleanCnPage,
  "magic-compact-cn": MagicCompactCnPage,
  "magic-executive-cn": MagicExecutiveCnPage,
  "euro-cn": EuroCnPage,
  "modern-cn": ModernCnPage,
  "lapis-cn": LapisCnPage,
  "gengar-cn": GengarCnPage,
  "billryan-cn": BillryanCnPage,
  "deedy-cn": DeedyCnPage,
  "engineer-cn": EngineerCnPage,
  "swiss-cn": SwissCnPage,
  "visiky-cn": VisikyCnPage,
  "visiky-single-cn": VisikySingleCnPage,
};

// Custom identities must never silently render their upstream base page. Field
// readback alone cannot detect the wrong visual template.
for (const template of nativeTemplateCatalog) {
  if (template.id.startsWith("studio-")) continue;
  if (template.id !== `${template.base}-cn` && !nativePageOverrides[template.id]) {
    throw new Error(`NATIVE_TEMPLATE_RENDERER_MISSING:${template.id}`);
  }
}

/** Both targets use precisely the same native document, locale and options. */
export function createNativePdfDocument(input: unknown, onRender?: (payload: unknown) => void) {
  if (isStudioTemplate(input)) throw new Error("NATIVE_TEMPLATE_SERVER_RENDER_REQUIRED");
  const { data, presentation } = parseNativeResumeDocument(input);
  if (data.picture.url && !/^data:image\/(png|jpeg);base64,/.test(data.picture.url)) {
    throw new Error("NATIVE_PHOTO_MUST_BE_RESOLVED_BY_OWNER_SERVICE");
  }
  for (const role of [data.metadata.typography.body, data.metadata.typography.heading]) {
    if (!["Noto Sans SC", "Noto Serif SC"].includes(role.fontFamily))
      throw new Error("NATIVE_FONT_FAMILY_NOT_INSTALLED");
  }
  const inspect = (value: unknown): void => {
    if (
      typeof value === "string" &&
      (/<\s*(?:img|svg|iframe|script|style|video|audio|object|embed|link)\b/i.test(value) ||
        /\b(?:src|srcset)\s*=/i.test(value))
    )
      throw new Error("NATIVE_RICH_TEXT_EXTERNAL_RESOURCE");
    if (Array.isArray(value)) for (const item of value) inspect(item);
    else if (value && typeof value === "object")
      for (const item of Object.values(value)) inspect(item);
  };
  inspect(data.summary);
  inspect(data.sections);
  inspect(data.customSections);
  return createElement(ResumeDocument, {
    onRender,
    data,
    template: data.metadata.template,
    ...(presentation?.id && nativePageOverrides[presentation.id]
      ? { templatePage: nativePageOverrides[presentation.id] }
      : {}),
    renderOptions: { includeCoverLetterHeader: false },
  });
}

/** Stable native field/item keys for editor mapping; not guessed PDF coordinates. */
export function nativeResumeSemanticTree(input: unknown) {
  const { data } = parseNativeResumeDocument(input);
  return resolveResumeRuntime({
    data,
    template: data.metadata.template,
    mode: resolveStylesheetMode(data),
  }).sourceTree;
}
