"""Package the current source and synthetic native-output evidence with UTF-8 paths."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import tarfile
from datetime import datetime, timezone
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[2]
label = 'resume-native-20260913-k5'
output = root / '.data/releases' / label
output.mkdir(parents=True, exist_ok=True)
paths = subprocess.check_output(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root
).decode('utf-8').split('\0')
entries = []
for path in sorted(set(paths)):
    if not path or path.startswith(('.data/', '.hatch-runs/')) or 'node_modules/' in path:
        continue
    if re.search(r'(^|/)\.env($|\.)', path) and not path.endswith('.env.example'):
        continue
    if re.search(r'\.(pdf|docx|png|jpg|jpeg|zip)$', path, re.I) and not path.startswith('apps/web/public/'):
        continue
    file = root / path
    if not file.is_file():
        continue
    data = file.read_bytes()
    entries.append({'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
manifest = {
    'createdAt': datetime.now(timezone.utc).isoformat(),
    'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip(),
    'kind': 'source_candidate_requires_locked_install_and_build',
    'exclusions': ['.data', '.hatch-runs', 'local env except examples', 'node_modules', 'private binary evidence'],
    'files': entries,
}
(output / 'candidate-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
archive = output / f'aijob-{label}-source.tar.gz'
with tarfile.open(archive, 'w:gz', format=tarfile.PAX_FORMAT, compresslevel=1) as package:
    for entry in entries:
        package.add(root / entry['path'], arcname=entry['path'], recursive=False)
with tarfile.open(archive, 'r:gz') as package:
    members = {m.name: m for m in package.getmembers() if m.isfile()}
    assert len(members) == len(entries)
    for entry in entries:
        assert hashlib.sha256(package.extractfile(members[entry['path']]).read()).hexdigest() == entry['sha256'], entry['path']

evidence = root / '.data/resume-native-k4-20260913/accepted40-v11'
evidence_zip = output / 'native-synthetic-output-evidence.zip'
with ZipFile(evidence_zip, 'w', ZIP_DEFLATED) as package:
    for file in sorted(evidence.iterdir()):
        if file.is_file():
            package.write(file, file.name)
    for name in ('resume-native-k4-k5-2026-09-13.md', 'resume-native-template-catalog.json', 'resume-native-k4-final-checks.json'):
        package.write(root / 'docs/evidence' / name, 'documentation/' + name)
    office = root / '.data/resume-native-k4-20260913/office-review-final'
    for file in sorted(office.iterdir()):
        if file.suffix in ('.json', '.jpg'):
            package.write(file, 'office-review/' + file.name)
report = {
    'sourceEntries': len(entries), 'sourceBytes': archive.stat().st_size,
    'sourceSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'sourceMatchesManifest': True, 'evidenceBytes': evidence_zip.stat().st_size,
    'evidenceSha256': hashlib.sha256(evidence_zip.read_bytes()).hexdigest(),
    'compiledRuntime': False,
}
(output / 'package-check.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
