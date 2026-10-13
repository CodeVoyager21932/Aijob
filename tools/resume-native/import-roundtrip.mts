import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractNativeResumeBlocks } from "../../apps/platform/src/resume/native-extraction.js";
import {
  importNativeChineseBlocks,
  parseNativeResumeDocument,
} from "../../packages/resume-core/dist/index.js";

const root = resolve(import.meta.dirname, "../.."),
  out = resolve(root, ".data/resume-native-k2-20260912");
await mkdir(out, { recursive: true });
const results = [];
for (const template of ["lapis-cn", "gengar-cn", "rhyhorn-cn"])
  for (const kind of ["pdf", "docx"] as const) {
    const buffer = await readFile(
      resolve(root, `.data/resume-native-k1-20260912/matrix/${template}-medium.${kind}`),
    );
    const extracted = await extractNativeResumeBlocks({
      kind,
      buffer,
      timeoutMs: 30000,
    } as Parameters<typeof extractNativeResumeBlocks>[0]);
    const parsed = importNativeChineseBlocks(extracted.blocks, `${template}-${kind}`);
    parseNativeResumeDocument(parsed.document);
    const mapped = new Set(parsed.mappings.map((value) => value.blockId));
    const unaccounted = extracted.blocks
      .filter((block) => !mapped.has(block.id))
      .map((block) => block.id);
    assert.equal(unaccounted.length, 0, "source block retention");
    for (const [section, count] of Object.entries({
      education: 2,
      experience: 3,
      publications: 1,
      certifications: 1,
      awards: 1,
      skills: 1,
    }))
      assert.equal(
        parsed.document.data.sections[section].items.length,
        count,
        `${template}/${kind}/${section}`,
      );
    // The titleless second project cannot yet be separated reliably. Retention is not
    // structural fidelity, so this known ambiguity must not be reported as success.
    assert.equal(parsed.quality, "partial");
    const result = {
      template,
      kind,
      quality: parsed.quality,
      blocks: extracted.blocks.length,
      unaccounted,
      unclassified: parsed.unclassifiedBlockIds.length,
      counts: Object.fromEntries(
        Object.entries(parsed.document.data.sections).map(([name, section]) => [
          name,
          section.items.length,
        ]),
      ),
      warnings: extracted.warnings,
    };
    await writeFile(
      resolve(out, `${template}-${kind}.json`),
      JSON.stringify({ extracted, parsed }, null, 2),
    );
    results.push(result);
    console.log(JSON.stringify(result));
  }
await writeFile(resolve(out, "results.json"), JSON.stringify(results, null, 2));
