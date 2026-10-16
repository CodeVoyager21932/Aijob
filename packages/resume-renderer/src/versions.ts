/** Persist these on artifacts, never in the upstream resume content schema. */
export const studioTemplateIds = new Set([
  "studio-campus-cn",
  "studio-banner-cn",
  "studio-index-cn",
  "studio-sidebar-cn",
  "studio-layered-cn",
  "studio-cards-cn",
  "studio-clear-cn",
  "studio-compact-cn",
  "studio-main-cn",
  "studio-research-cn",
]);
export function isStudioTemplate(input: unknown): boolean {
  const id = (input as { presentation?: { id?: string } })?.presentation?.id;
  return typeof id === "string" && studioTemplateIds.has(id);
}
export function nativeRendererVersions(input: unknown) {
  return isStudioTemplate(input)
    ? {
        rendererVersion: "rr6-0c6e75e-forme-0.28-aijob-12-text-layout",
        fontSetVersion: "aijob-studio-ttf-v1",
        manifestVersion: "native-fields-links-v3",
      }
    : {
        rendererVersion: "native-react-pdf-cn-v12-single-page",
        fontSetVersion: "aijob-v3-local",
        manifestVersion: "native-fields-links-v3",
      };
}
