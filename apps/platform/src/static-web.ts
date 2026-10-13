import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};
export function registerStaticWeb(app: FastifyInstance, root: string) {
  const directory = path.resolve(root);
  app.get("/*", async (request, reply) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (/^\/(v[12]|health)(\/|$)/.test(pathname))
      return reply.code(404).send({ error: "NOT_FOUND" });
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return reply.code(400).send();
    }
    const candidate = path.resolve(directory, `.${decoded}`);
    if (!candidate.startsWith(directory + path.sep) && candidate !== directory)
      return reply.code(404).send();
    let file = candidate;
    const exists = await stat(file).catch(() => null);
    if (!exists?.isFile()) {
      if (path.extname(decoded)) return reply.code(404).send();
      file = path.join(directory, "index.html");
    }
    reply.header("Cache-Control", file.endsWith(".html") ? "no-cache" : "public, max-age=86400");
    return reply
      .type(mime[path.extname(file)] ?? "application/octet-stream")
      .send(createReadStream(file));
  });
}
