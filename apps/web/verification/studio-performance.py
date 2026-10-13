"""Synthetic browser measurements against an already running local app; no external API."""
import json, os, pathlib, platform, statistics, time, uuid, sys
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/evidence/direction-studio-upgrade-2026-09-09/browser'
BASE = os.environ.get('AIJOB_WEB_URL', 'http://127.0.0.1:5173')
CHROME = os.environ.get('PDF_BROWSER_EXECUTABLE', 'C:/Program Files/Google/Chrome/Application/chrome.exe')

def describe(values):
    ordered = sorted(values)
    return {'samples': len(values), 'p50': statistics.median(values), 'p95': ordered[min(len(ordered)-1, int(len(ordered)*.95))], 'max': max(values)} if values else None

report = {'environment': {'os': platform.platform(), 'url': BASE, 'viewport': [1600, 1000], 'mode': 'existing Vite development server'}, 'results': [], 'limitations': ['Input latency is input event to two animation frames, a browser paint proxy; it is not a field INP study.', 'Local Chromium, one active editor, synthetic materials; no real model, device keyboard, mobile hardware or remote latency.']}
def failed(kind, value, trace):
    report['failure']=str(value);OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'editor-performance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    sys.__excepthook__(kind,value,trace)
sys.excepthook=failed
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, headless=True)
    context = browser.new_context(viewport={'width': 1600, 'height': 1000})
    assert context.request.get(BASE+'/v1/session').ok
    def api(method, path, data=None):
        csrf = next(c['value'] for c in context.cookies() if c['name']=='aijob_csrf')
        response = context.request.fetch(BASE+path, method=method, data=data, headers={'origin':BASE, 'x-csrf-token':csrf, 'idempotency-key':str(uuid.uuid4())})
        assert response.ok, f'{method} {path}: {response.status}'
        return response.json()
    page = context.new_page(); page.set_default_timeout(30000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    for size in ['short', 'medium', 'long']:
        draft=api('POST','/v1/resume-documents/studio',{'title':'R5 性能合成材料 '+size})
        content=json.loads((OUT.parent/f'synthetic-{size}.json').read_text(encoding='utf-8'))
        layout={**draft['layout'],'templateKey':'jp_classic','rendererVersion':'studio-pages-v2','templateVersion':'2026-09-09.1','fontFamily':'serif','fontSize':11,'lineHeight':1.32,'sectionGap':9,'margin':15,'paragraphGap':2,'entryGap':6}
        draft=api('PUT',f"/v1/resume-documents/{draft['documentId']}/studio",{'expectedRevision':draft['revision'],'title':draft['title'],'content':content,'layout':layout})
        url=BASE+'/resumes/'+draft['documentId'];started=time.perf_counter()
        page.goto(url);expect(page.get_by_label('姓名',exact=True)).to_have_value('林知夏')
        first=(time.perf_counter()-started)*1000
        expect(page.locator('.sw-preview-status')).to_have_text('',timeout=60000)
        pages=page.frame_locator('.sw-preview-pane iframe').locator('.rs-page').count()
        page.evaluate('''()=>{window.__inputSamples=[];window.__lastInputEpoch=0;document.addEventListener('input',e=>{if(!e.target.closest('.sw-edit-pane'))return;const at=performance.now();window.__lastInputEpoch=Date.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.__inputSamples.push(performance.now()-at)))},true)}''')
        saves=[]
        def response_done(response):
            if response.request.method=='PUT' and response.url.endswith('/studio'):
                timing=response.request.timing
                saves.append({'status':response.status,'ms':timing['responseEnd'] if timing['responseEnd']>=0 else timing['responseStart'],'startEpoch':timing['startTime']})
        page.on('response',response_done)
        field=page.get_by_label('所在城市',exact=True);field.fill('上海');field.focus();page.keyboard.press('End')
        for n in range(24):page.keyboard.insert_text(str(n%10));page.wait_for_timeout(45)
        expect(page.locator('.sw-save-status')).to_contain_text('已自动保存')
        field_epoch=page.evaluate('window.__lastInputEpoch');field_saves=list(saves);saves.clear()
        editor=page.locator('.sw-record [contenteditable=true]').first;editor.click();page.keyboard.press('Control+End')
        for n in range(24):page.keyboard.insert_text('调研记录'[n%4]);page.wait_for_timeout(45)
        expect(page.locator('.sw-save-status')).to_contain_text('已自动保存')
        body_epoch=page.evaluate('window.__lastInputEpoch')
        expect(page.locator('.sw-preview-status')).to_have_text('')
        inputs=page.evaluate('window.__inputSamples')
        debounce=[]
        for events,epoch in [(field_saves,field_epoch),(saves,body_epoch)]:
            after=[s for s in events if s['startEpoch']>=epoch]
            if after:debounce.append(after[0]['startEpoch']-epoch)
        page.remove_listener('response',response_done)
        switches=[]
        for template in ['Azurill','Modern Minimal','Classic']:
            page.get_by_role('button',name='模板',exact=True).click();gallery=page.get_by_role('dialog',name='选择简历模板')
            gallery.get_by_label('搜索模板').fill(template)
            started=time.perf_counter();gallery.locator('.sw-template-card').first.get_by_role('button',name='使用模板',exact=True).click()
            expect(gallery).not_to_be_visible();page.wait_for_timeout(220);expect(page.locator('.sw-preview-status')).to_have_text('',timeout=60000)
            switches.append({'template':template,'ms':(time.perf_counter()-started)*1000})
        row={'sample':size,'initialPages':pages,'firstUsableMs':first,'inputPaintProxyMs':describe(inputs),'saveRequestMs':describe([s['ms'] for s in field_saves+saves]),'debounceMs':debounce,'templateSwitches':switches,'saveErrors':sum(s['status']>=400 for s in field_saves+saves)}
        report['results'].append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
    report['pageErrors']=errors;report['at']=time.time()
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'editor-performance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    browser.close()
if report['pageErrors'] or any(r['saveErrors'] for r in report['results']):raise SystemExit(1)
