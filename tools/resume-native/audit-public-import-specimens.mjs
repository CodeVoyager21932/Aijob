/** Boundary audit of pinned public example PDFs; no contents leave ignored .data. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractNativeResumeBlocks } from "../../apps/platform/dist/resume/native-extraction.js";
import { importNativeChineseBlocks } from "../../packages/resume-core/dist/index.js";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, ".data/resume-native-public-specimens-20260923");
const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
const rows = [];
for (const specimen of manifest) {
  const bytes = await readFile(resolve(directory, `${specimen.id}.pdf`));
  if (createHash("sha256").update(bytes).digest("hex") !== specimen.sha256)
    throw new Error(`Source PDF hash changed: ${specimen.id}`);
  const row = { id: specimen.id, repository: specimen.repository, commit: specimen.commit, sha256: specimen.sha256 };
  try {
    const { blocks, warnings } = await extractNativeResumeBlocks({ kind: "pdf", buffer: bytes, timeoutMs: 20_000 });
    const parsed = importNativeChineseBlocks(blocks, `public-specimen-${specimen.id}`);
    const text = blocks.map((block) => block.text).join("\n");
    const sections = Object.fromEntries(Object.entries(parsed.document.data.sections)
      .map(([kind, section]) => [kind, section.items.length]).filter(([, count]) => count > 0));
    const custom = parsed.document.data.customSections.map((section) => ({ kind: section.aijobKind ?? "custom", count: section.items.length }));
    Object.assign(row, {
      status: "parsed", parserVersion: parsed.parserVersion, quality: parsed.quality,
      blockCount: blocks.length, hanCount: [...text.matchAll(/[\p{Script=Han}]/gu)].length,
      mappedCount: new Set(parsed.mappings.map((mapping) => mapping.blockId)).size,
      unclassifiedCount: parsed.unclassifiedBlockIds.length,
      sections, custom, warningCount: warnings.length,
      // Missing Chinese glyph mappings cannot be repaired by section rules.
      textLayer: /[\p{Script=Han}]/u.test(text) ? "Chinese text readable" : "Chinese text unavailable",
    });
  } catch (error) {
    Object.assign(row, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
await writeFile(resolve(directory, "audit.json"), JSON.stringify({
  scope: "Public repository examples; unlabelled boundary audit, not field-accuracy precision/recall",
  rows,
}, null, 2));
