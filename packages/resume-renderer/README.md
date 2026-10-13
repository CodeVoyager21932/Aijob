# Resume rendering boundaries

`renderNativePdfArtifactIsolated(document, fontDirectory)` returns `bytes`, one-based item `anchors`, optional Forme `pageMap`, and `diagnostics`. `renderNativePdfIsolated` remains the byte-only compatibility API. Both are exported from `@aijob/resume-renderer/isolated`. Cache/artifact versions come from `nativeRendererVersions(document)`; do not place engine versions in saved resume data.

The four new identities (`studio-clear-cn`, `studio-compact-cn`, `studio-main-cn`, `studio-research-cn`) render only in the server worker. It bundles pinned RRv6 runtime and React 19.3 separately from Web React 19.1, with Forme 0.28.0 as an external Node dependency so its WASM resolves reliably. The existing 40 identities retain React-PDF and now return their existing layout anchors from server rendering too. The browser renderer rejects new identities explicitly; their gallery uses labeled schematics and the editor's authoritative artifact supplies the real preview.

`studio-model.ts` is a read-only projection of the existing strict core. It preserves original dates, project role/unit/method, publication authors/authorPosition/status, multi-role descriptions, visibility and section placement. It neither invokes RRv6 schema parsing nor changes stored fields. Applying a new template changes layout only. PDF and DOCX remain separate output adapters; DOCX is an editable content export, not a promise of identical PDF layout.

New fonts are the two unmodified official Noto TTF downloads with fixed commit, hashes and OFL licenses in `apps/web/public/fonts/font-set-studio-v1.json`. HarfBuzz freezes 400/700 while subsetting. Old font files/manifest remain intact. Workers reject remote images, external rich-text resources, missing or altered fonts, text-loss/layout diagnostics; maximum two disposable workers, 512 MiB heap, 60 seconds. They inherit no caller test/tsx loader arguments.

## Rollout

- `VITE_ENABLE_STUDIO_TEMPLATES=false`: hides new gallery choices, retains original 40 choices.
- `ENABLE_NATIVE_STUDIO_TEMPLATES=false`: service creates new drafts with legacy default.
- Saved studio drafts continue to render under either flag; never remap existing identities silently.
- If a core render defect persists after two targeted repair rounds, close the new-entry flags and continue with the existing renderer. No third renderer is introduced.

## Focused verification (2026-10-12)

- Build: `node scripts/build.mjs` (run from this package).
- New adapter types: `tsc -p tsconfig.studio.json --noEmit`. This deliberately does not assert the previously untyped legacy vendor source graph has no errors.
- 11 tests in `studio-model`, `studio-isolated`, `document`, `layout-anchors`: passed, including name-only preview under Vitest, content preservation and resource/legacy boundaries.
- A subsequent focused worker regression also verifies saved section/entry spacing and sidebar width against actual PDF coordinates; the renderer identity is bumped when these layout calculations change so cached bytes are not reused.
- `node scripts/studio-smoke.mjs --all --edge`: synthetic Chinese multi-page content, all four layouts, original dates and local extension fields, 13 links, complete item anchors, visible text within the page, and a 90-paragraph single entry with image and ordered list. Output goes only to ignored `.data/renderer-studio-smoke/`.
- Poppler page images reviewed for the first/last page and distinct layouts. No clipped glyphs or missing text in these fixtures. This is bounded renderer verification, not final real-resume acceptance.

Known upstream compatibility note: Forme 0.28 can declare a short embedded TrueType `loca` table with two padding bytes (e.g. 352 rather than 350); PDF.js repairs this and warns for some Serif/long-entry subsets. Inspected font offsets and text output remain intact; Poppler rendering succeeds. A pre-render long-loca conversion did not change Forme's generated table and was removed rather than retaining an ineffective patch. This remains tracked rather than being described as a completely warning-free engine.
