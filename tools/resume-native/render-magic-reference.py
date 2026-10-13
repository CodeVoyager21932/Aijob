"""Render unchanged pinned Magic components with the same synthetic short draft.

Only a local comparison fixture; never a production PDF engine or user import.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse, base64, hashlib, json

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--matrix', default='.data/resume-native-k4-20260913/magic2-v9')
parser.add_argument('--output', default='.data/resume-native-k4-20260913/magic-reference')
args = parser.parse_args()
out = root / args.output
out.mkdir(parents=True, exist_ok=True)
runtime = root / '.data/resume-quality-20260910/upstream-runtime'
reference = root / 'vendor/resume-template-references/magic-resume'
mapping = {'magic-compact-cn': 'magic_compact_cn_photo', 'magic-executive-cn': 'magic_executive_band'}
configs = {'magic_compact_cn_photo': 'compact-cn-photo-template.ts', 'magic_executive_band': 'executive-band-template.ts'}
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
checked = []
a=reference/"MagicResumeRenderer.tsx"
b=runtime/"magic/packages/resume-templates/src/renderer/MagicResumeRenderer.tsx"
assert sha(a)==sha(b)
checked.append({"source":str(a.relative_to(root)),"sha256":sha(a)})
for local, filename in configs.items():
    a = reference / filename
    b = runtime / f'magic/packages/resume-templates/src/config/{local}.ts'
    assert sha(a) == sha(b), filename
    checked.append({'source': str(a.relative_to(root)), 'sha256': sha(a)})
for filename in ['CenteredPhotoHeader.tsx', 'DefaultSection.tsx', 'Header.tsx', 'InlineKeyValueSection.tsx', 'ThreeColumnSection.tsx', 'Timeline.tsx']:
    a, b = reference / filename, runtime / f'magic/packages/resume-templates/src/templateLayout/{filename}'
    assert sha(a) == sha(b), filename
    checked.append({'source': str(a.relative_to(root)), 'sha256': sha(a)})

def convert(doc):
    d = doc['data']; b = d['basics']
    sections = {}
    for kind, section in d['sections'].items():
        if section.get('hidden'): continue
        items = []
        for item in section['items']:
            if item.get('hidden'): continue
            row = dict(item)
            row.update(date=item.get('period', ''), summary=item.get('description', ''))
            if kind == 'education': row.update(major=item.get('area', ''), description=item.get('description', ''))
            if kind == 'projects': row.update(project=item['name'])
            if kind == 'skills': row.update(skill=item['name'])
            if kind == 'certifications': row.update(certificate=item['title'])
            items.append(row)
        sections[{'certifications': 'certificates'}.get(kind, kind)] = items
    return {'info': {'fullName': b['name'], 'headline': b['headline'], 'email': b['email'], 'phoneNumber': b['phone'], 'address': b['location'], 'website': b['website']['url'], 'avatar': '', 'customFields': [{'id':f['id'], 'name':'链接', 'value':f['text']} for f in b['customFields']]}, 'sections': sections}

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 950, 'height': 1200}, device_scale_factor=1)
    page.route('**/*', lambda route: route.abort())
    page.set_content('<html><head></head><body style="margin:0;background:white"><div id="root"></div></body></html>')
    page.add_style_tag(path=str(runtime / 'built.css'))
    # Explicit local Chinese fallback; all layout/component source remains unchanged.
    font_css=[]
    for weight,name in [(400,'AijobV3SansRegular.woff2'),(700,'AijobV3SansBold.woff2')]:
        encoded=base64.b64encode((root/'apps/web/public/fonts'/name).read_bytes()).decode()
        font_css.append(f'@font-face{{font-family:"NativeReferenceNoto";font-weight:{weight};src:url(data:font/woff2;base64,{encoded})}}')
    page.add_style_tag(content=''.join(font_css)+'#root *{font-family:"NativeReferenceNoto",sans-serif!important}')
    page.add_script_tag(path=str(runtime / 'bundle.js'))
    for native, upstream in mapping.items():
        doc = json.loads((root / args.matrix / f'{native}-short.json').read_text(encoding='utf-8'))
        page.evaluate('({id,data})=>window.renderReference(id,data)', {'id':upstream,'data':convert(doc)})
        page.get_by_text(doc['data']['basics']['name'], exact=True).wait_for()
        page.evaluate('document.fonts.ready')
        page.locator('#root').screenshot(path=str(out / f'{native}-upstream.png'))
    browser.close()
(out / 'provenance.json').write_text(json.dumps({'sources':checked,'bundleSha256':sha(runtime/'bundle.js'),'cssSha256':sha(runtime/'built.css'),'scope':'Pinned unchanged components with same short synthetic fields; Noto fallback. Not a whole upstream application or pixel-equivalence claim.'},ensure_ascii=False,indent=2),encoding='utf-8')
print('Magic source reference renders saved')
