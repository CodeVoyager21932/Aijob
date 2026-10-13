import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { STUDIO_V3_FONT_SET, type ResumeStudioLayout } from '@aijob/contracts';

const fontSets = new Map<string, Promise<string>>();
/** Fail closed on a missing/different face: never silently substitute a system font. */
export function studioV3FontCss(fontDirectory: string, layout: ResumeStudioLayout) {
  const families = [...new Set([layout.fontFamily, layout.typography?.headingFamily ?? layout.fontFamily])].sort();
  const key = `${fontDirectory}:${layout.fontSetVersion}:${families.join()}`;
  const cached = fontSets.get(key); if (cached) return cached;
  const promise = (async () => {
    const manifest = JSON.parse(await readFile(join(fontDirectory, 'font-set-v3.json'), 'utf8')) as { version: string; files: { file: string; sha256: string }[] };
    if (manifest.version !== STUDIO_V3_FONT_SET || layout.fontSetVersion !== STUDIO_V3_FONT_SET) throw new Error('STUDIO_FONT_SET_UNSUPPORTED');
    const rules: string[] = [];
    for (const family of families) {
      for (const weight of [400, 700]) {
        const filename = `AijobV3${family === 'serif' ? 'Serif' : 'Sans'}${weight === 400 ? 'Regular' : 'Bold'}.woff2`;
        const expected = manifest.files.find(f => f.file === filename);
        const bytes = await readFile(join(fontDirectory, filename));
        if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error('STUDIO_FONT_INTEGRITY_FAILED');
        const face = `AijobV3${family === 'serif' ? 'Serif' : 'Sans'}`;
        rules.push(`@font-face{font-family:${face};font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2')}`);
      }
    }
    return rules.join('');
  })();
  fontSets.set(key, promise);
  void promise.catch(() => fontSets.delete(key));
  return promise;
}
export const studioV3FontDirectory = (configuredRegularPath: string) => dirname(configuredRegularPath);
