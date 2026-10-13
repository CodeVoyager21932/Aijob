"""Assemble latest verified template outputs without overwriting earlier evidence."""
from pathlib import Path
import argparse, hashlib, json, shutil

parser = argparse.ArgumentParser()
parser.add_argument('--sources', required=True, help='Comma-separated directories, latest last')
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
catalog = json.loads((root/'docs/evidence/resume-native-template-catalog.json').read_text(encoding='utf-8'))
selected = {}
for directory in args.sources.split(','):
    source = root/directory
    for row in json.loads((source/'results.json').read_text(encoding='utf-8')):
        selected[(row['template'],row['length'])] = (source,row)
target = root/args.output
target.mkdir(parents=True,exist_ok=True)
rows, files = [], []
for template in catalog['catalog']:
    for length in ('short','medium','long'):
        source,row = selected[(template['id'],length)]
        if any(row[key] for key in ('missingPdf','missingDocx','missingLinks')):
            raise ValueError(f'Failed output: {template["id"]} {length}')
        rows.append(row)
        stem = f'{template["id"]}-{length}'
        for extension in ('pdf','docx','json'):
            original = source/f'{stem}.{extension}'
            destination = target/original.name
            digest = hashlib.sha256(original.read_bytes()).hexdigest()
            if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest()!=digest:
                raise ValueError(f'Refusing to overwrite earlier evidence: {destination}')
            shutil.copyfile(original,destination)
            files.append({'file':original.name,'source':original.relative_to(root).as_posix(),'sha256':digest})
(target/'results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
(target/'provenance.json').write_text(json.dumps({'catalogCount':catalog['count'],'files':files},indent=2),encoding='utf-8')
print(json.dumps({'templates':catalog['count'],'documents':len(rows),'pdfPages':sum(row['pages'] for row in rows),'fieldChecks':sum(row['expectedFields'] for row in rows),'visualReview':'pending'}))
