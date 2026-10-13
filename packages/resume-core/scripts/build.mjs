import { build } from "esbuild";

// Production must not resolve TS-only vendor exports through Node.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "neutral",
  format: "esm",
  target: "es2022",
  sourcemap: true,
});
