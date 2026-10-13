import { createHash } from "node:crypto";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../.."),
  stage = path.join(root, ".data/desktop-bundle-20261013");
for (const [from, to] of [
  ["apps/platform/dist", "apps/platform/dist"],
  ["apps/web/dist", "apps/web/dist"],
  ["packages/database/dist", "node_modules/@aijob/database/dist"],
])
  await cp(path.join(root, from), path.join(stage, to), { recursive: true });
const manifest = JSON.parse(await readFile(path.join(stage, "runtime-manifest.json"), "utf8"));
manifest.latestMigration = "078_case_catalog_lock";
manifest.builtAt = new Date().toISOString();
await writeFile(path.join(stage, "runtime-manifest.json"), JSON.stringify(manifest, null, 2));
async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(file);
    else yield file;
  }
}
const hashes = [];
for await (const file of files(stage)) {
  if (file.endsWith("SHA256SUMS.txt") || path.basename(file) === ".gitkeep") continue;
  hashes.push(
    `${createHash("sha256")
      .update(await readFile(file))
      .digest("hex")}  ${path.relative(stage, file).replaceAll("\\", "/")}`,
  );
}
await writeFile(path.join(stage, "SHA256SUMS.txt"), hashes.join("\n") + "\n");
console.info(JSON.stringify({ files: hashes.length }));
