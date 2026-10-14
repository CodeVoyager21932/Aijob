/** Local-only pinned inputs. Importing this module does not start a browser or parser. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
export async function loadRegressionInputs(
  manifestPath = process.env.AIJOB_RESUME_REGRESSION_MANIFEST,
) {
  const path = resolve(manifestPath || resolve(root, ".data/resume-regression/manifest.json"));
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(
      "缺少固定简历回归包 .data/resume-regression；按 tools/README.md 恢复本机材料，不会自动下载替代样本。",
    );
  }
  const directory = resolve(path, "..");
  const cases = manifest.cases.map((sample) => ({
    ...sample,
    file: resolve(directory, sample.file),
  }));
  return {
    ...manifest,
    cases,
    sample(id) {
      const sample = cases.find((entry) => entry.id === id);
      if (!sample) throw new Error(`REGRESSION_SAMPLE_MISSING:${id}`);
      return sample;
    },
    async verify() {
      for (const sample of cases) {
        const actual = createHash("sha256")
          .update(await readFile(sample.file))
          .digest("hex");
        if (actual !== sample.sha256) throw new Error(`REGRESSION_INPUT_CHANGED:${sample.id}`);
      }
      return cases.length;
    },
  };
}

export function runOutput(task) {
  return resolve(
    root,
    process.env.AIJOB_BROWSER_OUTPUT ||
      `.data/runs/${task}/${new Date().toISOString().replaceAll(":", "-")}`,
  );
}
