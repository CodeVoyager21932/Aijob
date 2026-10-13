"""Actual Chrome native 200% zoom, with a dedicated profile and synthetic owner."""
import json, os, pathlib, time, uuid
from playwright.sync_api import sync_playwright, expect
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/evidence/direction-studio-upgrade-2026-09-09/browser'
BASE=os.environ.get('AIJOB_WEB_URL','http://127.0.0.1:5173')
with sync_playwright() as p:
    context=p.chromium.launch_persistent_context(str(ROOT/'.data/studio-native-zoom-qa'),executable_path=os.environ.get('PDF_BROWSER_EXECUTABLE','C:/Program Files/Google/Chrome/Application/chrome.exe'),headless=True,no_viewport=True,args=['--window-size=1600,1000'])
    assert context.request.get(BASE+'/v1/session').ok
    csrf=next(c['value'] for c in context.cookies() if c['name']=='aijob_csrf')
    def api(method,path,data):
        r=context.request.fetch(BASE+path,method=method,data=data,headers={'origin':BASE,'x-csrf-token':csrf,'idempotency-key':str(uuid.uuid4())});assert r.ok
        return r.json()
    draft=api('POST','/v1/resume-documents/studio',{'title':'R5 原生缩放合成验收'})
    content=json.loads((OUT.parent/'synthetic-medium.json').read_text(encoding='utf-8'))
    api('PUT',f"/v1/resume-documents/{draft['documentId']}/studio",{'expectedRevision':draft['revision'],'title':draft['title'],'content':content,'layout':{**draft['layout'],'templateKey':'jp_classic','rendererVersion':'studio-pages-v2'}})
    page=context.pages[0];page.set_default_timeout(30000);page.goto('chrome://settings/appearance');page.locator('select#zoomLevel').select_option('2')
    page.goto(BASE+'/resumes/'+draft['documentId']);page.locator('.resume-workspace').wait_for()
    page.get_by_role('button',name='编辑内容',exact=True).click()
    city=page.get_by_label('所在城市',exact=True);city.fill('');city.focus()
    cdp=context.new_cdp_session(page);cdp.send('Input.imeSetComposition',{'text':'杭州','selectionStart':2,'selectionEnd':2});cdp.send('Input.insertText',{'text':'杭州'})
    expect(city).to_have_value('杭州');expect(page.locator('.sw-save-status')).to_contain_text('已自动保存')
    page.get_by_role('button',name='模板',exact=True).click();gallery=page.get_by_role('dialog',name='选择简历模板')
    gallery.get_by_label('搜索模板').fill('Modern Minimal');expect(gallery.locator('.sw-template-card')).to_have_count(1)
    page.keyboard.press('Escape');expect(gallery).not_to_be_visible()
    assert page.evaluate('document.activeElement.textContent.trim()')=='模板'
    page.get_by_role('button',name='纸张预览',exact=False).click();expect(page.locator('.sw-preview-pane')).to_be_visible()
    page.get_by_role('button',name='编辑内容',exact=True).click();expect(city).to_have_value('杭州')
    metrics=page.evaluate('''()=>({innerWidth,outerWidth,devicePixelRatio,visualScale:visualViewport.scale,overflow:document.documentElement.scrollWidth>innerWidth+1,editorVisible:getComputedStyle(document.querySelector('.sw-edit-pane')).visibility,previewVisible:getComputedStyle(document.querySelector('.sw-preview-pane')).visibility})''')
    assert metrics['devicePixelRatio']==2 and metrics['innerWidth']<900 and not metrics['overflow']
    report={'passed':True,'metrics':metrics,'checks':['Chrome native zoom 200%','Chinese composition protocol input and server save','Template search and Escape focus return','Edit/preview tabs preserve input'],'limitations':['Headless desktop Chrome native zoom; no physical mobile soft keyboard or OS IME candidate window was operated.'],'at':time.time()}
    page.screenshot(path=str(OUT/'native-200-percent.png'),full_page=True)
    (OUT/'native-200-percent.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False));context.close()
