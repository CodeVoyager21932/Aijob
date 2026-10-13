import type { NativeResumeDocument } from "@aijob/resume-core";

export function assertNativeRenderResources({ data }: NativeResumeDocument) {
  if (data.picture.url && !/^data:image\/(png|jpeg);base64,/.test(data.picture.url))
    throw new Error("NATIVE_PHOTO_MUST_BE_RESOLVED_BY_OWNER_SERVICE");
  for (const role of [data.metadata.typography.body, data.metadata.typography.heading])
    if (!["Noto Sans SC", "Noto Serif SC"].includes(role.fontFamily))
      throw new Error("NATIVE_FONT_FAMILY_NOT_INSTALLED");
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
}
