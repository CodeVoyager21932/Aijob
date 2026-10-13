import type { LocalFont } from "@aijob/resume-renderer/browser";

let cache: Promise<LocalFont[]> | undefined;
export function loadNativeFonts() {
  if (cache) return cache;
  cache = (async () => {
    const manifest = (await fetch("/fonts/font-set-v3.json").then((r) => {
      if (!r.ok) throw new Error("无法加载中文字体清单");
      return r.json();
    })) as { files: { file: string; sha256: string }[] };
    const fonts: LocalFont[] = [];
    for (const [family, source] of [
      ["Noto Sans SC", "Sans"],
      ["Noto Serif SC", "Serif"],
    ] as const) {
      const files: Record<string, string> = {};
      for (const [weight, style] of [
        ["400", "Regular"],
        ["700", "Bold"],
      ] as const) {
        const filename = `AijobV3${source}${style}.woff2`;
        const response = await fetch(`/fonts/${filename}`);
        if (!response.ok) throw new Error("中文字体尚未就绪");
        const bytes = await response.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (manifest.files.find((f) => f.file === filename)?.sha256 !== hash)
          throw new Error("中文字体版本不一致");
        files[weight] = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(new Blob([bytes], { type: "font/woff2" }));
        });
      }
      fonts.push({
        type: "web",
        category: source === "Sans" ? "sans-serif" : "serif",
        family,
        weights: ["400", "700"],
        preview: files["400"] ?? "",
        files,
      });
    }
    return fonts;
  })();
  void cache.catch(() => {
    cache = undefined;
  });
  return cache;
}
