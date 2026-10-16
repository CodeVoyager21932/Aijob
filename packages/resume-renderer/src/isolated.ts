import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { NativeResumeDocument } from "@aijob/resume-core";
import { isStudioTemplate } from "./versions.js";

export { nativeRendererVersions } from "./versions.js";

export interface NativePdfArtifact {
  bytes: Uint8Array;
  anchors: {
    page: number;
    id: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    kind?: "field" | "text";
    targetId?: string;
    text?: string;
    label?: string;
    defaultFontSize?: number;
    alignmentAvailable?: boolean;
    stale?: boolean;
    lineBoxes?: {
      x: number;
      y: number;
      width: number;
      height: number;
      start: number;
      end: number;
    }[];
    field?: "headline" | "email";
  }[];
  pageMap?: { pages: { width: number; height: number }[]; nodes: unknown[] };
  diagnostics: string[];
  fit?: { level: number; pageCount: number; bodyFontSize: number; overflowItemIds: string[] };
  fittedMetadata?: NativeResumeDocument["data"]["metadata"];
}

let active = 0;
/** Bounded, disposable render workers; a timed-out job cannot occupy the API event loop. */
export async function renderNativePdfIsolated(
  document: unknown,
  fontDirectory: string,
): Promise<Uint8Array> {
  return (await renderNativePdfArtifactIsolated(document, fontDirectory)).bytes;
}
export async function renderNativePdfArtifactIsolated(
  document: unknown,
  fontDirectory: string,
): Promise<NativePdfArtifact> {
  if (active >= 2) throw new Error("NATIVE_EXPORT_BUSY");
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const workerUrl = isStudioTemplate(document)
        ? pathToFileURL(createRequire(import.meta.url).resolve("@aijob/resume-forme/worker"))
        : new URL("./export.worker.mjs", import.meta.url);
      const worker = new Worker(workerUrl, {
        workerData: { document, fontDirectory },
        // A compiled worker needs no test runner/tsx loader or --input-type from its caller.
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      });
      let settled = false;
      const finish = (error?: Error, artifact?: NativePdfArtifact) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error);
        else if (artifact?.bytes) resolve(artifact);
        else reject(new Error("NATIVE_EXPORT_EMPTY"));
      };
      const timer = setTimeout(() => finish(new Error("NATIVE_EXPORT_TIMEOUT")), 60000);
      worker.once("message", (result) =>
        finish(result.error ? new Error(result.error) : undefined, {
          anchors: [],
          diagnostics: [],
          ...result,
        }),
      );
      worker.once("error", () => finish(new Error("NATIVE_EXPORT_WORKER_FAILED")));
      worker.once("exit", () => {
        if (!settled) finish(new Error("NATIVE_EXPORT_WORKER_EXITED"));
      });
    });
  } finally {
    active--;
  }
}
