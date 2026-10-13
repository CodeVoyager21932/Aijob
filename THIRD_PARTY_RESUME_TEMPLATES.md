# Resume template references and attribution

Aijob adapts 40 layout structures from these fixed source versions. The per-template source files, hashes, reference images, structural differences and Chinese adaptation notes are recorded in `docs/evidence/resume-studio-quality-2026-09-10/template-catalog.json`. Its HTML comparison is `template-comparison.html` in the same directory. The former 30-template ledger is historical evidence. Shared HTML/Chromium rendering, Chinese typography, pagination, editable DOCX and editor integration are modified for Aijob; LaTeX, Typst and React-PDF engines are not shipped as additional production renderers. Upstream names identify references, not endorsements.

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

## Native continuation references (2026-09-13)

The older HTML/Chromium ledger above is historical. Current native candidates and hashes are in `docs/evidence/resume-native-template-catalog.json`.

- JobPilot Swiss: pinned `69e6692cedacaacd3d923908f622d967e97e96c8`, Apache-2.0; source, license and NOTICE in `vendor/resume-template-references/jobpilot/`.
- visiky/resume Template1: pinned `2eb87e51ccdb63f0565d3d6935bd1b92fa2dbc00`, MIT, copyright (c) 2017 Kasmine; complete notice and source in `vendor/resume-template-references/visiky/`. Native page/pagination primitives remain from the pinned Reactive Resume MIT core.

- Magic Compact CN Photo and Executive Band: pinned `c7e0826a674d144435ad18e3ab4d32785bc9fcbd`, MIT, copyright (c) 2025 林陌青川. Unmodified configs, native adaptation component references and license hashes are in `vendor/resume-template-references/magic-resume/source.json`. This is Magic-Resume/Magic-Resume, not JOYCEQL/magic-resume.
