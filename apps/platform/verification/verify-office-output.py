"""Read back Office-rendered synthetic DOCX outputs; never accesses user documents."""
import json, pathlib, re
from pypdf import PdfReader

ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/evidence/direction-studio-upgrade-2026-09-09/templates'
manifest=json.loads((OUT/'word/report.json').read_text(encoding='utf-8-sig'))
normalize=lambda s:re.sub(r'\s+','',s)
checks=[]
for row in manifest:
    content=json.loads((OUT.parent/f"synthetic-{row['sample']}.json").read_text(encoding='utf-8'))
    pdf=PdfReader(OUT/'word'/f"{row['template']}-{row['sample']}.pdf")
    pages=[normalize(page.extract_text()) for page in pdf.pages]
    text=''.join(pages)
    needles=[content['basics'][key] for key in ['name','phone','email']]
    for section in content['sections']:
        for entry in section['entries']:
            needles.extend(entry.get(key,'') for key in ['title','organization','role','degree','major'])
            needles.extend(entry.get('details',{}).values())
    missing=[item for item in needles if item and normalize(item) not in text]
    empty=[n+1 for n,page in enumerate(pages) if len(page)<15]
    header_only=row['sample']!='short' and len(pages[0])<200
    checks.append({'template':row['template'],'sample':row['sample'],'passed':not missing and not empty and not header_only,'pages':len(pages),'charactersPerPage':[len(page) for page in pages],'missing':missing,'emptyPages':empty,'headerOnlyFirstPage':header_only})
result={'renderer':'WPS Office via the registered Word.Application COM server','officeVersion':manifest[0]['officeVersion'],'checks':checks,'limitations':['This computer registers WPS for Word.Application; Microsoft Word and LibreOffice were not tested.','DOCX page counts may differ from Chromium PDF. Editable structure and actual Office output are verified separately.']}
(OUT/'office-readback.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'checked':len(checks),'passed':sum(row['passed'] for row in checks),'failed':[row for row in checks if not row['passed']]},ensure_ascii=False))
if any(not row['passed'] for row in checks):raise SystemExit(1)
