/** One-shot evaluation of the separately sealed, synthetic native import holdout. */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractNativeResumeBlocks } from "../../apps/platform/dist/resume/native-extraction.js";
import { importNativeChineseBlocks, nativeTextBlocks } from "../../packages/resume-core/dist/index.js";

const root = resolve(import.meta.dirname, "../..");
const setName = process.argv[2] ?? "fresh-holdout";
if (!/^[a-z0-9-]+$/.test(setName)) throw new Error("Invalid holdout name");
const corpus = resolve(root, ".data/resume-native-import-acceptance-20260923", setName);
const results = resolve(root, ".data/resume-native-import-acceptance-20260923/results");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifestBuffer = await readFile(resolve(corpus, "manifest.json"));
const seal = JSON.parse(await readFile(resolve(corpus, "seal.json"), "utf8"));
const manifest = JSON.parse(manifestBuffer.toString("utf8"));
if (sha256(manifestBuffer) !== seal.manifestSha256 || manifest.length !== seal.count)
  throw new Error("Sealed manifest has changed; refusing evaluation");
await mkdir(results, { recursive: true });
const output = resolve(results, `${setName}-evaluation.json`);
try {
  await readFile(output);
  throw new Error("Fresh holdout has already been evaluated; refusing a second run");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const parserFiles = [
  "apps/platform/dist/resume/native-extraction.js",
  "apps/platform/dist/resume/parse.js",
  "packages/resume-core/dist/index.js",
];
const parserHashes = Object.fromEntries(await Promise.all(parserFiles.map(async (file) => [file, sha256(await readFile(resolve(root, file)))])));
const primaryKeys = { education: "school", experience: "company", projects: "name", research: "name", skills: "name", volunteer: "organization", publications: "title", languages: "language", certifications: "title", awards: "title" };
const allCategories = Object.keys(primaryKeys);
function plain(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").normalize("NFKC").replace(/\s+/g, "").replace(/[—–−－]/g, "-").toLowerCase();
}
function getItems(data, category) {
  if (category === "research") return (data.customSections ?? []).filter((section) => section.aijobKind === "research").flatMap((section) => section.items ?? []);
  return data.sections?.[category]?.items ?? [];
}
const rows = [];
const checks = [];
for (const fixture of manifest) {
  const file = await readFile(resolve(corpus, fixture.file));
  if (sha256(file) !== fixture.sha256) throw new Error(`Sealed input ${fixture.id} changed; refusing evaluation`);
  const row = { id: fixture.id, kind: fixture.kind, extraction: "ok", blockCount: 0, unmappedBlocks: 0, unmatchedExpected: [], unexpectedEntries: [] };
  try {
    const blocks = fixture.kind === "text" ? nativeTextBlocks(file.toString("utf8")) : (await extractNativeResumeBlocks({ kind: fixture.kind.startsWith("pdf") ? "pdf" : "docx", buffer: file, timeoutMs: 20_000 })).blocks;
    const parsed = importNativeChineseBlocks(blocks, `fresh-holdout-${fixture.id}`);
    const data = parsed.document.data;
    row.blockCount = blocks.length;
    const mapped = new Set(parsed.mappings.map((mapping) => mapping.blockId));
    row.unmappedBlocks = blocks.filter((block) => !mapped.has(block.id)).length;
    for (const [field, expected] of Object.entries(fixture.expected.basics)) {
      const actual = data.basics?.[field] ?? "";
      const match = plain(actual) === plain(expected);
      checks.push({ id: fixture.id, kind: fixture.kind, category: "basics", field, match, actualPresent: Boolean(actual) });
    }
    for (const category of allCategories) {
      const expectedItems = fixture.expected[category] ?? [];
      const actualItems = getItems(data, category);
      const used = new Set();
      for (const expected of expectedItems) {
        const key = primaryKeys[category];
        const target = plain(expected[key]);
        const index = actualItems.findIndex((item, i) => !used.has(i) && target && plain(item[key]).includes(target));
        const item = index < 0 ? null : actualItems[index];
        if (index >= 0) used.add(index);
        const primaryMatch = Boolean(item);
        checks.push({ id: fixture.id, kind: fixture.kind, category, field: `entry:${key}`, match: primaryMatch, actualPresent: primaryMatch });
        if (!primaryMatch) row.unmatchedExpected.push({ category, key, expected: expected[key] });
        for (const [field, value] of Object.entries(expected)) {
          if (field === key) continue;
          const actual = field === "evidence" ? item?.description : item?.[field];
          const match = Boolean(actual && plain(actual).includes(plain(value)));
          checks.push({ id: fixture.id, kind: fixture.kind, category, field, match, actualPresent: Boolean(actual) });
        }
      }
      for (const [index, item] of actualItems.entries()) {
        if (used.has(index)) continue;
        row.unexpectedEntries.push({ category, value: String(item[primaryKeys[category]] ?? "").slice(0, 80) });
        checks.push({ id: fixture.id, kind: fixture.kind, category, field: "unexpected-entry", match: false, actualPresent: true, falsePositiveOnly: true });
      }
    }
  } catch (error) {
    row.extraction = error instanceof Error ? error.message : "unknown extraction failure";
    // All expected fields count as misses if the file cannot be imported.
    for (const [category, value] of Object.entries(fixture.expected)) {
      if (category === "basics") for (const field of Object.keys(value)) checks.push({ id: fixture.id, kind: fixture.kind, category, field, match: false, actualPresent: false });
      else for (const item of value) for (const field of Object.keys(item)) checks.push({ id: fixture.id, kind: fixture.kind, category, field: field === primaryKeys[category] ? `entry:${field}` : field, match: false, actualPresent: false });
    }
  }
  rows.push(row);
  console.log(JSON.stringify({ id: row.id, kind: row.kind, extraction: row.extraction, unmatched: row.unmatchedExpected.length, unexpected: row.unexpectedEntries.length, unmappedBlocks: row.unmappedBlocks }));
}
function metrics(filter) {
  const group = checks.filter(filter);
  const tp = group.filter((check) => check.match).length;
  const fp = group.filter((check) => !check.match && check.actualPresent).length;
  const fn = group.filter((check) => !check.match && !check.falsePositiveOnly).length;
  return { checks: group.length, tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
}
const result = {
  scope: "Fresh synthetic holdout; independent renderer, not real-world user samples. Rules were frozen before this run.",
  seal,
  parserHashes,
  rows,
  metrics: {
    overall: metrics(() => true),
    byKind: Object.fromEntries([...new Set(manifest.map((fixture) => fixture.kind))].map((kind) => [kind, metrics((check) => check.kind === kind)])),
    byCategory: Object.fromEntries(["basics", ...allCategories].map((category) => [category, metrics((check) => check.category === category)])),
  },
  checks,
};
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, metrics: result.metrics }));
