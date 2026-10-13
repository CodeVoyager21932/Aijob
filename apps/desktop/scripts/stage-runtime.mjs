import { createHash } from "node:crypto";
import { access, cp, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const stage = path.join(root, ".data/desktop-bundle-20261013");
const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};
await mkdir(stage, { recursive: true });
const workspace = new Set([
  "@aijob/platform",
  "@aijob/config",
  "@aijob/contracts",
  "@aijob/database",
  "@aijob/resume-core",
  "@aijob/resume-renderer",
  "@aijob/resume-forme",
  "@reactive-resume/pdf",
  "@reactive-resume/fonts",
  "@reactive-resume/resume",
  "@reactive-resume/schema",
  "@reactive-resume/utils",
]);
const rootPackages = new Map();
let copied = 0;
async function resolvePackage(name, from) {
  let directory = from;
  while (true) {
    const candidate = path.join(directory, "node_modules", name);
    if (await exists(path.join(candidate, "package.json"))) return realpath(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) throw Error(`Dependency missing: ${name}`);
    directory = parent;
  }
}
function compiledExport(value) {
  if (typeof value === "string")
    return value.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, ".js");
  if (Array.isArray(value)) return value.map(compiledExport);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "types")
        .map(([key, item]) => [key, compiledExport(item)]),
    );
  return value;
}
async function install(real, target, ancestors) {
  const pkg = JSON.parse(await readFile(path.join(real, "package.json"), "utf8"));
  // These three artifacts already bundle their source graph. Ship only the runtime
  // imports retained by their build scripts, including the separately read WASM.
  const bundledDependencies = {
    "@aijob/resume-core": [],
    "@aijob/resume-renderer": ["@aijob/resume-forme", "@react-pdf/renderer", "react", "pdfjs-dist"],
    "@aijob/resume-forme": ["@formepdf/core", "harfbuzzjs", "react"],
  }[pkg.name];
  if (bundledDependencies)
    pkg.dependencies = Object.fromEntries(
      bundledDependencies.map((name) => [name, pkg.dependencies[name]]),
    );
  await mkdir(target, { recursive: true });
  const isWorkspace = workspace.has(pkg.name);
  await cp(real, target, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const relative = path.relative(real, source),
        parts = relative.split(path.sep);
      if (parts.includes("node_modules") || parts.includes(".git") || parts.includes(".data"))
        return false;
      if (parts.includes(".gitkeep")) return false;
      if (isWorkspace && ["src", "scripts", "verification", "tests", "test"].includes(parts[0]))
        return false;
      return !/\.(tsbuildinfo|map)$/.test(source);
    },
  });
  if (isWorkspace) {
    pkg.exports = compiledExport(pkg.exports);
    if (pkg.main) pkg.main = compiledExport(pkg.main);
    delete pkg.scripts;
    delete pkg.devDependencies;
    await writeFile(path.join(target, "package.json"), JSON.stringify(pkg, null, 2));
  }
  copied++;
  const context = new Map(ancestors);
  context.set(pkg.name, real);
  const pending = [];
  for (const name of [
    ...new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}).filter((name) => !name.startsWith("@types/")),
    ]),
  ]) {
    let dep;
    try {
      dep = await resolvePackage(name, real);
    } catch (error) {
      if (name in (pkg.optionalDependencies ?? {}) || name in (pkg.peerDependencies ?? {}))
        continue;
      throw error;
    }
    const nearest = context.has(name) ? context.get(name) : rootPackages.get(name);
    if (nearest === dep) continue;
    if (!rootPackages.has(name) && !context.has(name)) {
      rootPackages.set(name, dep);
      pending.push({ dep, target: path.join(stage, "node_modules", name), hoisted: true });
    } else {
      context.set(name, dep);
      pending.push({ dep, target: path.join(target, "node_modules", name), hoisted: false });
    }
  }
  for (const item of pending)
    await install(item.dep, item.target, item.hoisted ? new Map() : context);
}
const platform = path.join(root, "apps/platform");
await install(platform, path.join(stage, "apps/platform"), new Map());
for (const directory of [
  "apps/web/dist",
  "apps/web/public/fonts",
  "config/source-vendors",
  "docs/licenses",
])
  await cp(path.join(root, directory), path.join(stage, directory), { recursive: true });
await mkdir(path.join(stage, "config/sources"), { recursive: true });
const catalog = JSON.parse(await readFile(path.join(root, "config/source-catalog.json"), "utf8"));
for (const item of catalog.sources)
  await cp(
    path.join(root, "config/sources", item.sourceKey + ".json"),
    path.join(stage, "config/sources", item.sourceKey + ".json"),
  );
await cp(
  path.join(root, "config/source-catalog.json"),
  path.join(stage, "config/source-catalog.json"),
);
await cp(
  path.join(root, "THIRD_PARTY_RESUME_TEMPLATES.md"),
  path.join(stage, "THIRD_PARTY_RESUME_TEMPLATES.md"),
);
for (const version of ["reactive-resume", "reactive-resume-v6"])
  await cp(
    path.join(root, "vendor", version, "LICENSE"),
    path.join(stage, "docs/licenses", `${version}-LICENSE`),
  );
await cp(
  path.join(root, ".data/desktop-extracted/node-v22.23.3-win-x64"),
  path.join(stage, "node"),
  { recursive: true },
);
for (const directory of ["bin", "lib", "share"])
  await cp(
    path.join(root, ".data/desktop-extracted/pgsql", directory),
    path.join(stage, "postgresql", directory),
    { recursive: true },
  );
const pgLicense = path.join(root, ".data/desktop-extracted/pgsql/doc");
if (await exists(pgLicense))
  await cp(pgLicense, path.join(stage, "postgresql/doc"), { recursive: true });
await cp(path.join(root, ".data/desktop-browsers/chromium-1243"), path.join(stage, "chromium"), {
  recursive: true,
});
const checksum = JSON.parse(
  await readFile(path.join(root, "apps/desktop/runtime-lock.json"), "utf8"),
);
const manifest = {
  version: 1,
  builtAt: new Date().toISOString(),
  latestMigration: "078_case_catalog_lock",
  runtimes: checksum,
  packages: copied,
};
await writeFile(path.join(stage, "runtime-manifest.json"), JSON.stringify(manifest, null, 2));
async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* files(file);
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
console.info(JSON.stringify({ stage, packages: copied, files: hashes.length }));
