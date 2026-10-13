# Pinned server-only Reactive Resume / Forme runtime

The MIT runtime subset is from Reactive Resume commit `0c6e75eec4d743257c0f099d08037d5cc215dee0`. Original source hashes are in `upstream-manifest.json`; `LICENSE` is retained. Forme core/react are fixed at 0.28.0. React 19.3.0 and react-reconciler 0.34.0 are isolated in this server worker; the Web app stays on React 19.1.0.

Local change: `render.ts` accepts already constructed elements and verified font bytes. It retains the upstream bounded pagination retries and page-map extraction, but does not import upstream ResumeData, templates, schema conversion, remote font lookup or icon catalog. Aijob's strict stored core remains authoritative. This deliberately avoids dropping its project/publication extensions or reformatting stored date strings.

Only the four `studio-*` template identities select this renderer. Historical 40 identities keep the existing runtime. All template components belong to Aijob's renderer package. This package has no installation lifecycle scripts. Its built worker is emitted by `@aijob/resume-renderer`.

Fonts are verified local Noto variable TTFs pinned at `notofonts/noto-cjk@f8d157532fbfaeda587e826d4cd5b21a49186f7c` in `font-set-studio-v1.json`, with the two upstream OFL licenses beside them. HarfBuzz 1.6.2 freezes 400/700 weights while subsetting. No system fonts or network font fallback. `font-subset.ts` adds the weight pin and rejects a failed subset; original hashes remain in the manifest. Rendering is disposable and bounded by the existing Node worker limit. Failed text/image/font/layout diagnostics reject the new artifact.

The gallery rollout switch is `VITE_ENABLE_STUDIO_TEMPLATES=false`. It hides the four new choices while retaining the original 40. The API's `ENABLE_NATIVE_STUDIO_TEMPLATES=false` chooses the legacy default for newly created drafts. Neither flag changes already saved documents or prevents them from rendering.
