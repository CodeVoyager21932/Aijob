import { z } from "zod";

const fontSize = z.number().min(9.5).max(36).multipleOf(0.5);
const offset = z.number().int().nonnegative().max(100000);
export const nativeTextRangeSchema = z.strictObject({ start: offset, end: offset, fontSize });
export type NativeTextRange = z.infer<typeof nativeTextRangeSchema>;

/** Selection offsets refer to the untouched display text, in UTF-16 code units. */
export function isNativeTextBoundary(text: string, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index > text.length) return false;
  if (index === 0 || index === text.length) return true;
  return [...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(text)].some(
    (segment) => segment.index === index,
  );
}

export const nativeTextLayoutSchema = z
  .strictObject({
    sourceText: z.string().min(1).max(100000),
    fontSize: fontSize.optional(),
    lineMode: z.enum(["auto", "single", "manual"]).optional(),
    breakAfter: offset.optional(),
    textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
    inset: z.number().min(0).max(36).optional(),
    spaceBefore: z.number().min(0).max(24).optional(),
    spaceAfter: z.number().min(0).max(24).optional(),
    ranges: z.array(nativeTextRangeSchema).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.lineMode === "manual" &&
      (value.breakAfter === undefined ||
        !isNativeTextBoundary(value.sourceText, value.breakAfter) ||
        !value.sourceText.slice(0, value.breakAfter).trim() ||
        !value.sourceText.slice(value.breakAfter).trim())
    )
      ctx.addIssue({
        code: "custom",
        path: ["breakAfter"],
        message: "Invalid text break boundary",
      });
    let previousEnd = 0;
    for (const [index, range] of (value.ranges ?? []).entries()) {
      if (
        range.start < previousEnd ||
        range.end <= range.start ||
        !isNativeTextBoundary(value.sourceText, range.start) ||
        !isNativeTextBoundary(value.sourceText, range.end)
      )
        ctx.addIssue({
          code: "custom",
          path: ["ranges", index],
          message: "Invalid text selection range",
        });
      previousEnd = range.end;
    }
  });
export type NativeTextLayout = z.infer<typeof nativeTextLayoutSchema>;
export const nativeTextLayoutsSchema = z
  .record(
    z
      .string()
      .max(512)
      .regex(/^(?:basics|section|entry):[\w:./%~-]+$/u),
    nativeTextLayoutSchema,
  )
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 1000)
      ctx.addIssue({ code: "custom", message: "Too many local text layouts" });
  });

/** A newer explicit selection overrides only the intersecting part of previous ranges. */
export function setNativeTextRange(
  ranges: readonly NativeTextRange[],
  next: NativeTextRange,
): NativeTextRange[] {
  const result = ranges.flatMap((range) => {
    if (range.end <= next.start || range.start >= next.end) return [{ ...range }];
    return [
      ...(range.start < next.start ? [{ ...range, end: next.start }] : []),
      ...(range.end > next.end ? [{ ...range, start: next.end }] : []),
    ];
  });
  result.push({ ...next });
  result.sort((a, b) => a.start - b.start);
  const merged: NativeTextRange[] = [];
  for (const range of result) {
    const last = merged.at(-1);
    if (last && last.end === range.start && last.fontSize === range.fontSize) last.end = range.end;
    else merged.push({ ...range });
  }
  return merged;
}
