import { loadRegressionInputs, runOutput } from "./regression-inputs.mjs";
/** Eight existing inputs only. Keeps the first result and all personal values in ignored .data. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { extractNativeResumeBlocks } from "../../apps/platform/dist/resume/native-extraction.js";
import {
  importNativeChineseBlocks,
  joinNativeResumeDocument,
  splitNativeResumeDocument,
} from "../../packages/resume-core/dist/index.js";

const root = resolve(import.meta.dirname, "../..");
const resume = process.argv.includes("--resume-saved");
if (resume && !process.env.AIJOB_IMPORT_OUTPUT)
  throw new Error("--resume-saved 需要 AIJOB_IMPORT_OUTPUT 明确指定先前结果目录。");
const out = resolve(process.env.AIJOB_IMPORT_OUTPUT || runOutput("resume-import-fields"));
await mkdir(out, { recursive: true });
// A second invocation cannot replace the first observation.
if (!resume)
  await writeFile(
    resolve(out, "started.json"),
    JSON.stringify({
      startedAt: new Date().toISOString(),
      purpose: "targeted-existing-material-check",
      notBlind: true,
    }),
    { flag: "wx" },
  );
else await readFile(resolve(out, "started.json"), "utf8");
const inputs = await loadRegressionInputs();
await inputs.verify();
const cases = inputs.cases;
const manifest = inputs.cases;
const independent = inputs.expectations.independent;
const postfix = [inputs.expectations.postfix];
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, "")
    .replace(/[—–－]/g, "-");
const rows = [];
for (const sample of cases) {
  const bytes = await readFile(resolve(root, sample.file));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const pinned = manifest.find((row) => row.id === sample.id);
  if (pinned && pinned.sha256 !== sha256) throw new Error(`INPUT_HASH_CHANGED:${sample.id}`);
  const checks = [];
  const check = (field, pass, basis) => checks.push({ field, pass: !!pass, basis });
  const existing = resume
    ? await readFile(resolve(out, `${sample.id}.private.json`), "utf8")
        .then(JSON.parse)
        .catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        })
    : null;
  const { blocks, warnings = [] } =
    existing ??
    (await extractNativeResumeBlocks({ kind: sample.kind, buffer: bytes, timeoutMs: 20000 }));
  const parsed = existing?.parsed ?? importNativeChineseBlocks(blocks, `upgrade:${sample.id}`);
  const document = parsed.document,
    data = document.data;
  const source = blocks.map((block) => block.text).join("\n");
  const items = (kind) =>
    kind === "research"
      ? data.customSections
          .filter((section) => section.aijobKind === kind)
          .flatMap((section) => section.items)
      : (data.sections[kind]?.items ?? []);
  const pair = splitNativeResumeDocument(document);
  check(
    "sourceBindings.storageRoundTrip",
    isDeepStrictEqual(joinNativeResumeDocument(pair.content, pair.layout), document),
    "envelope-round-trip",
  );
  check(
    "sourceBindings.everyExtractedBlock",
    blocks.every((block) =>
      document.sourceBindings.some((binding) => binding.blockId === block.id),
    ),
    "coverage-not-accuracy",
  );
  if (sample.expectation === "unreadable-cn-negative") {
    check(
      "textLayer.noReadableChinese",
      !/\p{Script=Han}/u.test(source),
      "existing-known-negative",
    );
    check(
      "document.quality",
      parsed.quality === "unstructured",
      "must-not-claim-recovered-chinese",
    );
    check(
      "education.noInventedChineseSchool",
      !items("education").some((item) => /\p{Script=Han}/u.test(item.school)),
      "missing-glyphs-are-not-reconstructed",
    );
  } else {
    check("textLayer.readableChinese", /\p{Script=Han}/u.test(source), "source-text-layer");
    const emails = [...new Set(source.match(/[a-z\d._%+-]+@[a-z\d.-]+\.[a-z]{2,}/gi) ?? [])];
    if (emails.length === 1)
      check(
        "basics.email",
        normalize(data.basics.email) === normalize(emails[0]),
        "independent-source-token-exact",
      );
    const phones = [...new Set(source.match(/(?<!\d)1[3-9]\d{9}(?!\d)/g) ?? [])];
    if (phones.length === 1)
      check(
        "basics.phone",
        normalize(data.basics.phone).includes(phones[0]),
        "independent-source-token-exact",
      );
    if (sample.expectation === "source-token-fields") {
      // These bounded checks do not make the public examples a hand-labelled field gold set.
      check(
        "education.school.present",
        items("education").some((item) => item.school.trim()),
        "public-example-contract",
      );
      const periods = [
        ...new Set(
          source.match(
            /(?:19|20)\d{2}[.年/-]\d{1,2}(?:月)?\s*[—–－~至-]\s*(?:(?:19|20)\d{2}[.年/-]\d{1,2}(?:月)?|至今|现在)/g,
          ) ?? [],
        ),
      ];
      const allPeriods = Object.values(data.sections)
        .flatMap((section) => section.items)
        .concat(data.customSections.flatMap((section) => section.items))
        .map((item) => normalize(item.period ?? item.date));
      for (const [index, period] of periods.entries())
        check(
          `entries.period.sourceToken${index + 1}`,
          allPeriods.some((value) => value.includes(normalize(period))),
          "source-range-must-be-structured-field",
        );
    }
    if (sample.id === "word-table-case20") {
      for (const [kind, names] of Object.entries(independent.expected)) {
        const key = {
          education: "school",
          experience: "company",
          projects: "name",
          research: "name",
          volunteer: "organization",
        }[kind];
        check(
          `${kind}.itemCount`,
          items(kind).length === names.length,
          "existing-independent-manifest",
        );
        for (const [index, name] of names.entries())
          check(
            `${kind}.${key}[${index}]`,
            items(kind).some((item) => normalize(item[key]).includes(normalize(name))),
            "existing-independent-manifest",
          );
      }
      for (const [index, expected] of [
        { degree: "本科", area: "信息管理", period: "2023.09-2027.06" },
        { degree: "硕士", area: "管理科学", period: "2027.09-至今" },
      ].entries())
        for (const [field, expectedValue] of Object.entries(expected))
          check(
            `education.${field}[${index}]`,
            normalize(items("education")[index]?.[field]) === normalize(expectedValue),
            "existing-generator-field-expectation",
          );
    }
    if (sample.id === "existing-medium-word") {
      check("education.itemCount", items("education").length === 2, "existing-medium-fixture");
      check("experience.itemCount", items("experience").length === 3, "existing-medium-fixture");
    }
    if (sample.id === "existing-text-P09") {
      const entry = (Array.isArray(postfix) ? postfix : postfix.cases).find(
        (row) => row.id === "P09",
      );
      for (const [key, value] of Object.entries(entry.expected.basics ?? {}))
        check(
          `basics.${key}`,
          normalize(data.basics[key]) === normalize(value),
          "existing-frozen-field-manifest",
        );
      for (const [kind, expectedItems] of Object.entries(entry.expected)) {
        if (kind === "basics") continue;
        check(
          `${kind}.itemCount`,
          items(kind).length === expectedItems.length,
          "existing-frozen-field-manifest",
        );
        for (const [index, expectedItem] of expectedItems.entries())
          for (const [field, expectedValue] of Object.entries(expectedItem)) {
            const target = field === "evidence" ? "description" : field;
            check(
              `${kind}.${target}[${index}]`,
              normalize(items(kind)[index]?.[target]).includes(normalize(expectedValue)),
              "existing-frozen-field-manifest",
            );
          }
      }
    }
  }
  const row = {
    id: sample.id,
    sha256,
    kind: sample.kind,
    expectation: sample.expectation,
    parserVersion: parsed.parserVersion,
    quality: parsed.quality,
    blockCount: blocks.length,
    unclassifiedCount: parsed.unclassifiedBlockIds.length,
    checks,
    warnings: warnings.length,
  };
  if (!existing)
    await writeFile(
      resolve(out, `${sample.id}.private.json`),
      JSON.stringify({ blocks, parsed, warnings }, null, 2),
      { flag: "wx" },
    );
  rows.push(row);
  await writeFile(
    resolve(out, `${sample.id}.${resume ? "recheck" : "summary"}.json`),
    JSON.stringify(row, null, 2),
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      id: row.id,
      checks: checks.length,
      failedFields: checks.filter((check) => !check.pass).map((check) => check.field),
    }),
  );
}
await writeFile(
  resolve(out, "summary.json"),
  JSON.stringify(
    {
      notBlind: true,
      scope: "8 existing files; public source-token checks are not a field accuracy score",
      rows,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
