import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { installLocalFontCatalog, renderNativeResumePdfWithLayout } from "./server.js";

try {
  const manifest = JSON.parse(
    await readFile(resolve(workerData.fontDirectory, "font-set-v3.json"), "utf8"),
  );
  const fonts = [];
  for (const [family, source] of [
    ["Noto Sans SC", "Sans"],
    ["Noto Serif SC", "Serif"],
  ]) {
    const files: Record<string, string> = {};
    for (const [weight, style] of [
      ["400", "Regular"],
      ["700", "Bold"],
    ]) {
      const file = `AijobV3${source}${style}.woff2`,
        bytes = await readFile(resolve(workerData.fontDirectory, file));
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        manifest.files.find((entry: { file: string }) => entry.file === file)?.sha256
      )
        throw new Error("NATIVE_FONT_HASH_MISMATCH");
      files[weight] = `data:font/woff2;base64,${bytes.toString("base64")}`;
    }
    fonts.push({
      type: "web" as const,
      category: source === "Sans" ? ("sans-serif" as const) : ("serif" as const),
      family,
      weights: ["400", "700"] as ("400" | "700")[],
      preview: files["400"],
      files,
    });
  }
  installLocalFontCatalog(fonts);
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith("data:")) throw new Error("NATIVE_EXPORT_NETWORK_FORBIDDEN");
    return fetch(input, init);
  };
  const artifact = await renderNativeResumePdfWithLayout(workerData.document);
  const bytes = new Uint8Array(artifact.bytes);
  parentPort?.postMessage({ ...artifact, bytes }, [bytes.buffer]);
} catch {
  parentPort?.postMessage({ error: "NATIVE_EXPORT_RENDER_FAILED" });
}
