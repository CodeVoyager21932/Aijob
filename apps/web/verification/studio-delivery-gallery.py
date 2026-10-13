"""Check the delivered static gallery, links and final output checksums."""
import hashlib,json,pathlib
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright,expect

ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/evidence/direction-studio-upgrade-2026-09-09'
manifest=json.loads((OUT/'delivery-manifest.json').read_text(encoding='utf-8'))
checked=0
for template in manifest['templates']:
    for sample in template['fixtures']:
        for item in sample['files']:
            data=(OUT/item['path']).read_bytes()
            assert hashlib.sha256(data).hexdigest()==item['sha256'],item['path']
            checked+=1
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
    page=browser.new_page(viewport={'width':1500,'height':1000})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto((OUT/'index.html').as_uri())
    expect(page.locator('article')).to_have_count(30)
    for link in page.locator('a').evaluate_all('(els)=>els.map(e=>e.href)'):
        url=urlparse(link)
        if url.scheme=='file':assert pathlib.Path(unquote(url.path.lstrip('/'))).exists(),link
    page.get_by_label('查找模板名称或用途').fill('Classic')
    expect(page.locator('article:visible')).to_have_count(1)
    page.get_by_label('查找模板名称或用途').fill('')
    for img in page.locator('article:visible img').all()[:4]:
        img.scroll_into_view_if_needed()
        assert img.evaluate('(el)=>el.complete && el.naturalWidth>0')
    page.evaluate('window.scrollTo(0,0)')
    page.screenshot(path=str(OUT/'browser/delivery-gallery.png'))
    page.set_viewport_size({'width':360,'height':740})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    assert not errors
    browser.close()
report={'passed':True,'templates':30,'outputFilesWithMatchingHash':checked,'localLinksExist':True,'searchWorks':True,'narrow360NoOverflow':True,'pageErrors':errors}
(OUT/'browser/delivery-gallery.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
