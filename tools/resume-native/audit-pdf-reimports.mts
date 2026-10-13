import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractNativeResumeBlocks } from "../../apps/platform/dist/resume/native-extraction.js";
import { importNativeChineseBlocks } from "../../packages/resume-core/dist/index.js";

// Read actual PDF glyphs/coordinates, never embedded document JSON. The separately
// saved source is the expected answer only, and is not passed to the parser.
const root = resolve(import.meta.dirname, "../..");
const input = process.argv[process.argv.indexOf("--input") + 1];
if (!process.argv.includes("--input") || !input) throw new Error("--input dir[,dir] is required");
const outputArg = process.argv.indexOf("--out");
const out = resolve(
  root,
  outputArg >= 0
    ? (process.argv[outputArg + 1] ?? ".data/resume-native-k2-20260913/pdf-reimports")
    : ".data/resume-native-k2-20260913/pdf-reimports",
);
await mkdir(out, { recursive: true });
const normalize = (value: string) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, "");
const rows = [];
const inputs = [];
for (const directory of input.split(",")) {
  const dir = resolve(root, directory);
  for (const name of (await readdir(dir)).filter((name) => name.endsWith("-short.json"))) {
    const stem = name.slice(0, -5);
    const [source, bytes] = await Promise.all([
      readFile(resolve(dir, name), "utf8"),
      readFile(resolve(dir, `${stem}.pdf`)),
    ]);
    inputs.push({
      stem,
      source,
      bytes,
      pdfSha256: createHash("sha256").update(bytes).digest("hex"),
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    });
  }
}
await writeFile(
  resolve(out, "input-manifest.json"),
  JSON.stringify(
    inputs.map(({ stem, pdfSha256, sourceSha256 }) => ({ stem, pdfSha256, sourceSha256 })),
    null,
    2,
  ),
);
for (const { stem, source, bytes } of inputs) {
  try {
    const expected = JSON.parse(source).data;
    const { blocks } = await extractNativeResumeBlocks({
      kind: "pdf",
      buffer: bytes,
      timeoutMs: 30000,
    });
    const parsed = importNativeChineseBlocks(blocks, `reimport-${stem}`);
    const actual = parsed.document.data;
    const failures = [];
    const checks = [];
    const compare = (path: string, want: unknown, got: unknown) => {
      if (typeof want !== "string" || !normalize(want)) return;
      const pass = typeof got === "string" && normalize(got) === normalize(want);
      checks.push({ path, pass });
      if (!pass) failures.push({ path, expected: want, actual: got ?? null });
    };
    for (const key of ["name", "headline", "email", "phone", "location"])
      compare(`basics.${key}`, expected.basics[key], actual.basics[key]);
    compare("basics.website.url", expected.basics.website.url, actual.basics.website.url);
    compare("basics.website.label", expected.basics.website.label, actual.basics.website.label);
    for (const [kind, section] of Object.entries(expected.sections) as [
      string,
      { hidden: boolean; items: Record<string, unknown>[] },
    ][]) {
      const wantItems = section.hidden ? [] : section.items.filter((item) => !item.hidden);
      const gotItems = actual.sections[kind]?.items ?? [];
      checks.push({ path: `${kind}.count`, pass: wantItems.length === gotItems.length });
      if (wantItems.length !== gotItems.length)
        failures.push({
          path: `${kind}.count`,
          expected: wantItems.length,
          actual: gotItems.length,
        });
      for (const [index, want] of wantItems.entries()) {
        const title = ["school", "company", "name", "title", "organization", "language"].find(
          (key) => typeof want[key] === "string" && want[key],
        );
        const got = title
          ? gotItems.find(
              (item) => normalize(String(item[title] ?? "")) === normalize(String(want[title])),
            )
          : gotItems[index];
        for (const [key, value] of Object.entries(want)) {
          if (["id", "hidden"].includes(key)) continue;
          if (key === "website" && value && typeof value === "object")
            compare(
              `${kind}[${index}].website.url`,
              (value as { url: string }).url,
              got?.website?.url,
            );
          else compare(`${kind}[${index}].${key}`, value, got?.[key]);
        }
      }
    }
    const mapped = new Set(parsed.mappings.map((item) => item.blockId));
    const unmapped = blocks.filter((block) => !mapped.has(block.id)).length;
    const row = {
      template: stem,
      parserVersion: parsed.parserVersion,
      checks: checks.length,
      passed: checks.filter((check) => check.pass).length,
      unmapped,
      failures,
    };
    rows.push(row);
    await writeFile(resolve(out, `${stem}.json`), JSON.stringify({ blocks, parsed, row }, null, 2));
    console.log(
      JSON.stringify({
        template: stem,
        checks: row.checks,
        passed: row.passed,
        unmapped,
        failures: failures.length,
      }),
    );
  } catch (error) {
    rows.push({ template: stem, error: error instanceof Error ? error.message : String(error) });
  }
}
await writeFile(
  resolve(out, "results.json"),
  JSON.stringify(
    {
      scope:
        "Exact nonempty scalar fields, website URLs, visible built-in item counts and source-block retention; custom-section fields and nested arrays require additional assessment",
      rows,
    },
    null,
    2,
  ),
);
if (rows.some((row) => "error" in row || row.failures.length || row.unmapped)) process.exitCode = 1;
