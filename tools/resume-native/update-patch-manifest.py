"""Record source changes against the pinned upstream; never updates upstream hashes."""
from pathlib import Path
import hashlib
import json
import os

root=Path(__file__).resolve().parents[2]/'vendor/reactive-resume'
manifest=json.loads((root/'upstream-manifest.json').read_text(encoding='utf-8'))
original={item['path']:item['sha256'] for item in manifest['files']}
paths=set(original)
for package in ['pdf','schema','fonts','resume','utils']:
    for directory, dirs, files in os.walk(root/package):
        dirs[:]=[name for name in dirs if name not in {'node_modules','dist','.turbo'}]
        for filename in files:
            file=Path(directory)/filename
            paths.add(file.relative_to(root).as_posix())
patches=[]
for path in sorted(paths):
    file=root/path
    current=hashlib.sha256(file.read_bytes()).hexdigest() if file.exists() else None
    previous=original.get(path)
    if current!=previous:
        patches.append({'path':path,'upstreamSha256':previous,'localSha256':current,'change':'added' if previous is None else 'removed' if current is None else 'modified'})
(root/'local-patches.json').write_text(json.dumps({'upstream':'86a72bef138ae51771ea3bdeda9b2871a3a838c8','patches':patches},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'{len(patches)} source patches recorded')
