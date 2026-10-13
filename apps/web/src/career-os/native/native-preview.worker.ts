import {
  installLocalFontCatalog,
  type LocalFont,
  renderNativeResumePreviewWithLayout,
} from "@aijob/resume-renderer/browser";

let latest: { generation: number; document: unknown } | undefined;
let running = false;
self.onmessage = (
  event: MessageEvent<{ generation: number; document: unknown; fonts?: LocalFont[] }>,
) => {
  if (event.data.fonts) installLocalFontCatalog(event.data.fonts);
  latest = event.data;
  if (!running) void run();
};
async function run() {
  running = true;
  while (latest) {
    const request = latest;
    latest = undefined;
    try {
      const result = await renderNativeResumePreviewWithLayout(request.document);
      if (!latest) self.postMessage({ generation: request.generation, ...result });
    } catch (error) {
      if (!latest)
        self.postMessage({
          generation: request.generation,
          error: error instanceof Error ? error.message : "预览未生成",
        });
    }
  }
  running = false;
}
