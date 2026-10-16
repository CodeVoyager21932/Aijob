import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  batchGallerySample,
  campusGallerySample,
  nativeGallerySample,
} from "../../apps/web/src/career-os/native/native-sample.ts";
import {
  applyNativeTemplate,
  nativeTemplateCatalog,
} from "../../packages/resume-core/dist/index.js";
import {
  nativeRendererVersions,
  renderNativePdfArtifactIsolated,
} from "../../packages/resume-renderer/dist/isolated.mjs";

const root = resolve(import.meta.dirname, "../..");
const outputArg = process.argv.indexOf("--out");
const output = resolve(
  root,
  outputArg >= 0 ? process.argv[outputArg + 1] : ".data/resume-native-k4-20260913/gallery-v9",
);
await mkdir(output, { recursive: true });
const selected = process.argv.indexOf("--templates");
const ids = selected >= 0 ? new Set(process.argv[selected + 1]?.split(",")) : null;
const completeChinese = new Set([
  "studio-campus-cn",
  "studio-banner-cn",
  "studio-index-cn",
  "studio-sidebar-cn",
  "studio-layered-cn",
  "studio-cards-cn",
]);
if (ids && [...ids].some((id) => !nativeTemplateCatalog.some((template) => template.id === id))) {
  throw new Error("Unknown template selection; use a quoted comma-separated list.");
}
for (const template of nativeTemplateCatalog.filter((item) => !ids || ids.has(item.id))) {
  const doc = applyNativeTemplate(
    template.id === "studio-campus-cn"
      ? campusGallerySample()
      : completeChinese.has(template.id)
        ? batchGallerySample()
        : nativeGallerySample(),
    template.id,
  );
  const photoArg = process.argv.indexOf("--photo");
  if (photoArg >= 0) {
    const photoPath = resolve(root, process.argv[photoArg + 1] ?? "");
    if (!/\.(png|jpe?g)$/i.test(photoPath)) throw new Error("Use a PNG or JPEG sample photo.");
    const mediaType = /\.png$/i.test(photoPath) ? "image/png" : "image/jpeg";
    doc.data.picture = {
      ...doc.data.picture,
      hidden: false,
      url: `data:${mediaType};base64,${(await readFile(photoPath)).toString("base64")}`,
    };
  }
  const artifact = await renderNativePdfArtifactIsolated(
    doc,
    resolve(root, "apps/web/public/fonts"),
  );
  if (process.argv.includes("--require-one-page") && artifact.fit?.pageCount !== 1)
    throw new Error("The complete specimen must fit one page.");
  await writeFile(resolve(output, `${template.id}-v1.pdf`), artifact.bytes);
  await writeFile(
    resolve(output, `${template.id}-v1.json`),
    JSON.stringify(
      {
        templateId: template.id,
        templateVersion: 1,
        sample:
          template.id === "studio-campus-cn"
            ? "campusGallerySample"
            : completeChinese.has(template.id)
              ? "batchGallerySample"
              : "nativeGallerySample",
        synthetic: true,
        hasPhoto: !doc.data.picture.hidden,
        ...nativeRendererVersions(doc),
        pdfSha256: createHash("sha256").update(artifact.bytes).digest("hex"),
        fit: artifact.fit,
        diagnostics: artifact.diagnostics,
        visualReview: "pending",
      },
      null,
      2,
    ),
  );
  console.log(template.id);
}
