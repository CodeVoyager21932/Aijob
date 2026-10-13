import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const label = process.argv[2];
if (label && !/^[a-z][a-z0-9-]{0,70}$/.test(label)) throw new Error("Use a simple candidate name");
const output = resolve(root, ".data/releases", label ?? "");
const archiveName = label ? `aijob-${label}-source.tar.gz` : "aijob-product-core-source.tar.gz";
await mkdir(output, { recursive: true });
const files = [
  ...new Set(
    execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8",
    }).split("\0"),
  ),
]
  .filter(
    (path) =>
      path &&
      !path.startsWith(".data/") &&
      !path.startsWith(".hatch-runs/") &&
      (!/(^|\/)\.env($|\.)/.test(path) || path.endsWith(".env.example")) &&
      !path.includes("node_modules/") &&
      (!/\.(pdf|docx|png|jpg|jpeg|zip)$/i.test(path) || path.startsWith("apps/web/public/")),
  )
  .sort();
const entries = [];
for (const path of files) {
  try {
    const bytes = await readFile(resolve(root, path));
    entries.push({
      path,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const manifest = {
  createdAt: new Date().toISOString(),
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  kind: "source_candidate_requires_build",
  exclusions: [
    "local environment files except .env.example templates",
    ".data",
    ".hatch-runs",
    "node_modules",
    "binary PDF/DOCX and image evidence (production public assets retained)",
  ],
  files: entries,
};
await writeFile(resolve(output, "candidate-manifest.json"), JSON.stringify(manifest, null, 2));
await writeFile(
  resolve(output, "candidate-files.txt"),
  entries.map((entry) => entry.path).join("\n") + "\n",
);
execFileSync(
  "tar",
  [
    "-czf",
    resolve(output, archiveName),
    "-T",
    resolve(output, "candidate-files.txt"),
  ],
  { cwd: root, stdio: "pipe" },
);
console.log(
  JSON.stringify({
    archive: resolve(output, archiveName),
    manifest: resolve(output, "candidate-manifest.json"),
    files: entries.length,
    environmentFilesExcluded: true,
    compiledRuntime: false,
  }),
);
