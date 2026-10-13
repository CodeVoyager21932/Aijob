"""A failed copy/save must retry the same new document and keep the user's input."""
import json,pathlib,uuid
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/direction-studio-upgrade-2026-09-09/browser';BASE='http://127.0.0.1:5173'
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
    context=browser.new_context(viewport={'width':1600,'height':1000});context.request.get(BASE+'/v1/session')
    csrf=next(c['value'] for c in context.cookies() if c['name']=='aijob_csrf')
    def api(method,path,data=None):
        r=context.request.fetch(BASE+path,method=method,data=data,headers={'origin':BASE,'x-csrf-token':csrf,'idempotency-key':str(uuid.uuid4())});assert r.ok
        return r.json()
    draft=api('POST','/v1/resume-documents/studio',{'title':'R5 冲突恢复合成验收'});doc=draft['documentId']
    content=json.loads((OUT.parent/'synthetic-short.json').read_text(encoding='utf-8'))
    draft=api('PUT',f'/v1/resume-documents/{doc}/studio',{'expectedRevision':draft['revision'],'title':draft['title'],'content':content,'layout':draft['layout']})
    page=context.new_page();console=[];page.on('console',lambda m:console.append(m.text));page.set_default_timeout(30000);page.goto(BASE+'/resumes/'+doc);expect(page.get_by_label('姓名',exact=True)).to_have_value('林知夏')
    content=draft['content'];content['basics']['city']='南京'
    api('PUT',f'/v1/resume-documents/{doc}/studio',{'expectedRevision':draft['revision'],'title':draft['title'],'content':content,'layout':draft['layout']})
    page.get_by_label('所在城市',exact=True).fill('杭州，保留我的输入')
    copy=page.get_by_role('button',name='当前输入另存方向稿',exact=True);copy.wait_for()
    attempted=[];keys=[]
    def intercept(route):
        req=route.request
        if req.method=='PUT' and '/resume-documents/' in req.url and not f'/{doc}/' in req.url and req.url.endswith('/studio'):
            attempted.append(req.url)
            if len(attempted)==1:route.abort('failed');return
        if req.method=='POST' and req.url.endswith('/resume-documents/studio'):keys.append(req.headers.get('idempotency-key'))
        route.continue_()
    page.route('**/v1/resume-documents/**',intercept)
    copy.click();page.wait_for_timeout(1300);assert len(attempted)==1
    expect(page.get_by_label('所在城市',exact=True)).to_have_value('杭州，保留我的输入')
    copy.click();page.wait_for_url(lambda url: '/resumes/' in str(url) and not str(url).endswith(doc))
    expect(page.get_by_label('所在城市',exact=True)).to_have_value('杭州，保留我的输入')
    assert len(set(attempted))==1 and len(keys)==2 and keys[0]==keys[1]
    page.locator('[data-content-ready="true"] [data-preview-ready="true"]').wait_for()
    frame=page.frame_locator('iframe[title="简历实时排版预览"]')
    assert 'allow-modals' in page.locator('iframe[title="简历实时排版预览"]').get_attribute('sandbox')
    # Headless Chrome does not open the native print UI. Verify dispatch to the
    # ready iframe separately from the real PDF output suite.
    print_events=0
    for _ in range(3):
        page.locator('[data-content-ready="true"] [data-preview-ready="true"]').wait_for()
        frame.locator('body').evaluate("el => { window.__printEvents=0; window.print=()=>window.__printEvents++; }")
        page.get_by_role('button',name='打印',exact=True).click()
        print_events=frame.locator('body').evaluate('el => window.__printEvents')
        if print_events:break
        expect(page.locator('.sw-notice')).to_contain_text('排版正在更新')
    assert print_events and print_events>=1,{'events':print_events,'console':console[-6:],'notice':page.locator('.sw-notice').all_text_contents(),'ready':page.locator('[data-content-ready="true"] [data-preview-ready="true"]').count()}
    report={'passed':True,'attempts':len(attempted),'sameNewDocument':True,'sameCreationIdempotencyKey':True,'inputRetained':True,'browserPrintDispatch':True,'nativePrintDialogVerified':False}
    (OUT/'recovery-copy.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report));browser.close()
