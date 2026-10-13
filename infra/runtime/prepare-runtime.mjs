import { readFile, writeFile } from "node:fs/promises";
// Run only inside the image build context, after compilation. Development keeps TS exports.
if (process.env.AIJOB_IMAGE_BUILD !== "1") throw new Error("IMAGE_BUILD_ONLY");
for (const name of ["config", "contracts", "database", "resume-core"]) {
  const file = `packages/${name}/package.json`,
    manifest = JSON.parse(await readFile(file, "utf8"));
  manifest.exports = { ".": "./dist/index.js" };
  await writeFile(file, JSON.stringify(manifest, null, 2));
}
