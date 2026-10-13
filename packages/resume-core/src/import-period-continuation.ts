import type { NativeImportBlock } from "./import-blocks.js";

/** A PDF line wrap may split one date range after its start date. Keep both source IDs. */
export function joinNativePeriodContinuations(
  source: readonly NativeImportBlock[],
  explicitBoundaries: ReadonlySet<string> = new Set(),
) {
  const blocks: NativeImportBlock[] = [];
  const continuations = new Map<string, string>();
  const startAtEnd = /(?:19|20)\d{2}(?:[.年/-]\d{1,2}月?)\s*$/;
  const endOnly =
    /^\s*[–—~～至-]\s*(?:(?:19|20)\d{2}(?:[.年/-]\d{1,2}月?)?|至今|现在|今)\s*[)）]?\s*$/;
  for (let index = 0; index < source.length; index++) {
    const block = source[index];
    if (!block) continue;
    const next = source[index + 1];
    if (
      next &&
      block.source.kind === "pdf" &&
      next.source.kind === "pdf" &&
      block.source.page === next.source.page &&
      block.source.column === next.source.column &&
      next.source.y > block.source.y &&
      next.source.y - block.source.y <= Math.max(block.source.height, next.source.height) * 2.2 &&
      !block.link &&
      !next.link &&
      !explicitBoundaries.has(next.id) &&
      startAtEnd.test(block.text) &&
      endOnly.test(next.text)
    ) {
      blocks.push({ ...block, text: `${block.text} ${next.text.trim()}` });
      continuations.set(block.id, next.id);
      index++;
    } else blocks.push(block);
  }
  return { blocks, continuations };
}
