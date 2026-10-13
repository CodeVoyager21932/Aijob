"""Assemble the synthetic output index and verify its local artifact references."""
import hashlib,html,json,pathlib,re
from pypdf import PdfReader
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/resume-template-ux-2026-09-10'
report=json.loads((OUT/'templates/report.json').read_text(encoding='utf-8-sig'))
office=json.loads((OUT/'templates/office/report.json').read_text(encoding='utf-8-sig'))
assert len(report['results'])==30 and all(row['passed'] for row in report['results'])
assert len(office)==30 and all(row['passed'] and row['pages']==1 for row in office)
names=dict(re.findall(r'id:\s*"([^"]+)",\s*name:\s*"([^"]+)"',(ROOT/'packages/contracts/src/resume-templates.ts').read_text(encoding='utf-8')))
files=[];cards=[]
for row in report['results']:
    id=row['id']
    for suffix in ['png','pdf','docx']:
        path=OUT/f'templates/{id}.{suffix}';assert path.is_file()
        files.append({'path':path.relative_to(OUT).as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    office_pdf=OUT/f'templates/office/{id}.pdf'
    pdf=PdfReader(office_pdf);assert len(pdf.pages)==1
    text=''.join(p.extract_text() for p in pdf.pages)
    assert '林知夏' in text and 'lin.zhixia@example.com' in text,id
    files.append({'path':office_pdf.relative_to(OUT).as_posix(),'sha256':hashlib.sha256(office_pdf.read_bytes()).hexdigest()})
    cards.append(f'<article><a href="templates/{id}.pdf"><img src="templates/{id}.png" alt="{html.escape(names.get(id,id))}"></a><h2>{html.escape(names.get(id,id))}</h2><p>1 页 · <a href="templates/{id}.pdf">PDF</a> · <a href="templates/{id}.docx">DOCX</a></p></article>')
page_html='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>30 套一页中文样稿</title><style>*{box-sizing:border-box}body{margin:24px;background:#edf1e9;color:#234a3d;font:14px system-ui}h1{font-size:24px}main{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:16px}article{background:white;padding:12px;border-radius:8px;border:1px solid #dbe3d7}img{width:100%;height:auto;display:block}h2{font-size:15px;margin:10px 0 4px}p{margin:4px 0 16px}a{color:#23624f}@media(max-width:900px){main{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:500px){main{grid-template-columns:repeat(2,minmax(0,1fr))}}</style><h1>30 套模板 · 同一份中文一页样稿</h1><p>2026-09-10 · 合成材料。Chromium PDF 和本机 WPS DOCX 均为一页；点击缩略图查看 PDF。</p><main>'''+''.join(cards)+'</main></html>'
(OUT/'template-contact-sheet.html').write_text(page_html,encoding='utf-8')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
    page=browser.new_page(viewport={'width':1800,'height':1200});page.goto((OUT/'template-contact-sheet.html').as_uri());page.screenshot(path=str(OUT/'template-contact-sheet.png'),full_page=True);browser.close()
manifest={'synthetic':True,'templates':30,'chromiumPdfOnePage':30,'wpsDocxOnePage':30,'wpsPdfChineseReadback':30,'artifacts':files,'localSourceOnly':'The previous R5 package does not include these changes.'}
(OUT/'artifact-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in manifest.items() if k!='artifacts'},ensure_ascii=False))
