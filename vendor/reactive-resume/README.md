# Reactive Resume native core

Pinned upstream: `reactive-resume/app`, v5.3.0, `86a72bef138ae51771ea3bdeda9b2871a3a838c8` (MIT).

Only the `schema`, `resume`, `pdf`, `fonts`, and `utils` packages are vendored. Account, billing, hosting and upstream API code are not installed. `upstream-manifest.json` records original source hashes; changes are documented below. Native template components and React PDF layout are retained, not translated into the legacy HTML renderer.

Local integration patches:

- Package manifests: remove upstream development scripts/configuration, keep runtime dependencies; use the host React 19.1.0 so React contexts share one runtime. Resolved transitive versions are pinned by the host lockfile.
- Fonts: replace online font locations with an explicitly installed local font catalog. Missing configuration fails closed. Host rendering must install the immutable font set before a job starts.
- Schema: descriptive item names may be empty while editing; stable IDs and layout constraints are unchanged. Host write validation rejects silently removed or normalized submitted fields.
- Schema relative imports use explicit `.js` extensions for the host NodeNext toolchain. Package TypeScript configurations extend the host base configuration.
- PDF icon loading uses a static registry of the 32 icons referenced by the pinned templates/default data. The original icon components and weights are retained; the unrestricted icon picker is not exposed. This avoids loading thousands of files on Windows. Unknown icon names do not introduce remote resources.
- Host wrappers bundle the native schema with its own Zod 4 runtime, and share React/React PDF with the host. They validate local font families, reject resource-bearing rich text, and expose the upstream semantic tree. The host maps stable item IDs to native layout coordinates and exposes clickable PDF overlays without embedding those controls in the exported file.

K0 integration alone did not certify Chinese output. The 2026-09-13 K4/K5 local candidate now routes new documents through the native core; historical documents retain their reader. See `docs/evidence/resume-native-k4-k5-2026-09-13.md` for the completed output scope and external runtime conditions.

Current native integration additions (2026-09-12):

- `metadata.page.keepHeadingsWithContent` explicitly enables heading/entry pagination constraints. Absent values retain the historical behavior. The pinned `@react-pdf/layout` patch handles nested heading movement, empty fragments, and measured small entries; long entries still split naturally.
- Chinese item extensions retain their own fields and stable IDs; project header metadata remains adjacent to the project title.
- Native Chinese adaptations live under `pdf/src/templates/aijob`; original licenses and fixed references are retained. The current 40-template catalog links to the K4/K5 output review and records adaptation differences rather than claiming pixel-identical replicas.
- Browser previews share one bounded worker queue with cancellation, timeout and idle cleanup. PDF.js displays the actual native PDF; browser zoom does not alter paper metrics.

See `docs/evidence/resume-native-template-catalog.json` for component provenance and `local-patches.json` for changed vendor hashes.
