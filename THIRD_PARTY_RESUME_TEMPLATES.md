# Resume template references and attribution

This ledger preserves attribution for each rendering generation; it is not a current renderer inventory. The HTML/Chromium generation below is historical compatibility work. Native RR5 and RR6/Forme PDF capabilities are covered separately below and in the vendored source manifests; do not use the old HTML-only description to remove their licenses or source notices. Upstream names identify references, not endorsements.

## Historical HTML/Chromium generation (2026-09-10)

Aijob adapted 40 layout structures from these fixed source versions. The per-template source files, hashes, reference images, structural differences and Chinese adaptation notes are recorded in `docs/evidence/resume-studio-quality-2026-09-10/template-catalog.json`. Its HTML comparison is `template-comparison.html` in the same directory. The former 30-template ledger is historical evidence. Shared HTML/Chromium rendering, Chinese typography, pagination, editable DOCX and editor integration were modified for Aijob; LaTeX, Typst and React-PDF were not additional production renderers in this historical generation. Some comparison artifacts remain local evidence and are not included in the source checkpoint.

- [jlifeng/JobPilot](https://github.com/jlifeng/JobPilot/tree/69e6692cedacaacd3d923908f622d967e97e96c8): Apache-2.0. Original license and NOTICE retained in `docs/licenses/resume-templates/jobpilot/`.
- [Magic-Resume/Magic-Resume](https://github.com/Magic-Resume/Magic-Resume/tree/c7e0826a674d144435ad18e3ab4d32785bc9fcbd): MIT. Original license retained in `docs/licenses/resume-templates/magic/`.
- [amruthpillai/reactive-resume](https://github.com/amruthpillai/reactive-resume/tree/6416da28a4db7833a80b5d19b30c9b28d7df1807): MIT. Original license retained in `docs/licenses/resume-templates/reactive/`.
- Reactive Resume Ditgar, Leafish and Pikachu use commit `730f795073126e850cab348038f9557da6f810fd`, also MIT. The original twelve template identities remain registered separately from these additions.
- [BingyanStudio/LapisCV](https://github.com/BingyanStudio/LapisCV/tree/c8ff9e0652c02f3aea7f7ac75c011168456d717d): one Chinese Classic adapter, MIT; original notice in `docs/licenses/resume-templates/lapiscv-MIT.txt`.
- [billryan/resume](https://github.com/billryan/resume/tree/eadc3955cf006254dc8f2419e971fbe3f5bab413): one Chinese professional adapter, MIT; original notice in `docs/licenses/resume-templates/billryan-MIT.txt`.
- [rendercv/rendercv](https://github.com/rendercv/rendercv/tree/1d4b87bc427e4cf61c0ef49623c971b0e2224708): Classic and Engineering Resumes adapters, MIT; original notice in `docs/licenses/resume-templates/rendercv-MIT.txt`.
- [salomonelli/best-resume-ever](https://github.com/salomonelli/best-resume-ever/tree/29e753cd842585b4a2e9dbbb5e1ef3a0f5e66767): Cool, Creative and Oblique layout references. The pinned `package.json` declares MIT and author salomonelli, but this commit has no standalone LICENSE file. The exact declaration is retained in `docs/licenses/resume-templates/best-resume-ever-package.json`; no missing license text has been fabricated. Aijob's HTML adapters do not include the upstream fixed personal data, portraits or skill ratings.

Template source code and public upstream sample images are preserved only as attributed comparison evidence. JobPilot/Magic reference renders execute unmodified pinned components with synthetic gallery data and an isolated Chinese fallback; they do not claim to reproduce the entire upstream application. Source typefaces are replaced by versioned Noto SC assets; see `apps/web/public/fonts/font-set-v3.json` and the font notices. Optional photos come from the owner; gallery portraits are marked synthetic.

OpenResume and the user-provided BOSS screenshots are interaction references only; no proprietary assets or AGPL implementation are included.

## Native RR5 generation and compatible templates (2026-09-13)

The older HTML/Chromium ledger above is historical. This native generation and hashes are recorded in `docs/evidence/resume-native-template-catalog.json`; later rendering changes follow ADR-0042. Preserve the pinned source manifests, licenses and font notices in `vendor/reactive-resume/`, `vendor/reactive-resume-v6/` and `apps/web/public/fonts/` alongside the per-template references below.

- Reactive Resume native core: pinned `86a72bef138ae51771ea3bdeda9b2871a3a838c8`, MIT. The exact imported files and hashes are in [the RR5 manifest](vendor/reactive-resume/upstream-manifest.json); the [original license](vendor/reactive-resume/LICENSE) is retained. This generation uses React-PDF and remains available for existing documents and the 40 compatible templates. It is not covered by the historical HTML-only renderer statement above.

- JobPilot Swiss: pinned `69e6692cedacaacd3d923908f622d967e97e96c8`, Apache-2.0; source, license and NOTICE in `vendor/resume-template-references/jobpilot/`.
- visiky/resume Template1: pinned `2eb87e51ccdb63f0565d3d6935bd1b92fa2dbc00`, MIT, copyright (c) 2017 Kasmine; complete notice and source in `vendor/resume-template-references/visiky/`. Native page/pagination primitives remain from the pinned Reactive Resume MIT core.

- Magic Compact CN Photo and Executive Band: pinned `c7e0826a674d144435ad18e3ab4d32785bc9fcbd`, MIT, copyright (c) 2025 林陌青川. Unmodified configs, native adaptation component references and license hashes are in `vendor/resume-template-references/magic-resume/source.json`. This is Magic-Resume/Magic-Resume, not JOYCEQL/magic-resume.

## RR6 / Forme studio generation (2026-10-12)

The four Aijob studio layouts use a read-only rendering adapter and an isolated server PDF package. They preserve Aijob's document contract and do not replace existing RR5 documents or upgrade the Web application's React runtime. Preview and download consume the same server artifact; see [ADR-0042](docs/decisions/0042-opportunity-and-resume-system-upgrade.md).

- Reactive Resume v6 PDF capability: pinned `0c6e75eec4d743257c0f099d08037d5cc215dee0`, MIT. Imported file hashes and the repository are recorded in [the RR6 manifest](vendor/reactive-resume-v6/upstream-manifest.json). Preserve [LICENSE](vendor/reactive-resume-v6/LICENSE) and the separate [style-types notice](vendor/reactive-resume-v6/LICENSE-style-types); neither replaces the RR5 or per-template notices above.
- `@formepdf/core` and `@formepdf/react` are pinned to `0.28.0`; `harfbuzzjs` is pinned to `1.6.2`. Their installed package metadata declares MIT. The dependency versions remain in [the rendering package](vendor/reactive-resume-v6/package.json) and `pnpm-lock.yaml`; retain their distributed notices with runtime dependencies.
- Noto Sans SC / Serif SC variable fonts are pinned to Noto CJK commit `f8d157532fbfaeda587e826d4cd5b21a49186f7c`, OFL-1.1. Exact local TTF files, hashes and license filenames are recorded in [font-set-studio-v1.json](apps/web/public/fonts/font-set-studio-v1.json). Existing v3 fonts and notices remain for older renderers.

This is an attribution and version-scope update, not a new license audit or permission to remove old licenses, reference sources, fonts or local evidence.
