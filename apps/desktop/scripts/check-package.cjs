/** electron-builder filters a root node_modules from extraResources; an explicit mapping is required. */
const { readFile, access } = require("node:fs/promises");
const path = require("node:path");
module.exports = async ({ appOutDir }) => {
  const runtime = path.join(appOutDir, "resources/runtime");
  const expected = (await readFile(path.join(runtime, "SHA256SUMS.txt"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => line.slice(66));
  const missing = [];
  for (let index = 0; index < expected.length; index += 64)
    await Promise.all(
      expected.slice(index, index + 64).map(async (relative) => {
        try {
          await access(path.join(runtime, relative));
        } catch {
          missing.push(relative);
        }
      }),
    );
  if (missing.length)
    throw Error(`RUNTIME_FILES_OMITTED: ${missing.length}; ${missing.slice(0, 5).join(", ")}`);
  console.info(`Runtime package complete: ${expected.length} files.`);
};
