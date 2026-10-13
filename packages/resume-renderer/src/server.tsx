import { renderToBuffer } from "@react-pdf/renderer";
import { installLocalFontCatalog } from "@reactive-resume/fonts";
import { createNativePdfDocument } from "./document.js";
import { collectNativeItemAnchors, type NativeItemAnchor } from "./layout-anchors.js";

export { installLocalFontCatalog };
export { nativeResumeSemanticTree } from "./document.js";
export async function renderNativeResumePdf(input: unknown) {
  return (await renderNativeResumePdfWithLayout(input)).bytes;
}
export async function renderNativeResumePdfWithLayout(input: unknown) {
  let anchors: NativeItemAnchor[] = [];
  const bytes = await renderToBuffer(
    createNativePdfDocument(input, (payload) => {
      anchors = collectNativeItemAnchors(payload);
    }),
  );
  return { bytes, anchors, diagnostics: [] as string[] };
}
