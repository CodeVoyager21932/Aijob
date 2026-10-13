"""Reproduce the reported gallery defects using a fresh synthetic owner."""
import json, pathlib, uuid
from playwright.sync_api import sync_playwright, expect
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/evidence/resume-template-ux-2026-09-10'
OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:5173'
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
    context=browser.new_context(viewport={'width':1600,'height':1000})
    context.request.get(BASE+'/v1/session')
    csrf=next(c['value'] for c in context.cookies() if c['name']=='aijob_csrf')
    r=context.request.post(BASE+'/v1/resume-documents/studio',data={'title':'模板体验复现 · 合成空白稿'},headers={'origin':BASE,'x-csrf-token':csrf,'idempotency-key':str(uuid.uuid4())})
    assert r.ok,r.status
    draft=r.json();page=context.new_page();page.goto(BASE+'/resumes/'+draft['documentId'])
    expect(page.get_by_label('姓名',exact=True)).to_be_visible()
    page.get_by_role('button',name='模板',exact=True).click()
    page.get_by_role('button',name='放大查看信息整齐',exact=True).click()
    page.locator('.sw-gallery [data-preview-ready="true"]').wait_for()
    def geometry():
        return page.locator('.sw-gallery').evaluate('''el => ({height:el.clientHeight,scrollHeight:el.scrollHeight,overflow:getComputedStyle(el).overflow,grid:el.querySelector('.sw-gallery-grid').getBoundingClientRect().toJSON(),last:el.querySelector('.sw-gallery-grid > article:last-child').getBoundingClientRect().toJSON(),pages:el.querySelector('iframe').contentDocument.querySelectorAll('.rs-page').length})''')
    before=geometry();page.screenshot(path=str(OUT/'before-gallery.png'))
    page.mouse.move(420,830);page.mouse.wheel(0,4000);page.wait_for_timeout(350)
    after=geometry()
    page.get_by_role('button',name='返回编辑',exact=True).click()
    page.get_by_role('button',name='模板',exact=True).click()
    page.get_by_label('搜索模板').fill('横幅商务')
    page.get_by_role('button',name='使用模板',exact=True).click()
    page.locator('[data-content-ready="true"] [data-preview-ready="true"]').wait_for()
    page.screenshot(path=str(OUT/'before-blank-template.png'))
    latest=context.request.get(BASE+f'/v1/resume-documents/{draft["documentId"]}/studio').json()
    report={'beforeWheel':before,'afterWheel':after,'newDocumentSectionCount':len(draft['content']['sections']),'appliedTemplate':latest['layout']['templateKey'],'afterApplySectionCount':len(latest['content']['sections']),'actualBlankDocumentPages':page.frame_locator('iframe').locator('.rs-page').count()}
    (OUT/'baseline.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False));browser.close()
