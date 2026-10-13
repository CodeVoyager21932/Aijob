"""Inspect all pages of the real Office export, against the independent field inventory."""
import json,pathlib,re,unicodedata
from pypdf import PdfReader
ROOT=pathlib.Path(__file__).resolve().parents[3]
MATRIX=ROOT/'docs/evidence/resume-studio-quality-2026-09-10/matrix'
OUT=MATRIX/'office-v3'
report=json.loads((OUT/'report.json').read_text(encoding='utf-8-sig'))
normal=lambda text:re.sub(r'\s|\u200b|\u00ad','',unicodedata.normalize('NFC',text))
checks=[]
for record in report['results']:
    stem=record['template']+'-'+record['sample'];path=OUT/(stem+'.pdf')
    if not path.exists():checks.append({'id':stem,'passed':False,'reason':'OFFICE_PDF_MISSING'});continue
    manifest=json.loads((MATRIX/(stem+'.manifest.json')).read_text(encoding='utf8'))
    pdf=PdfReader(path);pages=[normal(page.extract_text()) for page in pdf.pages];text=''.join(pages)
    missing=[]
    for field in manifest['fields']:
        segments=field['value'].split('\n') if field['id'].endswith('.body') else [field['value']]
        if any(normal(segment) not in text for segment in segments if normal(segment)):missing.append(field['id'])
    empty=[i+1 for i,value in enumerate(pages) if len(value)<10]
    header_only=record['sample']!='short' and len(pages[0])<150
    checks.append({'id':stem,'passed':not missing and not empty and not header_only,'pages':len(pages),'charactersPerPage':[len(value) for value in pages],'missingFieldIds':missing,'emptyPages':empty,'headerOnlyFirstPage':header_only})
result={'matrixSignature':report['matrixSignature'],'checks':checks,'limitations':['Office on this machine is WPS. Microsoft Word and LibreOffice were not tested.','DOCX uses editable Word structures; it is not a pixel-identical PDF replica.']}
(OUT/'readback.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'checked':len(checks),'passed':sum(c['passed'] for c in checks),'failed':[c for c in checks if not c['passed']]},ensure_ascii=False))
if any(not c['passed'] for c in checks):raise SystemExit(1)
