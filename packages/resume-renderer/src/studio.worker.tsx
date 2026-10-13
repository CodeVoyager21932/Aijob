import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { parseNativeResumeDocument } from "@aijob/resume-core";
import * as forme from "@aijob/resume-forme/engine";
import { assertPdfText, renderResumeElement } from "@aijob/resume-forme/render";
import {
  createFontPreparer,
  createFontSubsetter,
} from "../../../vendor/reactive-resume-v6/src/forme/font-subset.js";
import { assertNativeRenderResources } from "./resources.js";
import { StudioDocument } from "./studio-document.js";

async function run() {
  const document = parseNativeResumeDocument(workerData.document);
  assertNativeRenderResources(document);
  const manifest = JSON.parse(
    await readFile(resolve(workerData.fontDirectory, "font-set-studio-v1.json"), "utf8"),
  );
  if (manifest.version !== "aijob-studio-ttf-v1" || manifest.license !== "OFL-1.1")
    throw new Error("NATIVE_FONT_MANIFEST_MISMATCH");
  const families = new Set([
    document.data.metadata.typography.body.fontFamily,
    document.data.metadata.typography.heading.fontFamily,
  ]);
  const fonts = [];
  const weights = new WeakMap<Uint8Array, number>();
  for (const family of families)
    for (const weight of [400, 700]) {
      const file = `AijobStudio${family === "Noto Serif SC" ? "Serif" : "Sans"}VF.ttf`;
      const bytes = await readFile(resolve(workerData.fontDirectory, file));
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        manifest.files.find((entry: { file: string }) => entry.file === file)?.sha256
      )
        throw new Error("NATIVE_FONT_HASH_MISMATCH");
      const src = new Uint8Array(bytes);
      weights.set(src, weight);
      fonts.push({ family, weight, italic: false, src });
    }
  const require = createRequire(import.meta.url);
  const wasm = await readFile(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"));
  const subset = await createFontSubsetter(new Uint8Array(wasm));
  // The renderer never receives a remote network capability, including image fallbacks.
  globalThis.fetch = async () => {
    throw new Error("NATIVE_EXPORT_NETWORK_FORBIDDEN");
  };
  const result = await renderResumeElement(
    {
      renderSerializedDocWithLayout: forme.renderSerializedDocWithLayout,
      prepareFont: createFontPreparer((bytes, text) => subset(bytes, text, weights.get(bytes))),
    },
    <StudioDocument document={document} />,
    fonts,
    async (source) => {
      if (!/^data:image\/(png|jpeg);base64,/.test(source))
        throw new Error("NATIVE_PHOTO_MUST_BE_RESOLVED_BY_OWNER_SERVICE");
      return new Uint8Array(Buffer.from(source.slice(source.indexOf(",") + 1), "base64"));
    },
  );
  assertPdfText(result);
  if (
    result.warnings.some((warning) =>
      /render defect|could not|couldn't|failed|unsupported|missing/i.test(warning),
    )
  )
    throw new Error("NATIVE_EXPORT_LAYOUT_DEFECT");
  const anchors = result.pageMap.nodes.flatMap((node) =>
    node.kind === "item"
      ? [
          {
            page: node.page + 1,
            id: node.itemId,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
          },
        ]
      : [],
  );
  const bytes = new Uint8Array(result.pdf);
  parentPort?.postMessage(
    { bytes, anchors, pageMap: result.pageMap, diagnostics: result.warnings },
    [bytes.buffer],
  );
}
run().catch((error: unknown) => {
  // No personal source text or arbitrary engine messages leave the disposable worker.
  const message =
    error instanceof Error && /^NATIVE_[A-Z_]+$/.test(error.message)
      ? error.message
      : "NATIVE_EXPORT_RENDER_FAILED";
  parentPort?.postMessage({ error: message });
});
