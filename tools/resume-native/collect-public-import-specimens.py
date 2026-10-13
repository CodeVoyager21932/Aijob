"""Fetch pinned, public example PDFs for local import boundary checks only.

Files stay in ignored .data; do not redistribute example resume contents.
"""
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".data/resume-native-public-specimens-20260923"
OUT.mkdir(parents=True, exist_ok=True)
SOURCES = [
    ("typst-minimal", "Dasiretiring109/Typst-resume-template", "7206a2899cf76ca16bc3dae9b51178ac58b3fc73", "pdf/minimal_ats.pdf"),
    ("typst-newspaper", "Dasiretiring109/Typst-resume-template", "7206a2899cf76ca16bc3dae9b51178ac58b3fc73", "pdf/newspaper_two_column.pdf"),
    ("typst-sidebar", "Dasiretiring109/Typst-resume-template", "7206a2899cf76ca16bc3dae9b51178ac58b3fc73", "pdf/sidebar_tech_blue.pdf"),
    ("latex-kenyon", "kenyon-wong/latex-resume-boilerplate", "50a27b75bf24b0387fe096a18c3ed415d5da1c51", "examples/resume-zh.pdf"),
    ("latex-postgraduate", "kody1126/Chinese-resume-template-postgraduate", "9bf00633308956cbfb3eccd29b93e413260f5c2f", "fushi-resume-template.pdf"),
    ("latex-forfrt", "forfrt/cn_resume", "d42d0c174a94f7c4d0bb7a14bfa21ead45b407fb", "中文简历模板.pdf"),
]
manifest = []
for name, repo, revision, path in SOURCES:
    url = f"https://raw.githubusercontent.com/{repo}/{revision}/{quote(path)}"
    request = Request(url, headers={"User-Agent": "Aijob-local-import-audit"})
    with urlopen(request, timeout=30) as response:
        data = response.read(5_000_001)
    if len(data) > 5_000_000 or not data.startswith(b"%PDF-"):
        raise RuntimeError(f"Invalid or oversized PDF: {name}")
    target = OUT / f"{name}.pdf"
    target.write_bytes(data)
    manifest.append({"id": name, "repository": repo, "commit": revision, "path": path,
                     "license": "MIT", "source": f"https://github.com/{repo}/blob/{revision}/{quote(path)}",
                     "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
    print(json.dumps({"id": name, "bytes": len(data), "sha256": manifest[-1]["sha256"]}))
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
