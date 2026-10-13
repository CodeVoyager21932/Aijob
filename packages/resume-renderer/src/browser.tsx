import { pdf } from "@react-pdf/renderer";
import { installLocalFontCatalog } from "@reactive-resume/fonts";
import { createNativePdfDocument } from "./document.js";
import { collectNativeItemAnchors, type NativeItemAnchor } from "./layout-anchors.js";

export { installLocalFontCatalog };
export { nativeResumeSemanticTree } from "./document.js";
export async function renderNativeResumePreview(input: unknown) {
  return pdf(createNativePdfDocument(input)).toBlob();
}
export async function renderNativeResumePreviewWithLayout(input: unknown) {
  let anchors: NativeItemAnchor[] = [];
  const blob = await pdf(
    createNativePdfDocument(input, (payload) => {
      anchors = collectNativeItemAnchors(payload);
    }),
  ).toBlob();
  return { blob, anchors };
}
