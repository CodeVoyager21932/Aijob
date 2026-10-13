import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  parseResumeBuffer,
  resumeParserContainerArguments,
} from "../../apps/platform/src/resume/parse.ts";

const image = process.env.AIJOB_PARSER_TEST_IMAGE;
const folder = process.env.AIJOB_EXPORT_TEST_DIRECTORY;
if (!image || !folder)
  throw new Error("Set the verified parser image digest and synthetic export folder");
resumeParserContainerArguments(image, "parse-pdf");
const output = resolve(folder);
const results = [];
const pdfs = (await readdir(output)).filter((name) => name.endsWith(".pdf")).sort();
if (pdfs.length !== 16) throw new Error("EXPECTED_16_SYNTHETIC_PDFS");
for (const filename of [...pdfs, "cn_classic_single_column-long.docx"]) {
  const kind = filename.endsWith(".pdf") ? "pdf" : "docx";
  const began = performance.now();
  const text = await parseResumeBuffer({
    kind,
    buffer: await readFile(resolve(output, filename)),
    sandbox: { mode: "container", containerImage: image },
  });
  const compact = text.replace(/\s/g, "");
  if (
    !compact.includes("林同学") ||
    !compact.includes("13800000000") ||
    !text.includes("fixture@example.test") ||
    /[\u2f00-\u2fdf\ufb00-\ufb06]/u.test(text)
  )
    throw new Error(`CONTACT_OR_CHINESE_TEXT_LOST:${filename}`);
  const isLong = filename.includes("-long");
  if (
    isLong &&
    JSON.stringify(compact.match(/记录\d{3}/g) ?? []) !==
      JSON.stringify(
        Array.from({ length: 75 }, (_, index) => `记录${String(index + 1).padStart(3, "0")}`),
      )
  )
    throw new Error(`LONG_DOCUMENT_RECORDS_LOST:${filename}`);
  results.push({
    filename,
    kind,
    elapsedMs: Math.round(performance.now() - began),
    characters: text.length,
    chineseAndContactsPreserved: true,
    rawEmailUnchanged: true,
    ...(isLong ? { records: 75 } : {}),
  });
  console.info(JSON.stringify(results.at(-1)));
}
let malformedRejected = false;
try {
  await parseResumeBuffer({
    kind: "pdf",
    buffer: Buffer.from("%PDF-1.7\ninvalid synthetic fixture"),
    sandbox: { mode: "container", containerImage: image },
  });
} catch (error) {
  malformedRejected =
    error instanceof Error && "code" in error && error.code === "RESUME_PARSE_FAILED";
}
const report = {
  verifiedAt: new Date().toISOString(),
  image,
  network: "none",
  readOnly: true,
  capDrop: "ALL",
  memoryMiB: 256,
  cpus: 0.5,
  timeoutMs: 10000,
  results,
  malformedRejected,
};
await writeFile(resolve(output, "parser-verification.json"), JSON.stringify(report, null, 2));
console.info(JSON.stringify(report));
if (!malformedRejected) throw new Error("MALFORMED_INPUT_NOT_REJECTED");
