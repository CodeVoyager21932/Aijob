import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Bundle the icon barrel and source graph once, avoiding thousands of runtime
// module opens on Windows. React and the PDF runtime keep their own entrypoints.
const shared = {
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  external: ["react", "react/jsx-runtime", "@react-pdf/renderer", "pdfjs-dist/*"],
  plugins: [
    {
      name: "native-runtime-boundaries",
      setup(context) {
        context.onResolve({ filter: /^#react-pdf-renderer$/ }, () => ({
          path: "@react-pdf/renderer",
          external: true,
        }));
        context.onLoad(
          { filter: /css-tree[\\/]lib[\\/]data(?:-patch)?\.js$/ },
          async ({ path }) => {
            let contents = await readFile(path, "utf8");
            contents = contents
              .replace(/import \{ createRequire \} from 'module';/, "")
              .replace(/const require = createRequire\(import\.meta\.url\);/, "");
            contents = contents.replace(
              /const (\w+) = require\('([^']+\.json)'\);/g,
              "import $1 from '$2';",
            );
            return { contents, loader: "js" };
          },
        );
      },
    },
  ],
};
await build({
  ...shared,
  entryPoints: ["src/server.tsx"],
  outfile: "dist/server.mjs",
  platform: "node",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
await build({
  ...shared,
  entryPoints: ["src/browser.tsx"],
  outfile: "dist/browser.mjs",
  platform: "browser",
});
await build({
  ...shared,
  entryPoints: ["src/isolated.ts"],
  outfile: "dist/isolated.mjs",
  platform: "node",
});
// A separate worker owns React 19.3 + RRv6/Forme. No import enters the Web graph.
const formeRequire = createRequire(
  new URL("../../../vendor/reactive-resume-v6/package.json", import.meta.url),
);
await build({
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  platform: "node",
  entryPoints: ["src/studio.worker.tsx"],
  outfile: "../../vendor/reactive-resume-v6/dist/export.worker.mjs",
  external: ["@formepdf/core"],
  alias: {
    react: formeRequire.resolve("react"),
    "react/jsx-runtime": formeRequire.resolve("react/jsx-runtime"),
  },
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
await build({
  ...shared,
  entryPoints: ["src/export.worker.ts"],
  outfile: "dist/export.worker.mjs",
  platform: "node",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
if (process.argv.includes("--smoke")) {
  await build({
    ...shared,
    entryPoints: ["scripts/smoke.ts"],
    outfile: "dist/smoke.mjs",
    platform: "node",
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
  });
}
