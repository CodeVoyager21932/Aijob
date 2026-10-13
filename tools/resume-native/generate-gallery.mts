import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyNativeTemplate, nativeTemplateCatalog } from "../../packages/resume-core/dist/index.js";
import { renderNativePdfIsolated } from "../../packages/resume-renderer/dist/isolated.mjs";
import { nativeGallerySample } from "../../apps/web/src/career-os/native/native-sample.ts";

const root=resolve(import.meta.dirname,"../..");
const outputArg=process.argv.indexOf("--out");
const output=resolve(root,outputArg>=0?process.argv[outputArg+1]:".data/resume-native-k4-20260913/gallery-v9");
await mkdir(output,{recursive:true});
const selected=process.argv.indexOf("--templates");
const ids=selected>=0 ? new Set(process.argv[selected+1]?.split(",")) : null;
if (ids && [...ids].some(id => !nativeTemplateCatalog.some(template => template.id === id))) {
  throw new Error("Unknown template selection; use a quoted comma-separated list.");
}
for(const template of nativeTemplateCatalog.filter(item=>!ids||ids.has(item.id))){
  const doc=applyNativeTemplate(nativeGallerySample(),template.id);
  const pdf=await renderNativePdfIsolated(doc,resolve(root,"apps/web/public/fonts"));
  await writeFile(resolve(output,`${template.id}-v1.pdf`),pdf);
  console.log(template.id);
}
